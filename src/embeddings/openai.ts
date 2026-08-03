import OpenAI from 'openai';
import type { EmbeddingClient } from './client';
import type { EmbeddingVector } from './types';

const BATCH_SIZE = 100;

export class OpenAIEmbeddingClient implements EmbeddingClient {
  readonly model: string;
  readonly dimensions: number;
  readonly provider = 'openai' as const;
  private openai: OpenAI;

  constructor(apiKey: string, model = 'text-embedding-3-small') {
    this.openai = new OpenAI({ apiKey });
    this.model = model;
    this.dimensions = model === 'text-embedding-3-large' ? 3072 : 1536;
  }

  async embed(text: string): Promise<EmbeddingVector> {
    const res = await this.openai.embeddings.create({
      model: this.model,
      input: text,
      encoding_format: 'float',
    });
    return res.data[0].embedding;
  }

  async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
    const results: EmbeddingVector[] = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const res = await this.openai.embeddings.create({
        model: this.model,
        input: batch,
        encoding_format: 'float',
      });
      results.push(...res.data.sort((a, b) => a.index - b.index).map(d => d.embedding));
    }
    return results;
  }
}
