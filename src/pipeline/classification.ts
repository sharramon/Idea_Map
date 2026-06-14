import {
  MAX_TAGS_PER_ENTRY,
  MAX_SECONDARY_THEMES,
  TAG_CONFIDENCE_WEIGHT,
  TAG_QUALITY_WEIGHT,
} from './scale';
import { Taxonomy, Entry } from '../types';

export interface ClassificationConfidence {
  primary_theme: number;
  tags: Record<string, number>;
}

export interface ThemeCandidate {
  theme: string;
  evidence_excerpt: string;
  centrality: number;
  reason: string;
  should_be_own_entry: boolean;
}

export interface ExtractorOutput {
  core_idea: string;
  evidence_excerpt: string;
  theme_candidates: ThemeCandidate[];
  split_decision: string;
  primary_theme: string;
  secondary_themes: string[];
  tags: string[];
  tag_rationales: Record<string, string>;
  confidence: ClassificationConfidence;
}

export interface VerifierOutput extends ExtractorOutput {
  tag_quality: { tags: Record<string, number> };
  is_duplicate: boolean;
  duplicate_of: string | null;
}

/** Centrality at or above this → should_be_own_entry is true; cannot be vetoed to false. */
export const OWN_ENTRY_CENTRALITY_THRESHOLD = 0.75;

export function deriveShouldBeOwnEntry(centrality: number): boolean {
  return centrality >= OWN_ENTRY_CENTRALITY_THRESHOLD;
}

export function normalizeThemeCandidates(raw: unknown): ThemeCandidate[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(c => {
    const item = c as Partial<ThemeCandidate>;
    const centrality = typeof item.centrality === 'number' ? item.centrality : 0;
    return {
      theme: item.theme ?? '',
      evidence_excerpt: item.evidence_excerpt ?? '',
      centrality,
      reason: item.reason ?? '',
      should_be_own_entry: deriveShouldBeOwnEntry(centrality),
    };
  }).filter(c => c.theme.trim());
}

/** Distinct themes with centrality ≥ threshold across proposed/verified entries. */
export function countQualifyingSplitThemes(
  entries: ExtractorOutput[],
  centralityThreshold = OWN_ENTRY_CENTRALITY_THRESHOLD,
): number {
  const seen = new Set<string>();
  for (const entry of entries) {
    for (const c of normalizeThemeCandidates(entry.theme_candidates)) {
      if (c.centrality >= centralityThreshold && !seen.has(c.theme)) {
        seen.add(c.theme);
      }
    }
  }
  return seen.size;
}

/** @deprecated alias — use countQualifyingSplitThemes */
export function countOwnEntryCandidates(
  proposed: ExtractorOutput[],
  centralityThreshold = OWN_ENTRY_CENTRALITY_THRESHOLD,
): number {
  return countQualifyingSplitThemes(proposed, centralityThreshold);
}

export function qualifyingSplitThemeIds(
  entries: ExtractorOutput[],
  centralityThreshold = OWN_ENTRY_CENTRALITY_THRESHOLD,
): string[] {
  const seen = new Set<string>();
  const themes: string[] = [];
  for (const entry of entries) {
    for (const c of normalizeThemeCandidates(entry.theme_candidates)) {
      if (c.centrality >= centralityThreshold && !seen.has(c.theme)) {
        seen.add(c.theme);
        themes.push(c.theme);
      }
    }
  }
  return themes;
}

export function combinedTagScore(entry: VerifierOutput, tag: string): number {
  const conf = entry.confidence?.tags?.[tag] ?? entry.confidence?.primary_theme ?? 0;
  const qual = entry.tag_quality?.tags?.[tag] ?? conf;
  return TAG_CONFIDENCE_WEIGHT * conf + TAG_QUALITY_WEIGHT * qual;
}

export function entryHasRequiredAnchors(entry: VerifierOutput): boolean {
  if (!entry.core_idea?.trim()) return false;
  if (!entry.evidence_excerpt?.trim()) return false;
  if (!entry.split_decision?.trim()) return false;
  if (!entry.theme_candidates?.length) return false;
  if (!entry.theme_candidates.every(c => c.theme?.trim() && c.evidence_excerpt?.trim() && c.reason?.trim())) {
    return false;
  }
  const rationales = entry.tag_rationales ?? {};
  return (entry.tags ?? []).every(t => Boolean(rationales[t]?.trim()));
}

export function trimClassification(entry: VerifierOutput): VerifierOutput {
  const primaryConf = entry.confidence?.primary_theme ?? 0;
  const confidenceTags = entry.confidence?.tags ?? {};
  const qualityTags = entry.tag_quality?.tags ?? {};
  const rationales = entry.tag_rationales ?? {};

  const uniqueTags = [...new Set(entry.tags ?? [])].filter(Boolean);
  const tags = uniqueTags
    .sort((a, b) => combinedTagScore(entry, b) - combinedTagScore(entry, a))
    .slice(0, MAX_TAGS_PER_ENTRY);

  const secondaryThemes = [...new Set(
    (entry.secondary_themes ?? []).filter(t => t && t !== entry.primary_theme),
  )].slice(0, MAX_SECONDARY_THEMES);

  return {
    ...entry,
    core_idea: entry.core_idea ?? '',
    evidence_excerpt: entry.evidence_excerpt ?? '',
    theme_candidates: normalizeThemeCandidates(entry.theme_candidates),
    split_decision: entry.split_decision ?? '',
    secondary_themes: secondaryThemes,
    tags,
    tag_rationales: Object.fromEntries(tags.map(t => [t, rationales[t] ?? ''])),
    confidence: {
      primary_theme: primaryConf,
      tags: Object.fromEntries(tags.map(t => [t, confidenceTags[t] ?? primaryConf])),
    },
    tag_quality: {
      tags: Object.fromEntries(tags.map(t => [t, qualityTags[t] ?? confidenceTags[t] ?? primaryConf])),
    },
    is_duplicate: entry.is_duplicate ?? false,
    duplicate_of: entry.duplicate_of ?? null,
  };
}

function slugifyTagId(raw: string): string {
  return raw.trim().toLowerCase().replace(/-/g, '_');
}

/** Map a tag string to a taxonomy id, or null if unknown. */
export function resolveTagId(raw: string, taxonomy: Taxonomy): string | null {
  const slug = slugifyTagId(raw);
  for (const tag of taxonomy.tags) {
    if (tag.id === slug) return tag.id;
    if (slugifyTagId(tag.name) === slug) return tag.id;
    if (tag.aliases.some(a => slugifyTagId(a) === slug)) return tag.id;
  }
  return null;
}

/** Apply verifier post-processing before persisting to entries.json. */
export function finalizeEntryForStorage(
  entry: VerifierOutput | Entry,
  taxonomy: Taxonomy,
): Entry {
  const trimmed = trimClassification(entry as VerifierOutput);
  const themeIds = new Set(taxonomy.themes.map(t => t.id));

  const resolvedTags: string[] = [];
  const rationales: Record<string, string> = {};
  const confidenceTags: Record<string, number> = {};
  const qualityTags: Record<string, number> = {};

  for (const rawTag of trimmed.tags) {
    const id = resolveTagId(rawTag, taxonomy);
    if (!id || resolvedTags.includes(id)) continue;
    resolvedTags.push(id);
    rationales[id] = trimmed.tag_rationales[rawTag] ?? trimmed.tag_rationales[id] ?? '';
    confidenceTags[id] = trimmed.confidence?.tags?.[rawTag] ?? trimmed.confidence?.tags?.[id]
      ?? trimmed.confidence?.primary_theme ?? 0;
    qualityTags[id] = trimmed.tag_quality?.tags?.[rawTag] ?? trimmed.tag_quality?.tags?.[id]
      ?? confidenceTags[id];
  }

  // Keep unresolved tags (slugified) if taxonomy resolution would drop below minimum.
  if (resolvedTags.length < 2) {
    for (const rawTag of trimmed.tags) {
      const slug = slugifyTagId(rawTag);
      if (!slug || resolvedTags.includes(slug)) continue;
      resolvedTags.push(slug);
      rationales[slug] = trimmed.tag_rationales[rawTag] ?? trimmed.tag_rationales[slug] ?? '';
      confidenceTags[slug] = trimmed.confidence?.tags?.[rawTag] ?? trimmed.confidence?.primary_theme ?? 0;
      qualityTags[slug] = trimmed.tag_quality?.tags?.[rawTag] ?? confidenceTags[slug];
      if (resolvedTags.length >= MAX_TAGS_PER_ENTRY) break;
    }
  }

  const tags = resolvedTags.slice(0, MAX_TAGS_PER_ENTRY);
  const primaryTheme = trimmed.primary_theme;

  const secondaryThemes = [...new Set(
    (trimmed.secondary_themes ?? []).filter(t => t && t !== primaryTheme && themeIds.has(t)),
  )].slice(0, MAX_SECONDARY_THEMES);

  const base = entry as Entry;
  return {
    id: base.id,
    source_id: base.source_id,
    core_idea: trimmed.core_idea,
    evidence_excerpt: trimmed.evidence_excerpt,
    primary_theme: primaryTheme,
    secondary_themes: secondaryThemes,
    tags,
    tag_rationales: Object.fromEntries(tags.map(t => [t, rationales[t] ?? ''])),
    confidence: {
      primary_theme: trimmed.confidence?.primary_theme ?? 0,
      tags: Object.fromEntries(tags.map(t => [t, confidenceTags[t] ?? 0])),
    },
    tag_quality: {
      tags: Object.fromEntries(tags.map(t => [t, qualityTags[t] ?? 0])),
    },
    related_entry_ids: base.related_entry_ids ?? [],
  };
}
