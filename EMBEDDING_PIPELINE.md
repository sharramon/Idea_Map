# Embedding Pipeline

Standalone pipeline for journal entries. No LLM integration — this operates purely on the text of diary entries and produces semantic vectors for search, similarity, and audit.

## What it does

Takes journal entries → produces vectors → stores them → enables semantic search and tag audit. The LLM pipeline (extractor, verifier, theme collapse) is completely separate and untouched.

## Build status

| Component | Status |
|-----------|--------|
| `createEmbeddingClient` factory | ✅ Built |
| `OpenAIEmbeddingClient` | ✅ Built |
| `EmbeddingStore` | ✅ Built |
| `Visualizer` (PCA → HTML) | ✅ Built |
| `TagEmbedder` | Planned |
| `RetrievalService` | Planned |
| `AuditService` | Planned |
| `LocalEmbeddingClient` | Planned |

## Components

```
Main (CLI commands)
  ├── createEmbeddingClient(provider)   ✅
  │     ├── OpenAIEmbeddingClient       ✅
  │     └── LocalEmbeddingClient        planned
  ├── EmbeddingStore                    ✅
  ├── Visualizer (pca2d → HTML)         ✅
  ├── TagEmbedder                       planned
  ├── RetrievalService                  planned
  └── AuditService                      planned
```

### EntryReader
Reads `data/entries.json` and produces the text to be embedded per entry.

- Input: `entries.json`
- Output: `Array<{ id: string, text: string }>` where `text = core_idea + ' ' + evidence_excerpt`
- Skips entries that already have a vector in `embeddings.json` (for incremental runs)

### createEmbeddingClient(provider)
Factory function. The only place the provider enum is evaluated. Everything downstream receives an `EmbeddingClient` and never knows which path it's on.

```typescript
type EmbeddingProvider = 'openai' | 'local';

interface EmbeddingClient {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  readonly model: string;
  readonly dimensions: number;
  readonly provider: EmbeddingProvider;
}

function createEmbeddingClient(provider: EmbeddingProvider): EmbeddingClient
```

Current default: `openai` → `text-embedding-3-small` (1536-dim).
Future local path: `local` → `nomic-embed-text-v1` via Transformers.js (768-dim, ONNX).

Switching providers requires a full re-embed of all entries (`embed-backfill`).

### EmbeddingStore
Owns `data/embeddings.json`. Handles persistence, indexing, and model mismatch detection.

Responsibilities:
- Load and save `embeddings.json`
- Maintain an in-memory index: `Map<entry_id, number[]>`
- Guard against model mismatch on load (stored model ≠ current client → throw, do not silently mix)
- `isReady()` — returns false when embeddings are disabled via config, so all callers can safely no-op

```typescript
class EmbeddingStore {
  static load(client: EmbeddingClient): EmbeddingStore
  isReady(): boolean
  async embedAndStore(entries: { id: string, text: string }[]): Promise<void>
  getVector(entryId: string): number[] | undefined
  getAllVectors(): Array<{ id: string, vector: number[] }>
  save(): void
}
```

### TagEmbedder
Separate from entry embedding. Embeds each tag's text (name + description + aliases) and maintains a centroid (mean vector of all entries carrying that tag).

- Updates only the tags affected by newly added entries
- Centroid is recomputed incrementally, not from scratch each time
- Stores results in `embeddings.json` under a `tags` array alongside `entries`

```typescript
class TagEmbedder {
  async refreshTags(
    changedTagIds: string[],
    taxonomy: Taxonomy,
    allEntries: Entry[],
    store: EmbeddingStore,
    client: EmbeddingClient,
  ): Promise<void>
}
```

### RetrievalService
Pure search — no persistence. Takes a query string, embeds it, returns nearest entries and/or tags by cosine similarity.

```typescript
class RetrievalService {
  constructor(store: EmbeddingStore, client: EmbeddingClient)

  async nearestEntries(query: string, topK?: number): Promise<NearestEntryHit[]>
  async nearestTags(query: string, topK?: number): Promise<NearestTagHit[]>
}

interface NearestEntryHit { id: string; similarity: number }
interface NearestTagHit   { tagId: string; similarity: number; clusterConsistency?: number }
```

Cosine search is in-memory over all stored vectors — no external search index needed at personal-tool scale (~1000 entries).

### AuditService
Reads the tag centroids from `EmbeddingStore` and produces a maintenance report. Does not modify anything.

Flags:
- `ONE_OFF` — tag appears on only one entry
- `UNUSED` — tag has no entries
- `LOW_CONSISTENCY` — avg pairwise cosine between entries sharing this tag is below threshold (tag may be too broad or misassigned)
- `POTENTIAL_DUPLICATE` — two tag centroids are very close (possible synonyms)

```typescript
class AuditService {
  run(store: EmbeddingStore, taxonomy: Taxonomy, entries: Entry[]): AuditReport
}
```

### Visualizer
Reduces 1536-dim vectors to 2D using PCA and generates a standalone HTML scatter plot matching the existing graph renderer's dark theme.

- `pca2d(vectors)` — pure TypeScript, no packages, deterministic. Works well up to ~200 entries.
- UMAP (`umap-js`) is the upgrade path for larger datasets — better cluster separation, preserves global structure.
- Output: `dist/embedding-map.html` — dots colored by `primary_theme`, hover for `core_idea` and tags, faint edges between nearby entries.

---

## Flow

### CLI commands

```bash
npx ts-node src/cli.ts embed-backfill           # embed all entries (skips already-embedded)
npx ts-node src/cli.ts embed-backfill --force   # re-embed everything
npx ts-node src/cli.ts embed-viz                # generate + open 2D scatter plot
```

### Backfill (one-time, run after enabling embeddings)
```
read entries.json
  → EntryReader extracts { id, text } for all entries
  → EmbeddingStore.load() — checks model match, loads existing vectors
  → client.embedBatch(texts) — one API call per 100 entries
  → EmbeddingStore saves vectors
  → TagEmbedder.refreshTags(allTagIds, ...) — embed all tags + compute centroids
  → EmbeddingStore.save() → embeddings.json
```

### Incremental (after each new ingestion)
```
new finalized entries
  → EntryReader skips already-embedded entries
  → embed only new entries
  → TagEmbedder.refreshTags(only tags on new entries)
  → EmbeddingStore.save()
```

### Search
```
user query string
  → client.embed(query) — one API call
  → RetrievalService.nearestEntries(query, topK=10)
  → return sorted results
```

### Audit
```
AuditService.run(store, taxonomy, entries)
  → reads centroids from store
  → computes pairwise similarities
  → returns AuditReport (no writes)
```

---

## Data file

`data/embeddings.json`

```json
{
  "schema_version": 1,
  "embedding_model": "text-embedding-3-small",
  "embedding_provider": "openai",
  "entries": [
    { "entry_id": "abc123", "vector": [0.12, -0.04, ...], "generated_at": "2026-08-03T..." }
  ],
  "tags": [
    {
      "tag_id": "career_uncertainty",
      "vector": [...],
      "centroid": [...],
      "cluster_consistency": 0.74,
      "centroid_entry_count": 8,
      "generated_at": "2026-08-03T..."
    }
  ]
}
```

---

## Related docs

- [EMBEDDINGS.md](EMBEDDINGS.md) — full design including LLM integration plan
- [HARDWARE.md](HARDWARE.md) — deployment targets and provider path rationale
- [CLAUDE.md](CLAUDE.md) — overall project architecture
