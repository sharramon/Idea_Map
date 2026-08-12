# Similarity Detection (Embedding Pair/Hub Check)

**Status: design only — not yet implemented.**

Detects when entries are unusually close in embedding space and hands the result to
[TAG_ARBITRATION.md](TAG_ARBITRATION.md) to decide what, if anything, should be done about it.
This doc's job stops at "here are the entries that need a decision" — it never assigns a tag
itself.

## Why this exists

Per [EMBEDDINGS.md](EMBEDDINGS.md)'s division of labor: embeddings catch connections *within* a
topic that the LLM's committed categorization can miss. This is the concrete mechanism for that —
a check that runs automatically, not something you have to go looking for.

## Pipeline position

Runs automatically at the end of `process.ts`, after extractor → verifier → themeCollapse →
finalization:

1. Newly finalized entries get embedded (fold `embed-backfill`'s logic inline — no separate manual
   step required).
2. This check runs against the newly embedded batch.

## Comparison scope — incremental, not full recompute

Mirrors `updateLinksIncremental` in `src/pipeline/links.ts:88` — same shape, same reasoning. A new
batch of *k* entries is compared against:

- every entry already in the corpus (existing embeddings, untouched), and
- the other entries in the same batch (in case one source produced several new entries).

Pairs between two *pre-existing*, unchanged entries are never recomputed. This is O(k·n), not
O(n²) — trivially fast at any realistic personal-journal scale (low milliseconds even at
thousands of entries; see the "Deferred" section below for why no ANN/index structure is needed
yet).

### Exclusion: same-source pairs

Entries split from the same source text by the extractor/verifier will *always* score unusually
high on similarity with each other — that's an artifact of shared vocabulary and provenance, not a
meaningful independent convergence. The verifier's `split_decision` logic already explicitly
adjudicated whether they should be separate entries; re-litigating that via embedding similarity
would be circular. **Pairs sharing a `source_id` are excluded from this check entirely.**

## Threshold

No fixed absolute cosine value is portable across corpus sizes or models — see the real numbers
below. The threshold has to be corpus-relative once there's enough data, but percentile math is
meaningless with a tiny sample (at n=5, "top 5%" is just the single closest pair, which will
*always* trigger regardless of whether it's actually close).

```
if corpus_size < 30:
  trigger if cosine >= 0.6          # absolute floor — doesn't depend on sample size
else:
  trigger if cosine >= p95(corpus)  # 95th percentile of the corpus's own pairwise
                                     # similarity distribution, recalculated as it grows
```

30 as the crossover isn't arbitrary: at n=30 there are C(30,2)=435 pairs, so "top 5%" is ~21
candidate pairs — a real percentile, not a single outlier dressed up as one.

**Open question:** should the 0.6 floor also apply *above* 30 entries, as a permanent second
condition alongside the percentile check (`cosine >= p95 AND cosine >= 0.6`)? Pure percentile
alone has a symmetric failure mode to the small-n problem — if the corpus ever became fairly
homogeneous, "top 5%" could land at a mediocre absolute value that doesn't feel genuinely close.
Not yet decided.

### Reference numbers (this corpus, 17 entries, 136 pairs, computed 2026-08-11)

```
min=0.083  max=0.704  mean=0.319  std=0.132
p50=0.314  p90=0.503  p95=0.569  p99=0.611
```

Top pair (0.704): `entry_012` / `entry_013`, both about the writer's relationship to reading.
The known VR cluster (`entry_009`/`010`/`011`) sits at 0.57–0.61 with each other — notably above
average, though not the single top pair.

## Grouping — not strictly pairwise

Build a graph where an edge means "this pair clears the threshold," then take **connected
components** as candidate groups. This naturally captures hub patterns: if entry A clears
threshold with both B and C, `{A, B, C}` is one candidate group even if B and C were never
compared to each other directly.

### Cohesion check for groups of 3+

A hub-and-spoke shape (A close to B, A close to C, but B and C unrelated to each other) isn't
necessarily "one group" — A might just be a naturally connective idea that touches several
unrelated things. Before treating a 3+ candidate group as a single arbitration unit, verify the
group's *internal* pairwise similarities (B-to-C, not just the hub edges) also clear a reasonable
bar.

This is effectively free: once entries are embedded, checking any pair's similarity is a dot
product on already-stored vectors — no new API call, no re-embedding, just arithmetic reusing data
that's already there.

If a candidate group fails cohesion, fall back to treating the hub's connections as **separate
pairwise groups** rather than forcing one over-broad decision across everything. Nothing gets
dropped.

## Deferred: scaling the search itself

At any realistic scale for this tool (even ~10,000 entries — three-a-day for ten years), brute-force
linear comparison stays in the tens-of-milliseconds range. **Not building an ANN/IVF index now.**
If the corpus ever grows enough for this to matter (unlikely):

- The standard technique is an IVF-style index: coarse-cluster entries by embedding, only compare
  a new entry against its own cluster (+ nearest neighbors, to catch boundary cases).
- It must be **embedding-native clustering only** — never the LLM's own theme/tags. The entire
  value of this check is catching cases where embedding similarity and LLM categorization
  *disagree*; pruning by the LLM's own categories would make the check blind to exactly what it
  exists to find.
- It's approximate (can miss a true match sitting near a cluster boundary) and needs periodic
  re-clustering to stay accurate. Revisit only if brute force is *measured* as slow, not
  preemptively.

## Output / handoff

For each flagged pair or cohesive group, hand off `{entry_ids, similarity_scores}` to the process
described in [TAG_ARBITRATION.md](TAG_ARBITRATION.md). This doc does not decide what tag (if any)
gets applied.
