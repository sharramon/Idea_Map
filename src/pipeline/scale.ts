/** Baseline ~1 entry per 1000 words (minimum 1). Not a hard maximum. */
export const DISTINCT_SHIFT_WORDS = 400;

/** Extras beyond the baseline must meet this score and be distinct. */
export const HIGH_CONFIDENCE_THRESHOLD = 0.75;

/** Extras beyond the soft max must be very strong and non-thin. */
export const EXTRA_ENTRY_STRONG_SCORE = 0.9;

/** Evidence shorter than this suggests a thin fragment entry. */
export const MIN_EVIDENCE_EXCERPT_LENGTH = 80;

/** Recommended max tags per entry after verifier tightening. */
export const MAX_TAGS_PER_ENTRY = 5;

/** Secondary themes are optional; max 2. */
export const MAX_SECONDARY_THEMES = 2;
export const PREFERRED_MIN_SECONDARY_THEMES = 0;

/** Tag trimming: combined = confidence * w + quality * (1-w). */
export const TAG_CONFIDENCE_WEIGHT = 0.4;
export const TAG_QUALITY_WEIGHT = 0.6;

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function targetEntryCount(wordCount: number): number {
  return Math.max(1, Math.round(wordCount / 1000));
}

/** Soft guideline — usual max entries for a source length. */
export function softMaxEntries(wordCount: number, targetCount: number): number {
  const byWords = Math.max(1, Math.ceil(wordCount / 800));
  return Math.max(targetCount, byWords);
}

/** Hard ceiling — never exceed this many entries per source. */
export function hardMaxEntries(wordCount: number, targetCount: number): number {
  if (wordCount < 700) return 1;
  if (wordCount < 1200) return 2;
  if (wordCount < 2500) return 4;
  return targetCount + 3;
}
