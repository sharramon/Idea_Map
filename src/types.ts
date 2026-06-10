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
  raw_text: string;
  child_entry_ids: string[];
}

export interface SourcesFile {
  sources: Source[];
}

export interface Entry {
  id: string;
  source_id: string;
  primary_theme: string;
  secondary_themes: string[];
  tags: string[];
  core_idea: string;
  expanded_summary: string;
  source_excerpt: string;
  source_start_char: number;
  source_end_char: number;
  confidence: {
    primary_theme: number;
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
  theme: string;
  tags: string[];
  connectionCount: number;
  core_idea: string;
  expanded_summary: string;
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
}
