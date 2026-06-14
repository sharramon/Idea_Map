import { VerifierOutput, combinedTagScore, entryHasRequiredAnchors } from './classification';
import {
  HIGH_CONFIDENCE_THRESHOLD,
  EXTRA_ENTRY_STRONG_SCORE,
  MIN_EVIDENCE_EXCERPT_LENGTH,
  hardMaxEntries,
  softMaxEntries,
} from './scale';

export { HIGH_CONFIDENCE_THRESHOLD, EXTRA_ENTRY_STRONG_SCORE } from './scale';
export { DISTINCT_SHIFT_WORDS } from './scale';

/** Fraction of the smaller tag set shared with the other entry. */
export function tagOverlapRatio(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setA = new Set(a);
  const shared = b.filter(t => setA.has(t)).length;
  return shared / Math.min(a.length, b.length);
}

/**
 * Entries are distinct if they occupy different regions of the map —
 * different tag neighborhoods or clearly different core ideas — even when primary_theme matches.
 */
export function entriesAreDistinct(a: VerifierOutput, b: VerifierOutput): boolean {
  const overlap = tagOverlapRatio(a.tags ?? [], b.tags ?? []);
  const aCore = (a.core_idea ?? '').trim().toLowerCase();
  const bCore = (b.core_idea ?? '').trim().toLowerCase();
  const differentCore = Boolean(aCore && bCore && aCore !== bCore);

  if (overlap < 0.34) return true;

  // Sibling splits from one source may share bridge tags — core_idea still separates them.
  if (overlap >= 0.5) return differentCore;

  if (differentCore) return true;

  if (a.primary_theme !== b.primary_theme && overlap === 0) return true;

  return false;
}

export function averageTagScore(entry: VerifierOutput): number {
  const tags = entry.tags ?? [];
  if (!tags.length) return entry.confidence?.primary_theme ?? 0;
  return tags.reduce((sum, t) => sum + combinedTagScore(entry, t), 0) / tags.length;
}

export function entryScore(entry: VerifierOutput): number {
  const primaryConf = entry.confidence?.primary_theme ?? 0;
  return primaryConf * 0.3 + averageTagScore(entry) * 0.7;
}

/** Thin entries are likely scene fragments rather than standalone map nodes. */
export function isThinEntry(entry: VerifierOutput): boolean {
  const tagCount = entry.tags?.length ?? 0;
  const evidenceLen = (entry.evidence_excerpt ?? '').trim().length;
  return tagCount < 3 || evidenceLen < MIN_EVIDENCE_EXCERPT_LENGTH;
}

/**
 * Ranking used by the flexible cap. It intentionally differs from raw confidence:
 * it rewards broad, well-grounded standalone nodes and penalizes thin fragments.
 */
export function capRankScore(entry: VerifierOutput): number {
  let score = entryScore(entry);
  const tags = entry.tags ?? [];
  const evidenceLen = (entry.evidence_excerpt ?? '').trim().length;

  if (!entryHasRequiredAnchors(entry)) score -= 0.25;

  if (tags.length >= 3) score += 0.03;
  if (tags.length >= 4) score += 0.02;
  if (tags.length <= 2) score -= 0.06;

  if (evidenceLen >= MIN_EVIDENCE_EXCERPT_LENGTH) score += 0.02;
  if (evidenceLen >= 180) score += 0.02;
  if (evidenceLen < MIN_EVIDENCE_EXCERPT_LENGTH) score -= 0.10;

  if (isThinEntry(entry)) score -= 0.06;

  const candidates = entry.theme_candidates ?? [];
  if (candidates.length >= 2) score += 0.03;
  const highCentrality = candidates.filter(c => c.centrality >= 0.75).length;
  score += Math.min(highCentrality * 0.02, 0.06);
  if (candidates.some(c => c.theme === entry.primary_theme && c.should_be_own_entry)) {
    score += 0.02;
  }

  return Math.max(0, Math.min(1, score));
}

/**
 * Keep the best baseline entries, then allow extras up to soft/hard caps only when strong and distinct.
 */
export function applyFlexibleCap(
  entries: VerifierOutput[],
  target: number,
  wordCount: number,
): {
  kept: VerifierOutput[];
  dropped: number;
  keptExtra: number;
  droppedThin: number;
} {
  const softMax = softMaxEntries(wordCount, target);
  const hardMax = hardMaxEntries(wordCount, target);

  if (entries.length <= target) {
    return { kept: entries, dropped: 0, keptExtra: 0, droppedThin: 0 };
  }

  const sorted = [...entries].sort((a, b) => capRankScore(b) - capRankScore(a));
  const kept: VerifierOutput[] = [];
  let droppedThin = 0;

  for (const entry of sorted) {
    if (kept.length >= hardMax) continue;

    if (kept.length < target) {
      kept.push(entry);
      continue;
    }

    if (!entryHasRequiredAnchors(entry)) continue;
    if (!kept.every(k => entriesAreDistinct(k, entry))) continue;

    const score = capRankScore(entry);
    const thin = isThinEntry(entry);

    if (kept.length >= softMax) {
      if (score < EXTRA_ENTRY_STRONG_SCORE || thin) {
        if (thin) droppedThin++;
        continue;
      }
    } else if (score < HIGH_CONFIDENCE_THRESHOLD || (thin && score < EXTRA_ENTRY_STRONG_SCORE)) {
      if (thin) droppedThin++;
      continue;
    }

    kept.push(entry);
  }

  const keptExtra = Math.max(0, kept.length - target);
  return { kept, dropped: entries.length - kept.length, keptExtra, droppedThin };
}
