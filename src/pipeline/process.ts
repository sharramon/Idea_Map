import * as crypto from 'crypto';
import { readJson, writeJson, writeRawText, deleteRawText } from '../data/store';
import { createClient } from '../llm';
import { extractEntries } from './extractor';
import { verifyEntries } from './verifier';
import { themeCollapseEntriesAndTaxonomy } from './themeCollapse';
import { updateLinksIncremental } from './links';
import {
  trimClassification, entryHasRequiredAnchors, countQualifyingSplitThemes, qualifyingSplitThemeIds,
  OWN_ENTRY_CENTRALITY_THRESHOLD, finalizeEntryForStorage, sanitizeEntryThemes, ensureMinimumThemeCandidates, VerifierOutput,
  normalizeThemeId, isValidThemeId,
} from './classification';
import { countWords, targetEntryCount } from './scale';
import { applyFlexibleCap, hasStrongSplitCase, entriesAreDistinct, HIGH_CONFIDENCE_THRESHOLD, EXTRA_ENTRY_STRONG_SCORE } from './distinct';
import { config } from '../config';
import {
  Taxonomy, Source, SourcesFile, EntriesFile, Entry, LinksFile, AnchorsFile,
} from '../types';

export class DuplicateSourceError extends Error {
  constructor(public readonly existing: Source) {
    super(`This text was already processed as "${existing.title}" (${existing.id}) on ${existing.created_at}.`);
    this.name = 'DuplicateSourceError';
  }
}

function hashText(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function generateId(prefix: string, existingIds: string[]): string {
  const existing = new Set(existingIds);
  let i = 1;
  while (true) {
    const id = `${prefix}_${String(i).padStart(3, '0')}`;
    if (!existing.has(id)) return id;
    i++;
  }
}

function logThemeCandidateCentrality(
  stage: 'Extractor' | 'Verifier',
  entries: Array<{ theme_candidates?: Array<{ theme: string; centrality: number }> }>,
): void {
  const maxByTheme = new Map<string, number>();
  for (const entry of entries) {
    for (const candidate of entry.theme_candidates ?? []) {
      const current = maxByTheme.get(candidate.theme);
      if (current === undefined || candidate.centrality > current) {
        maxByTheme.set(candidate.theme, candidate.centrality);
      }
    }
  }

  if (!maxByTheme.size) {
    console.log(`[${stage}]   Theme centrality: none reported`);
    return;
  }

  const sorted = Array.from(maxByTheme.entries())
    .sort((a, b) => b[1] - a[1]);
  const formatted = sorted
    .map(([theme, centrality]) => `${theme}=${centrality.toFixed(2)}`)
    .join(', ');
  console.log(`[${stage}]   Theme centrality (max by theme): ${formatted}`);
}

function collectThemeSet(
  entries: Array<{ theme_candidates?: Array<{ theme: string }> }>,
): string[] {
  const themes = new Set<string>();
  for (const entry of entries) {
    for (const candidate of entry.theme_candidates ?? []) {
      if (candidate.theme?.trim()) themes.add(candidate.theme);
    }
  }
  return Array.from(themes).sort();
}

function enforceExtractorThemeSet(
  entries: VerifierOutput[],
  extractorThemes: string[],
): VerifierOutput[] {
  const allowedList = Array.from(new Set(
    extractorThemes.map(normalizeThemeId).filter(Boolean),
  ));
  if (!allowedList.length) return entries;
  const allowed = new Set(allowedList);

  return entries.map(entry => {
    const filteredCandidates = (entry.theme_candidates ?? [])
      .map(c => ({ ...c, theme: normalizeThemeId(c.theme) }))
      .filter(c => allowed.has(c.theme));

    const sortedCandidates = [...filteredCandidates].sort((a, b) => b.centrality - a.centrality);
    const normalizedPrimary = normalizeThemeId(entry.primary_theme);
    const primary = allowed.has(normalizedPrimary)
      ? normalizedPrimary
      : (sortedCandidates[0]?.theme ?? allowedList[0]);

    const secondary = [...new Set(
      (entry.secondary_themes ?? [])
        .map(normalizeThemeId)
        .filter(t => allowed.has(t) && t !== primary),
    )].slice(0, 2);

    return {
      ...entry,
      primary_theme: primary,
      secondary_themes: secondary,
      theme_candidates: ensureMinimumThemeCandidates(
        filteredCandidates,
        primary,
        entry.confidence?.primary_theme ?? 0,
        entry.evidence_excerpt ?? '',
      ),
    };
  });
}

function toTitleCaseThemeName(themeId: string): string {
  return themeId
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function ensureThemeExistsInTaxonomy(taxonomy: Taxonomy, themeId: string): boolean {
  const id = normalizeThemeId(themeId);
  if (!id || !isValidThemeId(id)) {
    console.warn(`[Taxonomy] Skipping invalid theme id: "${themeId}"`);
    return false;
  }
  if (taxonomy.themes.some(t => t.id === id)) return false;
  taxonomy.themes.push({
    id,
    name: toTitleCaseThemeName(id),
    description: `Auto-added from extracted primary theme "${id}".`,
  });
  return true;
}

export interface ProcessOptions {
  apiKeyOverride?: string;
  extractorModel?: string;
  verifierModel?: string;
  conservatism?: number;
  dryRun?: boolean;
  reprocess?: boolean;
}

export interface ProcessResult {
  source: Source | null;
  entries: Entry[];
  skippedDuplicates: number;
}

export interface DeleteResult {
  source: Source;
  removedEntryCount: number;
  removedLinkCount: number;
}

export function deleteSource(sourceId: string): DeleteResult {
  const sourcesFile = readJson<SourcesFile>('sources.json');
  const entriesFile = readJson<EntriesFile>('entries.json');
  const linksFile = readJson<LinksFile>('links.json');

  const source = sourcesFile.sources.find(s => s.id === sourceId);
  if (!source) throw new Error(`Source not found: ${sourceId}`);

  const removedSet = new Set(source.child_entry_ids);
  sourcesFile.sources = sourcesFile.sources.filter(s => s.id !== sourceId);
  entriesFile.entries = entriesFile.entries.filter(e => !removedSet.has(e.id));

  const prevLinkCount = linksFile.links.length;
  const { links, entriesWithRelatedIds } = updateLinksIncremental(
    entriesFile.entries,
    linksFile.links,
    [...removedSet],
  );
  entriesFile.entries = entriesWithRelatedIds;
  linksFile.links = links;

  try {
    const anchorsFile = readJson<AnchorsFile>('anchors.json');
    let modified = false;
    for (const anchor of anchorsFile.anchors) {
      const before = anchor.linked_entry_ids.length;
      anchor.linked_entry_ids = anchor.linked_entry_ids.filter(id => !removedSet.has(id));
      if (anchor.linked_entry_ids.length !== before) modified = true;
    }
    if (modified) writeJson('anchors.json', anchorsFile);
  } catch {
    // anchors.json may not exist yet
  }

  if (source.raw_text_path) deleteRawText(source.raw_text_path);
  writeJson('sources.json', sourcesFile);
  writeJson('entries.json', entriesFile);
  writeJson('links.json', linksFile);

  return {
    source,
    removedEntryCount: source.child_entry_ids.length,
    removedLinkCount: prevLinkCount - links.length,
  };
}

export async function processSource(
  rawText: string,
  title: string,
  options: ProcessOptions = {},
): Promise<ProcessResult> {
  const {
    apiKeyOverride,
    extractorModel,
    verifierModel,
    conservatism = config.defaults.conservatism,
    dryRun = false,
    reprocess = false,
  } = options;

  const taxonomy = readJson<Taxonomy>('taxonomy.json');
  const sourcesFile = readJson<SourcesFile>('sources.json');
  const entriesFile = readJson<EntriesFile>('entries.json');
  const linksFile = readJson<LinksFile>('links.json');
  let removedEntryIds: string[] = [];

  const hash = hashText(rawText);
  const existing = sourcesFile.sources.find(s => s.content_hash === hash);
  if (existing && !reprocess) {
    throw new DuplicateSourceError(existing);
  }

  // Remove the old version before duplicate detection so reprocessed entries are not
  // compared against the entries they are supposed to replace.
  if (existing && reprocess) {
    removedEntryIds = [...existing.child_entry_ids];
    const entryWord = removedEntryIds.length === 1 ? 'y' : 'ies';
    if (dryRun) {
      sourcesFile.sources = sourcesFile.sources.filter(s => s.id !== existing.id);
      entriesFile.entries = entriesFile.entries.filter(e => !removedEntryIds.includes(e.id));
      console.log(`[Dry run] Would remove "${existing.title}" and ${removedEntryIds.length} entr${entryWord}.`);
    } else {
      deleteSource(existing.id);
      sourcesFile.sources = readJson<SourcesFile>('sources.json').sources;
      entriesFile.entries = readJson<EntriesFile>('entries.json').entries;
      linksFile.links = readJson<LinksFile>('links.json').links;
      console.log(`[Reprocess] Removed "${existing.title}" and ${removedEntryIds.length} entr${entryWord}.`);
    }
  }

  // Pin sourceId and raw_text_path before any LLM work — never derived from model output.
  const allSourceIds = sourcesFile.sources.map(s => s.id);
  const sourceId = generateId('source', allSourceIds);
  const raw_text_path = `data/raw/${sourceId}.txt`;

  const wordCount = countWords(rawText);
  const targetCount = targetEntryCount(wordCount);

  const extractorClient = createClient('extractor', { apiKey: apiKeyOverride, model: extractorModel });
  const verifierClient = createClient('verifier', { apiKey: apiKeyOverride, model: verifierModel });

  console.log(`\n[Extractor] Processing "${title}" (${wordCount} words, baseline ~${targetCount} entr${targetCount === 1 ? 'y' : 'ies'})...`);
  let extractorRaw: Awaited<ReturnType<typeof extractEntries>>;
  try {
    extractorRaw = await extractEntries(extractorClient, rawText, taxonomy, entriesFile.entries, targetCount, wordCount);
  } catch (err) {
    throw new Error(`[Extractor] Failed for "${title}"\n${err instanceof Error ? err.message : err}`);
  }
  const proposed = extractorRaw.map(e => sanitizeEntryThemes(e, taxonomy));
  console.log(`[Extractor] Proposed ${proposed.length} entr${proposed.length === 1 ? 'y' : 'ies'}`);
  const qualifyingSplitCount = countQualifyingSplitThemes(proposed);
  const qualifyingThemes = qualifyingSplitThemeIds(proposed);
  const extractorThemeSet = collectThemeSet(proposed);
  console.log(
    `[Extractor]   ${qualifyingSplitCount} theme${qualifyingSplitCount === 1 ? '' : 's'} at centrality ≥${OWN_ENTRY_CENTRALITY_THRESHOLD}` +
    (qualifyingThemes.length ? `: ${qualifyingThemes.join(', ')}` : ''),
  );
  if (qualifyingSplitCount >= 2) {
    console.log('[Extractor]   Hard split signal: ≥2 qualifying themes (should_be_own_entry derived from centrality)');
  }
  if (extractorThemeSet.length > 0) {
    console.log(`[Verifier]   Allowed theme set from extractor: ${extractorThemeSet.join(', ')}`);
  } else {
    console.log('[Verifier]   Allowed theme set from extractor: none');
  }
  logThemeCandidateCentrality('Extractor', proposed);

  const dedupedByDistinct: typeof proposed = [];
  for (const entry of proposed) {
    if (dedupedByDistinct.every(kept => entriesAreDistinct(kept, entry))) {
      dedupedByDistinct.push(entry);
    }
  }
  if (dedupedByDistinct.length < proposed.length) {
    console.log(`[Extractor]   Dropped ${proposed.length - dedupedByDistinct.length} non-distinct entr${proposed.length - dedupedByDistinct.length === 1 ? 'y' : 'ies'} before verification (shared primary + secondary theme)`);
  }
  const proposedDistinct = dedupedByDistinct;

  const existingSummaries = entriesFile.entries.map(e => ({
    id: e.id,
    core_idea: e.core_idea ?? '',
    primary_theme: e.primary_theme,
    tags: e.tags,
  }));

  // Remove secondary themes shared across multiple extractor proposals before the verifier
  // sees them — a secondary theme that appears on every entry is a cross-cutting signal,
  // not a discriminating one, and would pollute the verifier's closed theme set.
  const secondaryCount = new Map<string, number>();
  for (const entry of proposedDistinct) {
    for (const t of entry.secondary_themes ?? []) {
      secondaryCount.set(t, (secondaryCount.get(t) ?? 0) + 1);
    }
  }
  const sharedSecondaries = new Set(
    [...secondaryCount.entries()].filter(([, n]) => n > 1).map(([t]) => t),
  );
  const dedupedProposed = sharedSecondaries.size === 0
    ? proposedDistinct
    : proposedDistinct.map(e => ({
        ...e,
        secondary_themes: (e.secondary_themes ?? []).filter(t => !sharedSecondaries.has(t)),
      }));
  if (sharedSecondaries.size > 0) {
    console.log(`[Extractor]   Removed shared secondary theme(s) before verification: ${[...sharedSecondaries].join(', ')}`);
  }

  console.log(`[Verifier] Verifying against source text (conservatism: ${conservatism})...`);
  let verifierRaw: Awaited<ReturnType<typeof verifyEntries>>;
  try {
    verifierRaw = await verifyEntries(verifierClient, rawText, dedupedProposed, taxonomy, existingSummaries, conservatism, targetCount, wordCount);
  } catch (err) {
    throw new Error(`[Verifier] Failed for "${title}"\n${err instanceof Error ? err.message : err}`);
  }
  const verified = verifierRaw.map(trimClassification).map(e => sanitizeEntryThemes(e, taxonomy));
  const extractorAllowedThemes = collectThemeSet(dedupedProposed);
  const verifiedThemeLocked = enforceExtractorThemeSet(verified, extractorAllowedThemes);

  const verifierThemeSet = collectThemeSet(verifiedThemeLocked);
  console.log(
    `[Verifier]   Themes passed through: ${
      verifierThemeSet.length > 0 ? verifierThemeSet.join(', ') : 'none'
    }`,
  );
  logThemeCandidateCentrality('Verifier', verifiedThemeLocked);

  const duplicateCount = verifiedThemeLocked.filter(e => e.is_duplicate).length;
  const unique = verifiedThemeLocked.filter(e => !e.is_duplicate);
  const underTagged = unique.filter(e => e.tags.length < 2).length;
  const missingAnchors = unique.filter(e => e.tags.length >= 2 && !entryHasRequiredAnchors(e)).length;
  let valid = unique.filter(e => e.tags.length >= 2 && entryHasRequiredAnchors(e));

  if (valid.length === 1 && countQualifyingSplitThemes(valid) >= 2) {
    const themes = qualifyingSplitThemeIds(valid);
    console.log(
      `[Verifier]   Warning: returned 1 entry but ${themes.length} themes at ≥${OWN_ENTRY_CENTRALITY_THRESHOLD}: ` +
      `${themes.join(', ')} — model may have vetoed hard split`,
    );
  }

  if (valid.length > targetCount) {
    const strongSplit = hasStrongSplitCase(valid);
    const { kept, dropped, keptExtra, droppedThin } = applyFlexibleCap(
      valid,
      targetCount,
      wordCount,
      { strongSplitConfirmed: strongSplit },
    );
    valid = kept;
    if (strongSplit && keptExtra > 0) {
      console.log('[Filter]   Relaxed cap for verifier-confirmed strong split');
    }
    if (keptExtra > 0) {
      console.log(
        `[Filter]   Kept ${keptExtra} extra distinct entr${keptExtra === 1 ? 'y' : 'ies'} above baseline ` +
        `(score ≥${HIGH_CONFIDENCE_THRESHOLD}; extras beyond soft max need ≥${EXTRA_ENTRY_STRONG_SCORE})`,
      );
    }
    if (dropped > 0) {
      console.log(
        `[Filter]   Dropped ${dropped} entr${dropped === 1 ? 'y' : 'ies'} above baseline ` +
        '(low score, thin fragment, or overlapping tag neighborhood)',
      );
    }
    if (droppedThin > 0) {
      console.log(
        `[Filter]   ${droppedThin} dropped entr${droppedThin === 1 ? 'y was' : 'ies were'} thin scene/beat fragments`,
      );
    }
  }

  console.log(`[Verifier] ${valid.length} unique, ${duplicateCount} duplicate(s) skipped`);
  if (underTagged > 0) {
    console.log(`[Filter]   Dropped ${underTagged} entr${underTagged === 1 ? 'y' : 'ies'} with fewer than 2 tags`);
  }
  if (missingAnchors > 0) {
    console.log(
      `[Filter]   Dropped ${missingAnchors} entr${missingAnchors === 1 ? 'y' : 'ies'} ` +
      'missing core_idea, evidence_excerpt, or tag_rationales',
    );
  }
  console.log();

  // Theme collapse runs after filtering and capping — no point collapsing entries
  // that will be dropped anyway.
  let collapseResult: Awaited<ReturnType<typeof themeCollapseEntriesAndTaxonomy>>;
  try {
    collapseResult = await themeCollapseEntriesAndTaxonomy(verifierClient, rawText, valid, taxonomy);
  } catch (err) {
    throw new Error(`[Theme Collapse] Failed for "${title}"\n${err instanceof Error ? err.message : err}`);
  }
  valid = collapseResult.entries.map(trimClassification);
  if (collapseResult.addedThemes || collapseResult.addedTags || collapseResult.updatedDefs || collapseResult.collapsedThemes || collapseResult.mergedTags) {
    console.log(
      `[Theme Collapse] Collapsed themes=${collapseResult.collapsedThemes}, merged tags=${collapseResult.mergedTags}, added themes=${collapseResult.addedThemes}, added tags=${collapseResult.addedTags}, definition updates=${collapseResult.updatedDefs}`,
    );
  }
  const taxonomyDirtyFromThemeCollapse = (collapseResult.addedThemes + collapseResult.addedTags + collapseResult.updatedDefs) > 0;

  const allEntryIds = entriesFile.entries.map(e => e.id);
  let addedThemeCount = 0;
  const newEntries: Entry[] = valid.map(e => {
    if (ensureThemeExistsInTaxonomy(taxonomy, e.primary_theme)) {
      addedThemeCount++;
    }
    const entryId = generateId('entry', allEntryIds);
    allEntryIds.push(entryId);
    return finalizeEntryForStorage(
      {
        id: entryId,
        source_id: sourceId,
        related_entry_ids: [],
        ...e,
      },
      taxonomy,
    );
  });

  if (dryRun) {
    const projectedEntries = [...entriesFile.entries, ...newEntries];
    const projectedChangedIds = [...removedEntryIds, ...newEntries.map(e => e.id)];
    const { links } = updateLinksIncremental(projectedEntries, linksFile.links, projectedChangedIds);
    console.log('[Dry run] Would add:');
    valid.forEach(e => {
      console.log(`  · [${e.primary_theme}] ${e.tags.join(', ')}`);
      console.log(`    ${e.core_idea}`);
    });
    console.log(`[Dry run] Would update links: ${linksFile.links.length} -> ${links.length}`);
    return { source: null, entries: [], skippedDuplicates: duplicateCount };
  }

  writeRawText(sourceId, rawText);
  const today = new Date().toISOString().split('T')[0];
  const source: Source = {
    id: sourceId,
    type: 'source',
    source_type: 'manual_diary_text',
    created_at: today,
    title,
    summary: `Processed ${today}. ${newEntries.length} entr${newEntries.length === 1 ? 'y' : 'ies'} extracted.`,
    raw_text_path,
    content_hash: hash,
    child_entry_ids: newEntries.map(e => e.id),
  };

  sourcesFile.sources.push(source);
  entriesFile.entries.push(...newEntries);
  const changedEntryIds = [...removedEntryIds, ...newEntries.map(e => e.id)];
  const updated = updateLinksIncremental(entriesFile.entries, linksFile.links, changedEntryIds);
  entriesFile.entries = updated.entriesWithRelatedIds;
  linksFile.links = updated.links;

  writeJson('sources.json', sourcesFile);
  writeJson('entries.json', entriesFile);
  writeJson('links.json', linksFile);
  if (addedThemeCount > 0 || taxonomyDirtyFromThemeCollapse) {
    writeJson('taxonomy.json', taxonomy);
    if (addedThemeCount > 0) {
      console.log(`[Taxonomy] Added ${addedThemeCount} new theme entr${addedThemeCount === 1 ? 'y' : 'ies'} from primary_theme output`);
    }
  }
  console.log(
    `[Links] Updated ${updated.links.length} links across ${entriesFile.entries.length} entries ` +
    `(changed entries: ${changedEntryIds.length})`,
  );

  return { source, entries: newEntries, skippedDuplicates: duplicateCount };
}
