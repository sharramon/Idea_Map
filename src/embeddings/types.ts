export type EmbeddingVector = number[];
export type EmbeddingProvider = 'openai' | 'local';

export interface EntryEmbeddingRecord {
  entry_id: string;
  vector: EmbeddingVector;
  generated_at: string;
  model: string;
}

export interface EmbeddingsFile {
  schema_version: 1;
  embedding_model: string;
  embedding_provider: EmbeddingProvider;
  entries: EntryEmbeddingRecord[];
}
