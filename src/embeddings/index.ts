import type { EmbeddingProvider } from './types';
import type { EmbeddingClient } from './client';
import { OpenAIEmbeddingClient } from './openai';

export function createEmbeddingClient(
  provider: EmbeddingProvider,
  apiKey: string,
  model: string,
): EmbeddingClient {
  switch (provider) {
    case 'openai':
      return new OpenAIEmbeddingClient(apiKey, model);
    case 'local':
      throw new Error('Local embedding client not yet implemented.');
  }
}

export { EmbeddingStore } from './store';
export type { EmbeddingClient } from './client';
export type { EmbeddingVector, EmbeddingProvider, EntryEmbeddingRecord, EmbeddingsFile } from './types';
