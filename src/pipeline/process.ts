import * as crypto from 'crypto';
import { readJson, writeJson } from '../data/store';
import { createClient } from '../llm';
import { extractEntries } from './extractor';
import { verifyEntries } from './verifier';
import { trimClassification, entryHasRequiredAnchors, countQualifyingSplitThemes, qualifyingSplitThemeIds, OWN_ENTRY_CENTRALITY_THRESHOLD, finalizeEntryForStorage } from './classification';
import { countWords, targetEntryCount } from './scale';
import { applyFlexibleCap, hasStrongSplitCase, HIGH_CONFIDENCE_THRESHOLD, EXTRA_ENTRY_STRONG_SCORE } from './distinct';
import { config } from '../config';
import {
  Taxonomy, Source, SourcesFile, EntriesFile, Entry,
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

  const hash = hashText(rawText);
  const existing = sourcesFile.sources.find(s => s.content_hash === hash);
  if (existing && !reprocess) {
    throw new DuplicateSourceError(existing);
  }

  // Remove the old version before duplicate detection so reprocessed entries are not
  // compared against the entries they are supposed to replace.
  if (existing && reprocess) {
    sourcesFile.sources = sourcesFile.sources.filter(s => s.id !== existing.id);
    entriesFile.entries = entriesFile.entries.filter(
      e => !existing.child_entry_ids.includes(e.id),
    );
    console.log(
      `${dryRun ? '[Dry run] Would remove' : '[Reprocess] Removed'} previous analysis "${existing.title}" ` +
      `and ${existing.child_entry_ids.length} entr${existing.child_entry_ids.length === 1 ? 'y' : 'ies'}.`,
    );
  }

  const wordCount = countWords(rawText);
  const targetCount = targetEntryCount(wordCount);

  const extractorClient = createClient('extractor', { apiKey: apiKeyOverride, model: extractorModel });
  const verifierClient = createClient('verifier', { apiKey: apiKeyOverride, model: verifierModel });

  console.log(`\n[Extractor] Processing "${title}" (${wordCount} words, baseline ~${targetCount} entr${targetCount === 1 ? 'y' : 'ies'})...`);
  const proposed = await extractEntries(
    extractorClient, rawText, taxonomy, entriesFile.entries, targetCount, wordCount,
  );
  console.log(`[Extractor] Proposed ${proposed.length} entr${proposed.length === 1 ? 'y' : 'ies'}`);
  const qualifyingSplitCount = countQualifyingSplitThemes(proposed);
  const qualifyingThemes = qualifyingSplitThemeIds(proposed);
  console.log(
    `[Extractor]   ${qualifyingSplitCount} theme${qualifyingSplitCount === 1 ? '' : 's'} at centrality ≥${OWN_ENTRY_CENTRALITY_THRESHOLD}` +
    (qualifyingThemes.length ? `: ${qualifyingThemes.join(', ')}` : ''),
  );
  if (qualifyingSplitCount >= 2) {
    console.log('[Extractor]   Hard split signal: ≥2 qualifying themes (should_be_own_entry derived from centrality)');
  }

  const existingSummaries = entriesFile.entries.map(e => ({
    id: e.id,
    core_idea: e.core_idea ?? '',
    primary_theme: e.primary_theme,
    tags: e.tags,
  }));

  console.log(`[Verifier] Verifying against source text (conservatism: ${conservatism})...`);
  const verified = (await verifyEntries(
    verifierClient,
    rawText,
    proposed,
    taxonomy,
    existingSummaries,
    conservatism,
    targetCount,
    wordCount,
  )).map(trimClassification);

  const duplicateCount = verified.filter(e => e.is_duplicate).length;
  const unique = verified.filter(e => !e.is_duplicate);
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

  if (dryRun) {
    console.log('[Dry run] Would add:');
    valid.forEach(e => {
      console.log(`  · [${e.primary_theme}] ${e.tags.join(', ')}`);
      console.log(`    ${e.core_idea}`);
    });
    return { source: null, entries: [], skippedDuplicates: duplicateCount };
  }

  const allSourceIds = sourcesFile.sources.map(s => s.id);
  const sourceId = generateId('source', allSourceIds);

  const allEntryIds = entriesFile.entries.map(e => e.id);
  const newEntries: Entry[] = valid.map(e => {
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

  const today = new Date().toISOString().split('T')[0];
  const source: Source = {
    id: sourceId,
    type: 'source',
    source_type: 'manual_diary_text',
    created_at: today,
    title,
    summary: `Processed ${today}. ${newEntries.length} entr${newEntries.length === 1 ? 'y' : 'ies'} extracted.`,
    raw_text: rawText,
    content_hash: hash,
    child_entry_ids: newEntries.map(e => e.id),
  };

  sourcesFile.sources.push(source);
  entriesFile.entries.push(...newEntries);

  writeJson('sources.json', sourcesFile);
  writeJson('entries.json', entriesFile);

  return { source, entries: newEntries, skippedDuplicates: duplicateCount };
}
