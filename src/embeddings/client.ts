import type { EmbeddingProvider, EmbeddingVector } from './types';

export interface EmbeddingClient {
  embed(text: string): Promise<EmbeddingVector>;
  embedBatch(texts: string[]): Promise<EmbeddingVector[]>;
  readonly model: string;
  readonly dimensions: number;
  readonly provider: EmbeddingProvider;
}
