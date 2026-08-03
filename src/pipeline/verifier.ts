import { LLMClient } from '../llm/client';
import { Taxonomy } from '../types';
import { ExtractorOutput, VerifierOutput, normalizeThemeCandidates, ensureMinimumThemeCandidates, countQualifyingSplitThemes, qualifyingSplitThemeIds, OWN_ENTRY_CENTRALITY_THRESHOLD } from './classification';
import { parseLlmJsonArray } from './parseLlmJson';
import { MAX_SECONDARY_THEMES, MAX_TAGS_PER_ENTRY, softMaxEntries } from './scale';
import { buildVerifierSystemPrompt } from './prompts';

export { VerifierOutput };

export interface ExistingEntrySummary {
  id: string;
  core_idea: string;
  primary_theme: string;
  tags: string[];
}

export async function verifyEntries(
  client: LLMClient,
  rawText: string,
  proposed: ExtractorOutput[],
  taxonomy: Taxonomy,
  existingEntrySummaries: ExistingEntrySummary[],
  conservatism: number,
  targetCount: number,
  wordCount: number,
): Promise<VerifierOutput[]> {
  const systemPrompt = buildVerifierSystemPrompt({
    conservatism,
    maxSecondaryThemes: MAX_SECONDARY_THEMES,
    maxTagsPerEntry: MAX_TAGS_PER_ENTRY,
    ownEntryCentralityThreshold: OWN_ENTRY_CENTRALITY_THRESHOLD,
  });

  const normalizedProposed = proposed.map(p => ({
    ...p,
    theme_candidates: normalizeThemeCandidates(p.theme_candidates),
  }));
  const allowedThemeIds = Array.from(new Set(
    normalizedProposed.flatMap(p => p.theme_candidates.map(c => c.theme)).filter(Boolean),
  ));
  const qualifyingSplitCount = countQualifyingSplitThemes(normalizedProposed);
  const qualifyingThemes = qualifyingSplitThemeIds(normalizedProposed);

  const userMessage = [
    '## Instructions',
    'Proposed entries below are recall-oriented hypotheses — likely over-split. Do NOT rubber-stamp.',
    'WORKFLOW ORDER: (1) YOUR split audit from raw_text with proof → (2) split/merge decision → (3) per-entry themes/tags → (4) tag check pass.',
    'Default posture: MERGE over-proposals after audit. Split only when YOUR audit confirms a strong split case (≥2 qualifying themes, distinct evidence, no single-essay exception).',
    'Re-score centrality yourself — do not inherit extractor scores blindly.',
    'Before returning: run the final tag check pass on every entry — prefer taxonomy ids, bridge to tags already in the corpus, reuse shared tags across sibling entries from this source, collapse near-duplicates, normalize to snake_case.',
    '',
    '## Scale',
    `Source length: ${wordCount} words`,
    `Baseline guideline: ~${targetCount} entr${targetCount === 1 ? 'y' : 'ies'} — verifier decides final count from raw_text`,
    `Proposed entries: ${proposed.length}. You may return more or fewer after rewrite/merge/split/reject.`,
    `Tags: max ${MAX_TAGS_PER_ENTRY} per entry after quality filter; min 2`,
    ...(proposed.length >= 2
      ? [
          `[Over-proposal — merge default after audit] Extractor proposed ${proposed.length} entries. Run YOUR split audit first.`,
          'DEFAULT: merge unless YOUR audit confirms strong split case (≥2 themes at centrality ≥ threshold with distinct sustained evidence; single-essay exception does not apply).',
          'Merge if proposals are rhetorical movements, tone shifts, or generic-theme relabelings of one essay.',
        ]
      : []),
    ...(qualifyingSplitCount >= 2
      ? [
          `[Split signal — verify, do not rubber-stamp] Extractor claimed ${qualifyingSplitCount} themes at centrality ≥${OWN_ENTRY_CENTRALITY_THRESHOLD}: ${qualifyingThemes.join(', ')}.`,
          'Re-score in YOUR audit. If YOU confirm strong split case → split (proof beats merge bias). If themes are facets of one arc → merge despite extractor scores.',
          'Do NOT absorb confirmed qualifying themes into secondary_themes to avoid splitting.',
        ]
      : []),
    ...(proposed.length < targetCount && wordCount >= 2000
      ? [
          `[Under-proposal check] Extractor returned ${proposed.length} but baseline for ${wordCount} words is ~${targetCount} (soft max ~${softMaxEntries(wordCount, targetCount)}).`,
          'Perform your own split check from raw_text. Long essays with multiple sustained sections should not collapse into 1–2 catch-all entries.',
          'Split when sections answer "what is this about?" differently — e.g. construction thesis vs historical critique vs meta-game vs subjectivity vs prescription.',
          'Do NOT merge distinct sections just because they share observations/philosophy as generic primary labels.',
        ]
      : []),
    '',
    '## raw_text (SOURCE OF TRUTH)',
    'Verify all classifications against this text. Proposed entries below are hypotheses only.',
    '',
    rawText,
    '',
    '## Taxonomy',
    JSON.stringify(taxonomy, null, 2),
    '',
    '## Existing Stored Entries (duplicate detection only — other sources)',
    existingEntrySummaries.length > 0
      ? JSON.stringify(existingEntrySummaries, null, 2)
      : 'None yet.',
    '',
    '## Proposed Classifications (extractor output — verify, do not rubber-stamp)',
    JSON.stringify(normalizedProposed, null, 2),
    '',
    '## Allowed Extractor Theme IDs (closed set, MUST obey)',
    allowedThemeIds.length ? allowedThemeIds.join(', ') : 'none',
  ].join('\n');

  const text = await client.complete(systemPrompt, userMessage, 16384);
  const raw = parseLlmJsonArray(text) as VerifierOutput[];
  return raw.map(e => ({
    ...e,
    theme_candidates: ensureMinimumThemeCandidates(
      normalizeThemeCandidates(e.theme_candidates),
      e.primary_theme,
      e.confidence?.primary_theme ?? 0,
      e.evidence_excerpt ?? '',
    ),
    split_decision: e.split_decision ?? '',
    tag_quality: e.tag_quality ?? { tags: {} },
    is_duplicate: e.is_duplicate ?? false,
    duplicate_of: e.duplicate_of ?? null,
  }));
}
