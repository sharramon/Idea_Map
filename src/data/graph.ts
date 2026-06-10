import { readJson } from './store';
import {
  Taxonomy, Entry, EntriesFile, LinksFile, AnchorsFile,
  GraphData, GraphNode, GraphEdge, Anchor,
} from '../types';

export function getGraph(themeFilter?: string): GraphData {
  const taxonomy = readJson<Taxonomy>('taxonomy.json');
  const { entries } = readJson<EntriesFile>('entries.json');
  const { links } = readJson<LinksFile>('links.json');

  // Compute connection counts from links (not stored — derived at load time)
  const connectionCounts: Record<string, number> = {};
  for (const link of links) {
    connectionCounts[link.from_entry_id] = (connectionCounts[link.from_entry_id] || 0) + 1;
    connectionCounts[link.to_entry_id] = (connectionCounts[link.to_entry_id] || 0) + 1;
  }

  const filteredEntries = themeFilter
    ? entries.filter(e => e.primary_theme === themeFilter || e.secondary_themes.includes(themeFilter))
    : entries;

  const entryIds = new Set(filteredEntries.map(e => e.id));

  const nodes: GraphNode[] = filteredEntries.map(entry => ({
    id: entry.id,
    label: entry.core_idea.length > 65 ? entry.core_idea.slice(0, 65) + '…' : entry.core_idea,
    theme: entry.primary_theme,
    tags: entry.tags,
    connectionCount: connectionCounts[entry.id] || 0,
    core_idea: entry.core_idea,
    expanded_summary: entry.expanded_summary,
  }));

  const edges: GraphEdge[] = links
    .filter(l => entryIds.has(l.from_entry_id) && entryIds.has(l.to_entry_id))
    .map(l => ({
      id: l.id,
      source: l.from_entry_id,
      target: l.to_entry_id,
      relationship: l.relationship,
      explanation: l.explanation,
      confidence: l.confidence,
    }));

  return { nodes, edges, themes: taxonomy.themes };
}

export function getNode(entryId: string): Entry | null {
  const { entries } = readJson<EntriesFile>('entries.json');
  return entries.find(e => e.id === entryId) ?? null;
}

export function filterByTheme(themeId: string): Entry[] {
  const { entries } = readJson<EntriesFile>('entries.json');
  return entries.filter(e =>
    e.primary_theme === themeId || e.secondary_themes.includes(themeId)
  );
}

export function getAnchors(): Anchor[] {
  const { anchors } = readJson<AnchorsFile>('anchors.json');
  return anchors;
}
