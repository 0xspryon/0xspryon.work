---
title: 'Vuln Bank Part 2: Four Indexes and One Wrong Turn'
titleHtml: 'Vuln Bank Part 2: Four Indexes and One <em>Wrong Turn</em>'
summary: "How the vuln bank stores knowledge — why one record is already one chunk, why each of the four indexes is the type it is, and why I ripped out IVFFlat for HNSW before the first migration ever shipped."
standfirst: "You don't choose an index by taste. You choose it by the shape of the column — and I learned that by getting it wrong."
date: '2026-08-17'
tag: 'HACKBOT'
readingMinutes: 15
status: 'ONGOING'
chip: 'BUILD_LOG'
---

## 01_WHERE_WE_LEFT_OFF

In [Part 1](/writing/vuln-bank-tech-stack) I drew the seam: a RAG engine that knows nothing about its callers, and thin interfaces (Hono, MCP) that translate requests into the engine's language. That post was about the *shape* of the system. This one goes inside the engine — specifically, into how knowledge is stored and indexed, which is the half of retrieval that happens before any query arrives.

Most of what follows I did not know a month ago. I made a wrong call on the vector index and had to reverse it, and rather than present the finished schema as if it fell out of a design doc, I'll explain each piece the way I eventually understood it — concept first, then what it does in this codebase, then what it cost me to get there.

If you've read a RAG tutorial and come away with "embed the docs, cosine-similarity the query, done," this post and the next are the gap between that sentence and a system you'd actually trust.

## 02_ONE_RECORD_IS_ONE_CHUNK


Quick refresher on what we're searching over, because it makes everything downstream simpler.

A **chunk**, in RAG, is the unit of text you retrieve and hand to the model. In most systems chunking is a genuine problem: you have a 40-page PDF, the model reads a few thousand tokens, so you slice the document up and inherit a pile of questions. How big? Overlapping or not? What happens when a sentence explaining a concept lands in chunk 7 and the concept is defined in chunk 3?

The vuln bank sidesteps all of it by never having documents. A record is *already* the atomic unit — one technique, structured into typed fields:

```sql:Postgres
-- bit.records, trimmed to the fields that matter for retrieval
title               text        not null,
symptom             text        not null,   -- what you observe
when_to_use         text,                   -- when to reach for this
procedure           text        not null,   -- how to confirm/exploit it
confirmation_signal text,                   -- what proves it
namespaces          text[]      not null,   -- vuln classes this belongs to
cwe                 integer[]   not null,
quality_tier        smallint    not null,
embedding           vector(1024) not null,
```

There is no dynamic chunker in this system. Each structured methodology record is one retrieval unit. That avoids splitting a long source document, although it leaves me responsible for keeping each record focused enough to embed and return as a whole.

One caveat to pin down before future-me trips on it: "whole" has a ceiling. The vector is produced from `symptom + procedure`, and the inference server runs with `--auto-truncate`. BGE-M3 supports long inputs, but my server's token budget is intentionally smaller to fit the VPS. A long procedure can therefore be represented only by its beginning. The schema limits help, but I still need truncation telemetry rather than relying on authors to keep every record short.

One more column is doing quiet work:

```sql:Postgres
fts tsvector generated always as (
  to_tsvector('english',
    coalesce(title, '')               || ' ' ||
    coalesce(symptom, '')             || ' ' ||
    coalesce(when_to_use, '')         || ' ' ||
    coalesce(procedure, '')           || ' ' ||
    coalesce(confirmation_signal, ''))
) stored
```

A `tsvector` is Postgres's parsed, normalised form of a document for full-text search — words reduced to stems, positions recorded, stop-words dropped. `generated always as ... stored` means Postgres computes and persists it on every insert and update. Nothing in my application code writes it; nothing can forget to.

That's the raw material for the keyword half of search. Making it generated removes an application-level sync job: whenever Postgres accepts a record change, it recomputes the stored search vector in the same operation. If you take one habit from this post, take that one: when a derived value should follow a row automatically, consider letting the database own it.

## 03_FOUR_INDEXES_FOUR_SHAPES


Now the part that took me the longest to internalise, and which I think most tutorials skip: **you don't choose an index type by taste. You choose it by the shape of the column.**

The records table carries four indexes:

```sql:Postgres
create index records_embedding_idx  on bit.records using hnsw ("embedding" vector_cosine_ops);
create index records_fts_idx        on bit.records using gin  ("fts");
create index records_namespaces_idx on bit.records using gin  ("namespaces");
create index records_cwe_idx        on bit.records using gin  ("cwe");
```

Split them into two jobs and it clicks.

**Two indexes power the two ways of *finding*.** The HNSW index over `embedding` is the semantic leg: it can connect a paraphrased symptom such as "cache serves the wrong site's content" with a record about host-header cache poisoning. The GIN index over `fts` is the lexical leg: it rewards overlapping lexemes when the query goes through `websearch_to_tsquery`.

That second leg matters because security is full of exact-looking tokens: header names, CVE ids, parameter names, gadget classes, and payload syntax. There is an important limitation, though: PostgreSQL's English FTS parses, stems, and drops stop words. It is lexical search, not byte-for-byte token search, so unusual punctuation and identifiers still need test cases. A future trigram or `simple`-dictionary leg may handle those better.

**Two indexes power optional scope filters.** GIN over `namespaces` and GIN over `cwe`. These are not ranking signals; they make overlap queries efficient. They only improve correctness when the metadata and the filter supplied by the caller are themselves correct, and a multi-namespace record can legitimately belong to more than one vulnerability class.

Why GIN for three of the four? **GIN** — Generalized Inverted Index — supports the containment and overlap operators I use on composite values. A `tsvector` contains lexemes; `namespaces` and `cwe` are arrays. The query operators, data shape, and distribution all matter. "Many values means GIN" is a useful first instinct, not a universal law.

Contrast a plain scalar column — a `status` string, an id — where a **B-tree** is right: one value per row, sorted, binary-searchable.

I know that contrast is real because I got it wrong first. The original schema had a *singular* `namespace text` column with a B-tree on it, which was correct for what it was. Then reality intervened: a technique for password-reset poisoning genuinely belongs to both `host-header` and `account-takeover`, and forcing a single label meant either duplicating records or losing a retrieval path. So a migration turned the column into `text[]` — and the index had to change with it:

```sql:MIGRATION_0002
drop index "bit"."records_namespace_idx";
alter table "bit"."records" add column "namespaces" text[] not null;
create index "records_namespaces_idx" on "bit"."records" using gin ("namespaces");
alter table "bit"."records" drop column "namespace";
```

The column changed shape from scalar to multi-valued, so the index changed from B-tree to GIN. Not a preference. A consequence.

And the fourth index — HNSW over a 1024-dimensional vector — is a different animal entirely, which is the next section.

> Pick the index for the operators and data shape you actually use.
>
> The schema gets you to a shortlist; `EXPLAIN ANALYZE` gets the final vote.

## 04_THE_INDEX_I_CHOSE_WRONG


I started with **IVFFlat**, pgvector's other vector index, and I want to walk through why — because the reasoning was sound, the failure mode was subtle, and understanding it is the fastest way to understand what HNSW buys you.

Here's how IVFFlat works. "IVF" is *inverted file*; "Flat" means vectors are stored uncompressed. At build time it runs k-means over your vectors and picks some number of centroids — say 100 — carving the space into 100 neighbourhoods, then files every vector into its nearest centroid's list. At query time you find the nearest few centroids and search only inside those lists. That's the speedup: you skip most of the table.

The critical thing — and this is what I initially glossed over — is that **two different things happen at two different times**:

- **At `CREATE INDEX` (or `REINDEX`)**, pgvector runs k-means over whatever rows exist *right then* and freezes the centroids. They never move again.
- **On every `INSERT`**, the new row is assigned to its nearest *existing* centroid's list. No reindex needed; the row is immediately findable.

Read those together and the problem surfaces. My migration creates the index on an **empty table**, and the seeder loads records afterward. So the centroids were learned from nothing — and never updated as the corpus grew from 22 records to 200 to 20,000. The index keeps absorbing rows correctly, but the *geometry* it uses to decide where to look is frozen in a past that barely existed.

My first fix was a setting called `probes`, which controls how many lists a query considers:

- **`probes = 100` (all lists).** At that point pgvector can prefer an exact plan rather than use IVFFlat at all. Either way, I had configured away the speed benefit I chose the approximate index for. The seeder also ran a `REINDEX` after loading to rebuild centroids over real data.
- **`probes = 5` (the actual speed optimization).** You scan only the nearest few lists. *Now* centroid quality is load-bearing, and clusters learned from 22 rows may be wildly unbalanced for 20,000 — so the true nearest neighbour can sit in a list you never probed, and it silently doesn't come back.

That worked. But look at what I'd built: an approximate index configured to be exhaustive, plus a maintenance step in the seeder, plus a decision to revisit every time the corpus grew an order of magnitude. All of IVFFlat's operational baggage and none of its speed.

So I switched to **HNSW** (Hierarchical Navigable Small World) before the first migration shipped. Rather than partitioning space into buckets, HNSW builds a layered graph where each vector is a node linked to its neighbours. Searching means entering at the sparse top layer, greedily walking toward the query, then dropping to denser layers to refine. There are no centroids at all.

That single structural difference erases the whole problem:

- **No data-at-build-time dependency.** The graph is built incrementally as rows insert, so there's nothing that "learns" from whatever happened to be in the table when the migration ran. The empty-table caveat doesn't exist.
- **No corpus-training step.** The seeder's IVFFlat-specific `REINDEX` is gone. HNSW still has normal database maintenance costs, and deletes, vacuuming, construction settings, memory, and corpus growth remain worth observing.
- **A clearer query-time knob.** `hnsw.ef_search` is the main dial during retrieval. HNSW also has construction-time settings such as `m` and `ef_construction`, so it is not literally a one-knob index.

The tradeoff I accepted: HNSW inserts are heavier and the index uses more memory. For a knowledge base that's read far more than it's written and capped well under a million records, that's a trade I'll take every time.

> IVFFlat's centroids are a snapshot. HNSW's graph is a living structure.
>
> If *my* migration builds an index before seeding, it builds against an empty table. Deployment order is part of the index design.

## 05_WHAT_I_ACTUALLY_LEARNED

Two things from all of this generalise well beyond a vuln bank:

- **Index type follows operators, data shape, and workload.** My `namespace` → `namespaces[]` migration changed both the column and the query operator, so the B-tree became a GIN index. That is a useful concrete lesson without turning it into a universal mapping table.
- **Find out *when* your index learns.** IVFFlat learns once, at build time. HNSW learns continuously, on insert. That single difference decided everything downstream: whether the seeder needs a maintenance step, whether recall decays as the corpus grows, and whether a migration running against an empty table is harmless or quietly poisonous. It is the first question I'll ask of any index from now on.

And the meta-lesson, which is really why I write these up: the IVFFlat detour cost me a couple of days and left no code in the repo. But I now understand why HNSW exists in a way I would not have if I'd picked it correctly by accident. Reversing a decision you understand is cheap. Never having made it is expensive later.

## 06_NEXT

The first storage design is in place: one record per retrieval unit, four indexes matched to current query patterns, and an HNSW graph that accepts incremental inserts. None of that proves a query returns the right record yet.

Next up — **[Two Legs, One List](/writing/vuln-bank-hybrid-retrieval)** — is the read path: running the semantic and lexical legs in parallel, merging two rankings whose scores can't be compared, the bug where an approximate index hands you a short list with a `200 OK`, and the measurement that tells me whether any of it works.

*Knowing where things are kept is not the same as knowing how to find them.*
