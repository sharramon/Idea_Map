import { readJson } from './store';
import {
  Taxonomy, Entry, EntriesFile, SourcesFile, AnchorsFile,
  GraphData, GraphNode, GraphEdge, Anchor, GraphSourceMeta, GraphThemeCluster,
} from '../types';

export function getGraph(themeFilter?: string): GraphData {
  const taxonomy = readJson<Taxonomy>('taxonomy.json');
  const { entries } = readJson<EntriesFile>('entries.json');
  const { sources } = readJson<SourcesFile>('sources.json');

  const sourcesById: Record<string, GraphSourceMeta> = {};
  for (const s of sources) {
    sourcesById[s.id] = {
      id: s.id,
      title: s.title,
      created_at: s.created_at,
      raw_text: s.raw_text,
    };
  }

  const globalTagDegree: Record<string, number> = {};
  for (const entry of entries) {
    for (const tag of entry.tags) {
      globalTagDegree[tag] = (globalTagDegree[tag] || 0) + 1;
    }
  }

  const filteredEntries = themeFilter
    ? entries.filter(e => e.primary_theme === themeFilter || e.secondary_themes.includes(themeFilter))
    : entries;

  const knownThemeIds = new Set(taxonomy.themes.map(t => t.id));
  const syntheticThemes = [...new Set(filteredEntries.map(e => e.primary_theme))]
    .filter(id => id && !knownThemeIds.has(id))
    .map(id => ({
      id,
      name: id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      description: 'Synthetic theme generated from entry primary_theme.',
    }));
  const allThemes = [...taxonomy.themes, ...syntheticThemes];

  const usedThemeIds = new Set(filteredEntries.map(e => e.primary_theme));

  const themeClusters: GraphThemeCluster[] = allThemes
    .filter(t => usedThemeIds.has(t.id))
    .map(t => ({ id: t.id, name: t.name }));

  const entryNodes: GraphNode[] = filteredEntries.map(entry => ({
    id: entry.id,
    label: '',
    node_type: 'entry' as const,
    theme: entry.primary_theme,
    secondary_themes: entry.secondary_themes ?? [],
    tags: entry.tags,
    core_idea: entry.core_idea ?? '',
    evidence_excerpt: entry.evidence_excerpt ?? '',
    source_id: entry.source_id,
    connectionCount: entry.tags.length,
  }));

  const usedTagIds = new Set<string>();
  for (const entry of filteredEntries) {
    for (const tag of entry.tags) {
      usedTagIds.add(tag);
    }
  }

  const tagNodes: GraphNode[] = taxonomy.tags
    .filter(t => usedTagIds.has(t.id))
    .map(t => ({
      id: t.id,
      label: t.name,
      node_type: 'tag' as const,
      connectionCount: globalTagDegree[t.id] || 0,
    }));

  // Include tag ids referenced by entries but missing from taxonomy
  for (const tagId of usedTagIds) {
    if (!tagNodes.some(t => t.id === tagId)) {
      tagNodes.push({
        id: tagId,
        label: tagId.replace(/_/g, ' '),
        node_type: 'tag',
        connectionCount: globalTagDegree[tagId] || 0,
      });
    }
  }

  const edges: GraphEdge[] = [];
  for (const entry of filteredEntries) {
    for (const tag of entry.tags) {
      if (usedTagIds.has(tag)) {
        edges.push({
          id: `${entry.id}__${tag}`,
          source: entry.id,
          target: tag,
          relationship: 'tagged',
          explanation: '',
          confidence: entry.confidence.tags[tag] ?? 0.5,
        });
      }
    }
  }

  return {
    nodes: [...entryNodes, ...tagNodes],
    edges,
    themes: allThemes,
    themeClusters,
    sources: sourcesById,
  };
}

export function getNode(entryId: string): Entry | null {
  const { entries } = readJson<EntriesFile>('entries.json');
  return entries.find(e => e.id === entryId) ?? null;
}

export function filterByTheme(themeId: string): Entry[] {
  const { entries } = readJson<EntriesFile>('entries.json');
  return entries.filter(e =>
    e.primary_theme === themeId || e.secondary_themes.includes(themeId),
  );
}

export function getAnchors(): Anchor[] {
  const { anchors } = readJson<AnchorsFile>('anchors.json');
  return anchors;
}
