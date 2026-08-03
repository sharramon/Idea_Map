import { readJson, writeJson } from '../data/store';
import type { EmbeddingClient } from './client';
import type { EmbeddingsFile, EntryEmbeddingRecord, EmbeddingProvider } from './types';

const FILENAME = 'embeddings.json';

function emptyFile(model: string, provider: EmbeddingProvider): EmbeddingsFile {
  return { schema_version: 1, embedding_model: model, embedding_provider: provider, entries: [] };
}

export class EmbeddingStore {
  private file: EmbeddingsFile;
  private index: Map<string, EntryEmbeddingRecord>;

  private constructor(file: EmbeddingsFile) {
    this.file = file;
    this.index = new Map(file.entries.map(r => [r.entry_id, r]));
  }

  static load(client: EmbeddingClient): EmbeddingStore {
    let file: EmbeddingsFile;
    try {
      file = readJson<EmbeddingsFile>(FILENAME);
    } catch {
      file = emptyFile(client.model, client.provider);
    }

    if (file.entries.length > 0 && file.embedding_model && file.embedding_model !== client.model) {
      throw new Error(
        `Embedding model mismatch: stored "${file.embedding_model}", ` +
        `current "${client.model}". Run embed-backfill --force to re-embed.`
      );
    }

    // Stamp model/provider if the file was empty when loaded
    if (!file.embedding_model) {
      file.embedding_model = client.model;
      file.embedding_provider = client.provider;
    }

    return new EmbeddingStore(file);
  }

  hasEntry(entryId: string): boolean {
    return this.index.has(entryId);
  }

  get entryCount(): number {
    return this.index.size;
  }

  getVector(entryId: string): number[] | undefined {
    return this.index.get(entryId)?.vector;
  }

  async embedAndStore(
    entries: Array<{ id: string; text: string }>,
    client: EmbeddingClient,
  ): Promise<void> {
    if (!entries.length) return;
    const vectors = await client.embedBatch(entries.map(e => e.text));
    const now = new Date().toISOString();
    entries.forEach((e, i) => {
      this.index.set(e.id, { entry_id: e.id, vector: vectors[i], generated_at: now, model: client.model });
    });
  }

  save(): void {
    this.file.entries = [...this.index.values()];
    writeJson(FILENAME, this.file);
  }
}
