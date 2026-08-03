# Embeddings Layer

A parallel semantic layer that runs alongside the LLM pipeline without touching it. The two systems serve different roles and are intentionally kept separate until integration is needed.

## Philosophy — half and half

Neither system alone is sufficient:

**LLM gives you what embeddings can't:**
- Named, searchable taxonomy (human-readable, navigable)
- Semantic judgment — "I overcame my fear" vs "I'm terrified" cluster together in embedding space but mean opposite things
- Directionality — `causes`, `contradicts`, `supports` link types require reasoning, not just proximity
- Reusability decisions — whether a motif is worth tracking across future entries
- Split/merge ontology — two similar entries can still be distinct map nodes

**Embeddings give you what LLM can't:**
- Continuous similarity — no discrete bins, no taxonomy constraints
- Cross-theme connections the LLM misses because it had to pick one category
- Fast retrieval at scale without sending everything to the LLM
- Cluster audit — detecting tag drift, synonymous tags, overstretched tags
- Discovery — finding similar entries without knowing the tag name

**Observation from initial test:** embedding clusters mapped the writing more accurately than LLM taxonomy in geometric terms, but the LLM captures semantic nuance (valence, directionality, reusability) that pure similarity misses. The right design uses both.

## Current status

Phases 0–1 are built and working. The embedding layer is a parallel track — LLM pipeline is completely untouched.

| Phase | Status | What it does |
|-------|--------|-------------|
| 0 — Scaffolding | ✅ Done | types, client interface, feature flag, empty embeddings.json |
| 1 — Embed + Visualize | ✅ Done | EmbeddingStore, embed-backfill, embed-viz (PCA scatter plot) |
| 2 — Retrieval-augmented verifier | Planned | Replace full corpus dump with nearest-entries retrieval |
| 3 — Extractor retrieval | Planned | Same for extractor |
| 4 — Audit command | Planned | Cluster consistency, synonym detection |
| 5 — Search command | Planned | Hybrid semantic + tag search |

## Files

```
src/embeddings/
  types.ts       — EmbeddingVector, EmbeddingProvider, EntryEmbeddingRecord, EmbeddingsFile
  client.ts      — EmbeddingClient interface
  openai.ts      — OpenAIEmbeddingClient (text-embedding-3-small, batched 100/call)
  store.ts       — EmbeddingStore: load/save, model-mismatch guard, embedAndStore
  index.ts       — createEmbeddingClient() factory (the provider enum switch)
  visualize.ts   — pca2d() + generateEmbeddingMap() → dist/embedding-map.html
data/
  embeddings.json — { schema_version, embedding_model, embedding_provider, entries[] }
```

## Configuration (.env)

```
IDEA_MAP_EMBEDDINGS=true                         # false = layer fully disabled
IDEA_MAP_EMBEDDING_PROVIDER=openai               # openai | local (local not yet implemented)
IDEA_MAP_EMBEDDING_MODEL=text-embedding-3-small
```

The embedding layer always uses `OPENAI_API_KEY` regardless of `IDEA_MAP_PROVIDER`.

## CLI commands (working now)

```bash
# Embed all existing entries (run once after enabling, or after adding new entries)
npx ts-node src/cli.ts embed-backfill

# Re-embed everything (e.g. after switching models)
npx ts-node src/cli.ts embed-backfill --force

# Generate 2D PCA scatter plot and open in browser
npx ts-node src/cli.ts embed-viz
```

## Data model

```ts
interface EntryEmbeddingRecord {
  entry_id: string;
  vector: number[];        // 1536-dim (text-embedding-3-small)
  generated_at: string;
  model: string;
}

interface EmbeddingsFile {
  schema_version: 1;
  embedding_model: string;
  embedding_provider: 'openai' | 'local';
  entries: EntryEmbeddingRecord[];
}
```

## Confidence signals (future integration — never conflated)

```ts
llmTagConfidence        // LLM's own score from verifier
embeddingTagSimilarity  // cosine similarity to nearest tag centroid
tagClusterConsistency   // avg pairwise cosine of entries sharing a tag
nearestTagMargin        // gap between top-1 and top-2 tag match
```

## Visualization

`embed-viz` runs PCA (pure TypeScript, no packages) to reduce 1536 dimensions to 2D. For datasets under ~200 entries PCA is sufficient. UMAP (`umap-js`) is the standard upgrade path for larger datasets — it preserves both local and global cluster structure better than PCA.

Output: `dist/embedding-map.html` — dark-theme scatter plot matching the existing graph renderer, colored by `primary_theme`, hover for `core_idea` and tags.

## Provider path

See [HARDWARE.md](HARDWARE.md) for full rationale. Short version:

- **Now (OpenAI path):** all embedding computation is external. Device stores `embeddings.json` only — cosine search is pure arithmetic, no model needed on-device.
- **Later (local path):** `nomic-embed-text-v1` INT8 ONNX (~67MB) runs on Snapdragon Reality Elite (48 TOPS NPU). Same interface, config change only, requires full re-embed.

## Related docs

- [EMBEDDING_PIPELINE.md](EMBEDDING_PIPELINE.md) — component-level design of the standalone pipeline
- [HARDWARE.md](HARDWARE.md) — deployment targets and provider path rationale
- [CLAUDE.md](CLAUDE.md) — overall project architecture
