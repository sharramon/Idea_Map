import { LLMClient } from '../llm/client';
import { Taxonomy, Entry } from '../types';
import { MAX_SECONDARY_THEMES, softMaxEntries } from './scale';
import { parseLlmJsonArray } from './parseLlmJson';
import { ExtractorOutput, OWN_ENTRY_CENTRALITY_THRESHOLD, ensureMinimumThemeCandidates } from './classification';
import { buildExtractorSystemPrompt } from './prompts';

const SYSTEM_PROMPT = buildExtractorSystemPrompt({
  maxSecondaryThemes: MAX_SECONDARY_THEMES,
  ownEntryCentralityThreshold: OWN_ENTRY_CENTRALITY_THRESHOLD,
});

function buildScaleUserMessage(wordCount: number, targetCount: number): string[] {
  const lines = [
    '## Scale',
    `Source length: ${wordCount} words`,
    `Baseline guideline: ~${targetCount} entr${targetCount === 1 ? 'y' : 'ies'} — NOT a hard cap in recall mode`,
    'Recall mode: when uncertain between 1 broad entry vs 2 narrower entries, propose 2. The verifier merges later if too fine.',
    'Do NOT hide a second central theme as secondary_theme — propose a separate JSON array entry first.',
  ];

  if (wordCount >= 700 && wordCount < 1200) {
    lines.push(
      `Split check: if source-level scan finds ≥2 distinct themes with centrality ≥${OWN_ENTRY_CENTRALITY_THRESHOLD}, return 2+ JSON array entries (each must have should_be_own_entry: true).`,
      'Do NOT list qualifying themes only inside theme_candidates on a single object.',
    );
  }

  if (wordCount >= 1200 && wordCount < 2500) {
    lines.push(
      `Medium source: baseline ~${targetCount} entries. Scan for sustained section shifts (different answers to "what is this about?").`,
      `If ≥2 themes reach centrality ≥${OWN_ENTRY_CENTRALITY_THRESHOLD}, return separate JSON array entries — not one object with many theme_candidates.`,
    );
  }

  if (wordCount >= 2500) {
    const softMax = softMaxEntries(wordCount, targetCount);
    lines.push(
      `Long source (${wordCount} words): propose at least ${targetCount} entries; recall mode may propose up to ~${softMax} when sections have distinct ontological centers.`,
      'Typical splits: historical survey vs systemic critique vs meta-game/prescription vs philosophical digression vs closing vision — when each could recur as its own map node.',
      'Do NOT collapse the whole essay into 1–2 catch-all summaries. Prefer over-proposing; verifier merges if too fine.',
      `Hard split bias: themes at centrality ≥${OWN_ENTRY_CENTRALITY_THRESHOLD} with distinct evidence → separate JSON entries with should_be_own_entry: true.`,
    );
  }

  return lines;
}

export async function extractEntries(
  client: LLMClient,
  sourceText: string,
  taxonomy: Taxonomy,
  existingEntries: Entry[],
  targetCount: number,
  wordCount: number,
): Promise<ExtractorOutput[]> {
  const existingSummary = existingEntries.length > 0
    ? JSON.stringify(existingEntries.map(e => ({
        id: e.id,
        core_idea: e.core_idea,
        primary_theme: e.primary_theme,
        tags: e.tags,
      })), null, 2)
    : 'None yet.';

  const userMessage = [
    ...buildScaleUserMessage(wordCount, targetCount),
    '',
    '## Taxonomy',
    JSON.stringify(taxonomy, null, 2),
    '',
    '## Existing Entries (do not duplicate the same core pattern)',
    existingSummary,
    '',
    '## Source Text',
    sourceText,
  ].join('\n');

  const text = await client.complete(SYSTEM_PROMPT, userMessage, 16384);
  const parsed = parseLlmJsonArray(text) as ExtractorOutput[];
  return parsed.map(entry => ({
    ...entry,
    theme_candidates: ensureMinimumThemeCandidates(
      entry.theme_candidates,
      entry.primary_theme,
      entry.confidence?.primary_theme ?? 0,
      entry.evidence_excerpt ?? '',
    ),
  }));
}
