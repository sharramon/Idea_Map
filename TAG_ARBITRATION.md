# Tag Arbitration (Find / Collapse / Merge / Add)

**Status: design only — not yet implemented.**

Decides what, if anything, to do when [SIMILARITY_DETECTION.md](SIMILARITY_DETECTION.md) flags a
pair or group of entries as unusually close in embedding space. This is a **separate, narrow LLM
call** — not the extractor, not the verifier, and not `themeCollapse.ts`'s own pass, though it
reuses that pass's taxonomy-mutation mechanism where relevant (see "Add new" below).

## Input scope

Only the flagged entries — never the full corpus. Narrow by design: this call exists to make one
targeted decision about entries that already have strong external evidence (the similarity check)
that something's there, not to re-run general tagging judgment.

## Bias: toward action, not caution

The extractor/verifier are deliberately conservative — recall-then-precision, second-guessing
each other. This call is the opposite on purpose: by the time entries reach it, the embedding
signal has already cleared a real bar (see `SIMILARITY_DETECTION.md`'s threshold). Given that
prior, **lean toward finding a connection rather than declining.** "No connection" should be a
real, available answer, not a suppressed one — but the default posture is "find something," not
"justify not finding something."

## Output constraint: exactly one tag

Even if a flagged group could plausibly share several tags, this call surfaces **only one**.
Keeps the intervention minimal and targeted — this is not a second full tagging pass over the
flagged entries.

## Action tiers

Stated priority: **find > collapse > merge > add new** — bias toward keeping the tag vocabulary
small, since a smaller, more-reused taxonomy directly increases graph connectedness (more shared
tags = more edges via `links.ts`'s tag-overlap link inference).

Working definitions below — these are inferred from the discussion that produced this doc, not yet
independently confirmed. Adjust freely before implementing.

| Tier | What it means | Blast radius |
|------|---------------|---------------|
| **Find** | An existing taxonomy tag already fits the flagged entries as-is. Apply it. | None — no taxonomy change. |
| **Collapse** | The flagged entries reveal that two *existing* taxonomy tags are effectively redundant/synonymous. Retire one into the other. | Corpus-wide — touches every entry currently carrying *either* tag, not just the flagged ones. |
| **Merge** | One of the flagged entries' existing tags is a reasonable near-fit for the others, without the two-tags-are-redundant judgment that Collapse requires. Extend that tag's usage rather than retiring anything. | Local — only adds usage, doesn't remove anything elsewhere. |
| **Add new** | Nothing existing fits. Mint a new tag. | None to existing entries, but grows the taxonomy — the tier this design is explicitly trying to minimize. |

Reuse `themeCollapse.ts`'s existing taxonomy-mutation path for "Add new" rather than building a
second mechanism for writing to `taxonomy.json`.

## Blast-radius scaling for Collapse

Collapse is the tier with real risk: the call only ever sees the flagged entries, so it can't
judge whether merging two tags is safe for entries it never looked at. Rather than blocking
Collapse (which fights the stated goal) or allowing it unconditionally (which risks a
corpus-wide structural change decided from 2–3 entries' worth of evidence), scale the caution to
the actual blast radius:

```
if count(entries currently on tag A) + count(entries currently on tag B) <= BLAST_RADIUS_LIMIT:
  execute the collapse directly
else:
  don't execute — flag {tag A, tag B} as a collapse candidate for the full-corpus tag audit
  (the audit has visibility into every entry using either tag; this call doesn't)
```

**Open question:** `BLAST_RADIUS_LIMIT` is not yet set. Discussed as "a handful" (e.g. 5) but not
locked in — pick once this is running against real data and a false-collapse actually costs
something to undo, or doesn't.

## Provenance marking

Per `Entry`'s existing `tag_rationales: Record<string, string>` (`src/types.ts:52`), add a
parallel field:

```ts
tag_source: Record<string, 'llm' | 'embedding'>
```

Any tag applied or confirmed through this process gets marked `'embedding'`; everything from the
normal extractor/verifier/themeCollapse path stays `'llm'` (or the field is simply absent —
`'llm'` as implicit default, only embedding-sourced tags need marking). This is a **data-level**
marker only — nothing about how a tag renders or behaves in the graph needs to change. The point
is auditability and reversibility (being able to find and reconsider every embedding-sourced tag
later), not creating a visibly second-class tag type.

## Relationship to the full-corpus tag audit

This call and the full-corpus audit (from `EMBEDDINGS.md`'s "Cluster audit" line item, still
unbuilt) are two different granularities of the same underlying question — "should these tags
really be separate?" — with different visibility:

- **This call**: triggered per-pair/group, sees only the flagged entries, can execute Collapse
  directly when blast radius is small.
- **Full audit**: runs corpus-wide, sees every entry on every tag, is the only place a
  large-blast-radius Collapse should be decided.

They should share the same underlying "are these two tags redundant" judgment logic where
possible, differing mainly in scope of evidence available and in what they're allowed to execute
unilaterally.
