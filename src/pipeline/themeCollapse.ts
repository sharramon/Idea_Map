import { LLMClient } from '../llm/client';
import { Taxonomy, Tag } from '../types';
import { VerifierOutput, isValidThemeId, normalizeThemeId, resolveThemeId } from './classification';
import { buildThemeCollapseSystemPrompt } from './prompts';

const TAG_NOVELTY_THRESHOLD = 0.5;
const THEME_COLLAPSE_SIMILARITY = 0.9;
const TAG_MERGE_CONFIDENCE = 0.6;
const SYSTEM_PROMPT = buildThemeCollapseSystemPrompt({ themeCollapseSimilarity: THEME_COLLAPSE_SIMILARITY, tagNoveltyThreshold: TAG_NOVELTY_THRESHOLD, tagMergeConfidence: TAG_MERGE_CONFIDENCE });

interface ThemeCollapseTagProposal {
  id: string;
  name: string;
  description: string;
  theme_ids: string[];
  aliases: string[];
  confidence: number;
}

interface ThemeAssessment {
  entry_index: number;
  original_theme: string;
  broadened_theme: string;
  broadened_theme_description: string;
  closest_taxonomy_theme: string;
  similarity_confidence: number;
}

interface ThemeCollapseEntry {
  entry_index: number;
  primary_theme: string;
  secondary_themes: string[];
  tags: string[];
}

interface SecondaryThemeAssessment {
  entry_index: number;
  original_theme: string;
  closest_taxonomy_theme: string;
  similarity_confidence: number;
}

interface TagAssessment {
  entry_index: number;
  original_tag: string;
  closest_taxonomy_tag: string;
  similarity_confidence: number;
  proposed_description: string;
}

interface ThemeCollapseOutput {
  entries: ThemeCollapseEntry[];
  theme_assessments: ThemeAssessment[];
  secondary_theme_assessments: SecondaryThemeAssessment[];
  tag_assessments: TagAssessment[];
  new_tags: ThemeCollapseTagProposal[];
  theme_updates: Array<{ id: string; description: string }>;
  tag_updates: Array<{ id: string; description: string }>;
}


function slugify(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return normalizeThemeId(raw);
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function coerceEntryPrimary(
  entry: VerifierOutput,
  taxonomy: Taxonomy,
  themeMap: Map<string, { id: string }>,
): string {
  const fromEntry = resolveThemeId(entry.primary_theme, taxonomy);
  if (fromEntry && themeMap.has(fromEntry)) return fromEntry;
  for (const candidate of entry.theme_candidates ?? []) {
    const resolved = resolveThemeId(candidate.theme, taxonomy);
    if (resolved && themeMap.has(resolved)) return resolved;
  }
  return entry.primary_theme;
}

function snippet(s: string): string {
  if (s.length <= 500) return s;
  return s.slice(0, 250) + '\n…[truncated]…\n' + s.slice(-250);
}

function extractJsonObject(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1].trim() : text.trim();
  const start = raw.indexOf('{');
  if (start === -1) throw new Error(`No JSON object found in theme collapse response.\nRaw response:\n${snippet(raw)}`);
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (c === '\\') escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === '{') depth++;
    if (c === '}') {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  throw new Error(`Unbalanced JSON object in theme collapse response (likely truncated by token limit).\nRaw response:\n${snippet(raw)}`);
}

function tokenizeForSimilarity(text: string): string[] {
  return normalizeThemeId(text)
    .split('_')
    .map(t => t.trim())
    .filter(Boolean);
}

function tokenDiceSimilarity(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const aSet = new Set(a);
  const bSet = new Set(b);
  let shared = 0;
  for (const token of aSet) {
    if (bSet.has(token)) shared++;
  }
  return (2 * shared) / (aSet.size + bSet.size);
}

function computeThemeSimilarityScore(
  broadenedTheme: string,
  broadenedThemeDescription: string,
  taxonomyTheme: { id: string; name: string; description: string },
): number {
  const broadenedId = normalizeThemeId(broadenedTheme);
  const taxonomyId = normalizeThemeId(taxonomyTheme.id);
  if (broadenedId && taxonomyId && broadenedId === taxonomyId) return 1;

  const idTokensA = tokenizeForSimilarity(broadenedTheme);
  const idTokensB = tokenizeForSimilarity(taxonomyTheme.id);
  const nameTokensA = tokenizeForSimilarity(broadenedTheme);
  const nameTokensB = tokenizeForSimilarity(taxonomyTheme.name);
  const descTokensA = tokenizeForSimilarity(broadenedThemeDescription);
  const descTokensB = tokenizeForSimilarity(taxonomyTheme.description ?? '');

  const idScore = tokenDiceSimilarity(idTokensA, idTokensB);
  const nameScore = tokenDiceSimilarity(nameTokensA, nameTokensB);
  const descScore = tokenDiceSimilarity(descTokensA, descTokensB);

  // Weighted deterministic lexical similarity.
  return (idScore * 0.6) + (nameScore * 0.25) + (descScore * 0.15);
}

function getClosestThemeByMath(
  assessment: ThemeAssessment,
  taxonomy: Taxonomy,
): { closestThemeId: string | null; similarity: number } {
  let bestId: string | null = null;
  let bestScore = 0;
  for (const theme of taxonomy.themes) {
    const score = computeThemeSimilarityScore(
      assessment.broadened_theme || assessment.original_theme,
      assessment.broadened_theme_description || '',
      theme,
    );
    if (score > bestScore) {
      bestScore = score;
      bestId = theme.id;
    }
  }
  return { closestThemeId: bestId, similarity: bestScore };
}

export async function themeCollapseEntriesAndTaxonomy(
  client: LLMClient,
  rawText: string,
  entries: VerifierOutput[],
  taxonomy: Taxonomy,
): Promise<{ entries: VerifierOutput[]; addedThemes: number; addedTags: number; updatedDefs: number; collapsedThemes: number; mergedTags: number }> {
  if (!entries.length) {
    return { entries, addedThemes: 0, addedTags: 0, updatedDefs: 0, collapsedThemes: 0, mergedTags: 0 };
  }

  const themeMap = new Map(taxonomy.themes.map(t => [t.id, t]));
  const tagMap = new Map<string, Tag>(taxonomy.tags.map(t => [t.id, t]));
  let addedThemes = 0;
  let addedTags = 0;
  let updatedDefs = 0;
  let collapsedThemes = 0;
  let mergedTags = 0;
  const collapsed: VerifierOutput[] = [];

  for (const entry of entries) {
    const user = [
      '## Thresholds',
      `New tag threshold: ${TAG_NOVELTY_THRESHOLD}`,
      `Collapse similarity threshold: > ${THEME_COLLAPSE_SIMILARITY}`,
      `Tag merge confidence: > ${TAG_MERGE_CONFIDENCE}`,
      '',
      '## Raw text',
      rawText,
      '',
      '## Taxonomy',
      JSON.stringify(taxonomy, null, 2),
      '',
      '## Verified entry',
      JSON.stringify([{ ...entry, entry_index: 0 }], null, 2),
    ].join('\n');

    const text = await client.complete(SYSTEM_PROMPT, user, 16384);
    const jsonStr = extractJsonObject(text);
    let parsed: Partial<ThemeCollapseOutput>;
    try {
      parsed = JSON.parse(jsonStr) as Partial<ThemeCollapseOutput>;
    } catch (err) {
      throw new Error(`JSON.parse failed in theme collapse: ${err instanceof Error ? err.message : err}\nExtracted JSON:\n${snippet(jsonStr)}`);
    }

    // Apply taxonomy additions/updates immediately so the next entry sees them.
    for (const p of asArray<ThemeCollapseTagProposal>(parsed.new_tags)) {
      const id = slugify(p.id);
      if (!id || p.confidence < TAG_NOVELTY_THRESHOLD || tagMap.has(id)) continue;
      const themeIds = (p.theme_ids ?? []).map(slugify).filter(t => themeMap.has(t));
      const tag: Tag = {
        id,
        name: p.name?.trim() || id.replace(/_/g, ' '),
        theme_ids: themeIds,
        aliases: (p.aliases ?? []).map(a => a.trim()).filter(Boolean),
        description: p.description?.trim() || `Auto-added tag ${id}.`,
      };
      taxonomy.tags.push(tag);
      tagMap.set(id, tag);
      addedTags++;
    }

    for (const u of asArray<{ id: string; description: string }>(parsed.theme_updates)) {
      const id = slugify(u.id);
      const existing = themeMap.get(id);
      if (!existing || !u.description?.trim()) continue;
      existing.description = u.description.trim();
      updatedDefs++;
    }

    for (const u of asArray<{ id: string; description: string }>(parsed.tag_updates)) {
      const id = slugify(u.id);
      const existing = tagMap.get(id);
      if (!existing || !u.description?.trim()) continue;
      existing.description = u.description.trim();
      updatedDefs++;
    }

    // Collapse primary theme.
    const patch = asArray<ThemeCollapseEntry>(parsed.entries).find(e => e.entry_index === 0);
    const assessment = asArray<ThemeAssessment>(parsed.theme_assessments)[0];

    if (!patch && !assessment) { collapsed.push(entry); continue; }

    const sourceTheme = patch?.primary_theme || entry.primary_theme;
    const primary = slugify(sourceTheme);
    const resolvedPrimary = resolveThemeId(sourceTheme, taxonomy);

    let validPrimary = themeMap.has(primary)
      ? primary
      : (resolvedPrimary && themeMap.has(resolvedPrimary) ? resolvedPrimary : coerceEntryPrimary(entry, taxonomy, themeMap));

    if (assessment) {
      const mathMatch = getClosestThemeByMath(assessment, taxonomy);
      if (mathMatch.closestThemeId && mathMatch.similarity > THEME_COLLAPSE_SIMILARITY && mathMatch.closestThemeId !== validPrimary) {
        validPrimary = mathMatch.closestThemeId;
        collapsedThemes++;
      }
    }

    // Collapse secondary themes.
    const secAssessments = asArray<SecondaryThemeAssessment>(parsed.secondary_theme_assessments);
    const rawSecondaries = patch?.secondary_themes ?? entry.secondary_themes ?? [];
    const secondaries: string[] = [];
    for (const rawTheme of rawSecondaries) {
      const slugged = slugify(rawTheme);
      if (!slugged || slugged === validPrimary) continue;
      if (themeMap.has(slugged)) { secondaries.push(slugged); continue; }
      const llmHint = secAssessments.find(a => slugify(a.original_theme) === slugged);
      const syntheticAssessment: ThemeAssessment = {
        entry_index: 0,
        original_theme: typeof rawTheme === 'string' ? rawTheme : '',
        broadened_theme: llmHint?.closest_taxonomy_theme || (typeof rawTheme === 'string' ? rawTheme : ''),
        broadened_theme_description: '',
        closest_taxonomy_theme: llmHint?.closest_taxonomy_theme || '',
        similarity_confidence: llmHint?.similarity_confidence ?? 0,
      };
      const mathMatch = getClosestThemeByMath(syntheticAssessment, taxonomy);
      if (mathMatch.closestThemeId && mathMatch.similarity > THEME_COLLAPSE_SIMILARITY && mathMatch.closestThemeId !== validPrimary) {
        secondaries.push(mathMatch.closestThemeId);
        collapsedThemes++;
      } else {
        secondaries.push(slugged);
      }
    }

    // Merge tags against taxonomy (Pass 3 — taxonomy is already updated above).
    const rawTags = (patch?.tags ?? entry.tags ?? []).map(slugify);
    const baseTags = rawTags.filter(t => tagMap.has(t));
    const preMergeTags = [...new Set(baseTags.length ? rawTags : entry.tags)];

    const tagAssessments = asArray<TagAssessment>(parsed.tag_assessments);
    const mergeMap = new Map<string, string>();
    for (const a of tagAssessments) {
      const orig = slugify(a.original_tag);
      const target = slugify(a.closest_taxonomy_tag);
      const desc = (typeof a.proposed_description === 'string' && a.proposed_description.trim())
        ? a.proposed_description.trim()
        : orig.replace(/_/g, ' ');
      if (orig && target && tagMap.has(target) && a.similarity_confidence >= TAG_MERGE_CONFIDENCE) {
        // Merge into existing taxonomy tag — update its description with the LLM-merged definition.
        mergeMap.set(orig, target);
        const existingTag = tagMap.get(target)!;
        if (desc) existingTag.description = desc;
        updatedDefs++;
      } else if (orig && !tagMap.has(orig)) {
        // Not similar enough to merge — add as new taxonomy tag using the LLM-written description
        // so subsequent entries can compare against it.
        const autoTag: Tag = {
          id: orig,
          name: orig.replace(/_/g, ' '),
          theme_ids: [validPrimary],
          aliases: [],
          description: desc,
        };
        taxonomy.tags.push(autoTag);
        tagMap.set(orig, autoTag);
        addedTags++;
      }
    }
    const finalTags = [...new Set(preMergeTags.map(t => mergeMap.get(t) ?? t))];
    mergedTags += mergeMap.size;

    // Preserve rationales/confidence/quality across tag renames.
    const oldTags = entry.tags ?? [];
    const oldRationales = entry.tag_rationales ?? {};
    const oldConfTags = entry.confidence?.tags ?? {};
    const oldQualTags = entry.tag_quality?.tags ?? {};

    const newRationales: Record<string, string> = {};
    const newConfTags: Record<string, number> = {};
    const newQualTags: Record<string, number> = {};
    const mappedOldIds = new Set<string>();
    const unmappedNew: string[] = [];

    for (const tag of finalTags) {
      const originalTag = [...mergeMap.entries()].find(([, v]) => v === tag)?.[0] ?? tag;
      const sourceTag = oldTags.includes(tag) ? tag : oldTags.includes(originalTag) ? originalTag : null;
      if (sourceTag) {
        newRationales[tag] = oldRationales[sourceTag] ?? '';
        newConfTags[tag] = oldConfTags[sourceTag] ?? 0;
        newQualTags[tag] = oldQualTags[sourceTag] ?? 0;
        mappedOldIds.add(sourceTag);
      } else {
        unmappedNew.push(tag);
      }
    }
    const unmappedOld = oldTags.filter(t => !mappedOldIds.has(t));
    unmappedNew.forEach((newTag, i) => {
      const oldTag = unmappedOld[i];
      if (oldTag) {
        newRationales[newTag] = oldRationales[oldTag] ?? '';
        newConfTags[newTag] = oldConfTags[oldTag] ?? 0;
        newQualTags[newTag] = oldQualTags[oldTag] ?? 0;
      }
    });

    collapsed.push({
      ...entry,
      primary_theme: validPrimary,
      secondary_themes: [...new Set(secondaries)].slice(0, 2),
      tags: finalTags,
      tag_rationales: newRationales,
      confidence: { primary_theme: entry.confidence?.primary_theme ?? 0, tags: newConfTags },
      tag_quality: { tags: newQualTags },
    });

  }

  return { entries: collapsed, addedThemes, addedTags, updatedDefs, collapsedThemes, mergedTags };
}

