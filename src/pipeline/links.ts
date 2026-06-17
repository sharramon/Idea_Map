import { Entry, Link } from '../types';

const MIN_LINK_SCORE = 0.34;

function sharedCount(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setA = new Set(a);
  return b.filter(x => setA.has(x)).length;
}

function overlapRatio(a: string[], b: string[]): number {
  const shared = sharedCount(a, b);
  if (!shared) return 0;
  return shared / Math.min(a.length, b.length);
}

function inferRelationship(a: Entry, b: Entry, sharedTags: number): Link['relationship'] {
  if (a.primary_theme === b.primary_theme && sharedTags >= 2) {
    return 'supports';
  }
  return 'analogous_to';
}

function linkConfidence(a: Entry, b: Entry, sharedTags: number): number {
  const tagOverlap = overlapRatio(a.tags, b.tags);
  const samePrimary = a.primary_theme === b.primary_theme ? 0.2 : 0;
  const secondaryThemeOverlap = sharedCount(a.secondary_themes ?? [], b.secondary_themes ?? []);
  const secondaryBoost = Math.min(secondaryThemeOverlap * 0.08, 0.16);
  const tagBoost = Math.min(sharedTags * 0.08, 0.24);
  return Math.max(0, Math.min(0.95, 0.35 + tagOverlap * 0.35 + samePrimary + secondaryBoost + tagBoost));
}

function explainRelationship(a: Entry, b: Entry, sharedTags: string[]): string {
  const sharedThemes: string[] = [];
  if (a.primary_theme === b.primary_theme) sharedThemes.push(`primary:${a.primary_theme}`);
  const secOverlap = (a.secondary_themes ?? []).filter(t => (b.secondary_themes ?? []).includes(t));
  secOverlap.forEach(t => sharedThemes.push(`secondary:${t}`));

  const details: string[] = [];
  if (sharedTags.length) details.push(`shared tags: ${sharedTags.join(', ')}`);
  if (sharedThemes.length) details.push(`shared themes: ${sharedThemes.join(', ')}`);
  return details.length ? details.join(' | ') : 'semantic neighborhood overlap';
}

export interface LinkBuildResult {
  links: Link[];
  entriesWithRelatedIds: Entry[];
}

function linkKey(aId: string, bId: string): string {
  return aId < bId ? `${aId}::${bId}` : `${bId}::${aId}`;
}

function toRelated(entries: Entry[], links: Link[]): Entry[] {
  const related = new Map<string, Set<string>>();
  entries.forEach(e => related.set(e.id, new Set<string>()));
  for (const link of links) {
    related.get(link.from_entry_id)?.add(link.to_entry_id);
    related.get(link.to_entry_id)?.add(link.from_entry_id);
  }
  return entries.map(entry => ({
    ...entry,
    related_entry_ids: Array.from(related.get(entry.id) ?? []).sort(),
  }));
}

function evaluatePair(a: Entry, b: Entry): Link | null {
  const sharedTags = a.tags.filter(t => b.tags.includes(t));
  const sharedTagCount = sharedTags.length;
  const samePrimary = a.primary_theme === b.primary_theme;
  const secOverlap = sharedCount(a.secondary_themes ?? [], b.secondary_themes ?? []);

  const score = overlapRatio(a.tags, b.tags) + (samePrimary ? 0.18 : 0) + secOverlap * 0.08;
  if (score < MIN_LINK_SCORE) return null;

  const from = a.id < b.id ? a : b;
  const to = a.id < b.id ? b : a;
  return {
    id: `link_${from.id}__${to.id}`,
    from_entry_id: from.id,
    to_entry_id: to.id,
    relationship: inferRelationship(a, b, sharedTagCount),
    explanation: explainRelationship(a, b, sharedTags),
    confidence: linkConfidence(a, b, sharedTagCount),
  };
}

export function updateLinksIncremental(
  entries: Entry[],
  existingLinks: Link[],
  changedEntryIds: string[],
): LinkBuildResult {
  const byId = new Map(entries.map(e => [e.id, e]));
  const changed = new Set(changedEntryIds);
  const ids = Array.from(byId.keys());

  const linkMap = new Map<string, Link>();
  for (const link of existingLinks) {
    if (!byId.has(link.from_entry_id) || !byId.has(link.to_entry_id)) continue;
    if (changed.has(link.from_entry_id) || changed.has(link.to_entry_id)) continue;
    linkMap.set(linkKey(link.from_entry_id, link.to_entry_id), link);
  }

  for (const changedId of changed) {
    const a = byId.get(changedId);
    if (!a) continue;
    for (const otherId of ids) {
      if (otherId === changedId) continue;
      const b = byId.get(otherId);
      if (!b) continue;
      const key = linkKey(changedId, otherId);
      const next = evaluatePair(a, b);
      if (next) linkMap.set(key, next);
      else linkMap.delete(key);
    }
  }

  const links = Array.from(linkMap.values()).sort((a, b) => a.id.localeCompare(b.id));
  return { links, entriesWithRelatedIds: toRelated(entries, links) };
}

export function rebuildLinks(entries: Entry[]): LinkBuildResult {
  const links: Link[] = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const link = evaluatePair(entries[i], entries[j]);
      if (link) links.push(link);
    }
  }

  links.sort((a, b) => a.id.localeCompare(b.id));
  return { links, entriesWithRelatedIds: toRelated(entries, links) };
}
