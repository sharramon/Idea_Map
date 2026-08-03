export interface Theme {
  id: string;
  name: string;
  description: string;
}

export interface Tag {
  id: string;
  name: string;
  theme_ids: string[];
  aliases: string[];
  description: string;
}

export interface Taxonomy {
  themes: Theme[];
  tags: Tag[];
}

export interface Source {
  id: string;
  type: 'source';
  source_type: 'manual_diary_text' | 'transcript' | 'audio' | 'video';
  created_at: string;
  title: string;
  summary: string;
  raw_text_path: string;
  content_hash: string;
  child_entry_ids: string[];
}

export interface SourcesFile {
  sources: Source[];
}

export interface ThemeCandidate {
  theme: string;
  evidence_excerpt: string;
  centrality: number;
  reason: string;
  should_be_own_entry: boolean;
}

export interface Entry {
  id: string;
  source_id: string;
  core_idea: string;
  evidence_excerpt: string;
  primary_theme: string;
  secondary_themes: string[];
  tags: string[];
  tag_rationales: Record<string, string>;
  confidence: {
    primary_theme: number;
    tags: Record<string, number>;
  };
  tag_quality: {
    tags: Record<string, number>;
  };
  related_entry_ids: string[];
}

export interface EntriesFile {
  entries: Entry[];
}

export type RelationshipType =
  | 'extends'
  | 'contradicts'
  | 'supports'
  | 'questions'
  | 'causes'
  | 'analogous_to';

export interface Link {
  id: string;
  from_entry_id: string;
  to_entry_id: string;
  relationship: RelationshipType;
  explanation: string;
  confidence: number;
}

export interface LinksFile {
  links: Link[];
}

export interface Anchor {
  id: string;
  name: string;
  object_type: 'mtg_card' | 'physical_object' | 'image' | 'qr_code';
  identifier: string;
  linked_theme_ids: string[];
  linked_tag_ids: string[];
  linked_entry_ids: string[];
}

export interface AnchorsFile {
  anchors: Anchor[];
}

// Clean interface exposed to the rendering layer — no file paths, no FS details
export interface GraphNode {
  id: string;
  label: string;
  node_type: 'entry' | 'tag';
  theme?: string;        // primary theme id — only for entry nodes
  secondary_themes?: string[];
  tags?: string[];
  core_idea?: string;
  evidence_excerpt?: string;
  source_id?: string;
  connectionCount: number;
}

export interface GraphSourceMeta {
  id: string;
  title: string;
  created_at: string;
  raw_text: string;
}

export interface GraphThemeCluster {
  id: string;
  name: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relationship: string;
  explanation: string;
  confidence: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  themes: Theme[];
  themeClusters: GraphThemeCluster[];
  sources: Record<string, GraphSourceMeta>;
}
