import { LLMClient } from '../llm/client';
import { Taxonomy } from '../types';
import { VerifierOutput } from './classification';

interface RemapThemeProposal {
  id: string;
  name: string;
  description: string;
  confidence: number;
}

interface RemapTagProposal {
  id: string;
  name: string;
  description: string;
  theme_ids: string[];
  aliases: string[];
  confidence: number;
}

interface RemapEntry {
  entry_index: number;
  primary_theme: string;
  secondary_themes: string[];
  tags: string[];
}

interface RemapOutput {
  entries: RemapEntry[];
  new_themes: RemapThemeProposal[];
  new_tags: RemapTagProposal[];
  theme_updates: Array<{ id: string; description: string }>;
  tag_updates: Array<{ id: string; description: string }>;
}

const THEME_NOVELTY_THRESHOLD = 0.7;
const TAG_NOVELTY_THRESHOLD = 0.5;

const SYSTEM_PROMPT = `You are a strict remapping classifier.

Task:
Given verified entries + current taxonomy, remap ONLY primary_theme/secondary_themes/tags.

Rules:
1) Prefer existing taxonomy ids.
2) Add a NEW THEME only when truly novel and confidence >= 0.7.
3) Add a NEW TAG only when truly novel and confidence >= 0.5.
4) If an existing id can represent the concept, collapse to existing id instead of creating new.
5) You may propose description updates when a merged concept broadens scope.
6) Keep entry count unchanged. Only remap labels.
7) Preserve map utility: primary theme should stay broad; tags can be more specific.

Return JSON object with keys:
entries, new_themes, new_tags, theme_updates, tag_updates.
No markdown.`;

function slugify(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function extractJsonObject(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1].trim() : text.trim();
  const start = raw.indexOf('{');
  if (start === -1) throw new Error('No JSON object found in remap response');
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
  throw new Error('Unbalanced JSON object in remap response');
}

export async function remapEntriesAndTaxonomy(
  client: LLMClient,
  rawText: string,
  entries: VerifierOutput[],
  taxonomy: Taxonomy,
): Promise<{ entries: VerifierOutput[]; addedThemes: number; addedTags: number; updatedDefs: number }> {
  if (!entries.length) return { entries, addedThemes: 0, addedTags: 0, updatedDefs: 0 };

  const user = [
    '## Thresholds',
    `New theme threshold: ${THEME_NOVELTY_THRESHOLD}`,
    `New tag threshold: ${TAG_NOVELTY_THRESHOLD}`,
    '',
    '## Raw text',
    rawText,
    '',
    '## Taxonomy',
    JSON.stringify(taxonomy, null, 2),
    '',
    '## Verified entries',
    JSON.stringify(entries, null, 2),
  ].join('\n');

  const text = await client.complete(SYSTEM_PROMPT, user, 8192);
  const parsed = JSON.parse(extractJsonObject(text)) as Partial<RemapOutput>;

  const themeMap = new Map(taxonomy.themes.map(t => [t.id, t]));
  const tagMap = new Map((taxonomy.tags as any[]).map(t => [t.id, t]));
  let addedThemes = 0;
  let addedTags = 0;
  let updatedDefs = 0;

  for (const p of asArray<RemapThemeProposal>(parsed.new_themes)) {
    const id = slugify(p.id);
    if (!id || p.confidence < THEME_NOVELTY_THRESHOLD || themeMap.has(id)) continue;
    const theme = { id, name: p.name?.trim() || id.replace(/_/g, ' '), description: p.description?.trim() || `Auto-added theme ${id}.` };
    taxonomy.themes.push(theme);
    themeMap.set(id, theme);
    addedThemes++;
  }

  for (const p of asArray<RemapTagProposal>(parsed.new_tags)) {
    const id = slugify(p.id);
    if (!id || p.confidence < TAG_NOVELTY_THRESHOLD || tagMap.has(id)) continue;
    const themeIds = (p.theme_ids ?? []).map(slugify).filter(t => themeMap.has(t));
    const tag = {
      id,
      name: p.name?.trim() || id.replace(/_/g, ' '),
      ids: themeIds,
      aliases: (p.aliases ?? []).map(a => a.trim()).filter(Boolean),
      description: p.description?.trim() || `Auto-added tag ${id}.`,
    };
    (taxonomy.tags as any[]).push(tag);
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

  const remapped = entries.map((entry, idx) => {
    const patch = asArray<RemapEntry>(parsed.entries).find(e => e.entry_index === idx);
    if (!patch) return entry;
    const primary = slugify(patch.primary_theme || entry.primary_theme);
    const validPrimary = themeMap.has(primary) ? primary : entry.primary_theme;
    const secondaries = (patch.secondary_themes ?? [])
      .map(slugify)
      .filter(t => t !== validPrimary && themeMap.has(t));
    const tags = (patch.tags ?? [])
      .map(slugify)
      .filter(t => tagMap.has(t));
    return {
      ...entry,
      primary_theme: validPrimary,
      secondary_themes: [...new Set(secondaries)].slice(0, 2),
      tags: [...new Set(tags.length ? tags : entry.tags)],
    };
  });

  return { entries: remapped, addedThemes, addedTags, updatedDefs };
}

