---
title: 'Vuln Bank Part 2: Four Indexes and One Wrong Turn'
titleHtml: 'Vuln Bank Part 2: Four Indexes and One <em>Wrong Turn</em>'
summary: "How the vuln bank stores knowledge, why its query patterns need four indexes, and why I replaced IVFFlat with HNSW before the first migration shipped."
standfirst: "I started with the wrong vector index. Working out why taught me what each index in this schema is actually doing."
date: '2026-08-17'
tag: 'HACKBOT'
readingMinutes: 10
status: 'ONGOING'
chip: 'BUILD_LOG'
---

## 01_WHERE_WE_LEFT_OFF

In [Part 1](/writing/vuln-bank-tech-stack) I separated the RAG engine from its HTTP and MCP adapters. This post looks inside the engine at how records are stored and indexed before any query arrives.

Most of this was new to me a month ago. I made the wrong call on the vector index and had to reverse it, so I will explain the schema in the order I came to understand it rather than presenting it as an obvious finished design.

## 02_ONE_RECORD_IS_ONE_CHUNK


Quick refresher on what we're searching over, because it makes everything downstream simpler.

A **chunk**, in RAG, is the unit of text you retrieve and hand to the model. In most systems chunking is a genuine problem: you have a 40-page PDF, the model reads a few thousand tokens, so you slice the document up and inherit a pile of questions. How big? Overlapping or not? What happens when a sentence explaining a concept lands in chunk 7 and the concept is defined in chunk 3?

The vuln bank avoids most of that because it does not store long documents. Each record contains one technique in typed fields:

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

The table also has a generated full-text-search column:

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

A `tsvector` is Postgres's parsed, normalised form of a document for full-text search. Words are reduced to stems, positions are recorded, and stop words are dropped. `generated always as ... stored` means Postgres computes and persists it on every insert and update, so application code never writes it directly.

That powers the keyword half of search. Making it generated removes an application-level sync job because Postgres recomputes the search vector whenever the record changes.

## 03_FOUR_INDEXES_FOUR_SHAPES


The index type depends on the operators, data shape, and workload. This took me longer to understand than the SQL itself.

The records table carries four indexes:

```sql:Postgres
create index records_embedding_idx  on bit.records using hnsw ("embedding" vector_cosine_ops);
create index records_fts_idx        on bit.records using gin  ("fts");
create index records_namespaces_idx on bit.records using gin  ("namespaces");
create index records_cwe_idx        on bit.records using gin  ("cwe");
```

Split them into two jobs and it clicks.

The HNSW index over `embedding` powers semantic retrieval. It can connect a paraphrased symptom such as "cache serves the wrong site's content" with a record about host-header cache poisoning. The GIN index over `fts` powers lexical retrieval by rewarding overlapping lexemes after the query passes through `websearch_to_tsquery`.

That second leg matters because security is full of exact-looking tokens: header names, CVE ids, parameter names, gadget classes, and payload syntax. There is an important limitation, though: PostgreSQL's English FTS parses, stems, and drops stop words. It is lexical search, not byte-for-byte token search, so unusual punctuation and identifiers still need test cases. A future trigram or `simple`-dictionary leg may handle those better.

The other two GIN indexes support optional filters on `namespaces` and `cwe`. They do not affect ranking; they make overlap queries efficient. Their usefulness still depends on correct metadata and a sensible filter from the caller.

Why GIN for three of the four? A **Generalized Inverted Index** supports the containment and overlap operators I use on composite values. A `tsvector` contains lexemes, while `namespaces` and `cwe` are arrays. "Many values means GIN" is a useful first instinct, but the query operators and data distribution still matter.

A scalar column such as `status` or an id will often use a **B-tree**, which keeps values sorted for efficient lookup.

The original schema had a singular `namespace text` column with a B-tree. A password-reset poisoning technique can belong to both `host-header` and `account-takeover`, however, so one label would either lose a retrieval path or force me to duplicate the record. I changed the column to `text[]` and replaced its index:

```sql:MIGRATION_0002
drop index "bit"."records_namespace_idx";
alter table "bit"."records" add column "namespaces" text[] not null;
create index "records_namespaces_idx" on "bit"."records" using gin ("namespaces");
alter table "bit"."records" drop column "namespace";
```

The move from a scalar equality query to array overlap changed the suitable index from B-tree to GIN.

The fourth index is HNSW over a 1024-dimensional vector, and it behaves differently from the GIN and B-tree indexes.

## 04_THE_INDEX_I_CHOSE_WRONG


I started with **IVFFlat**, pgvector's other vector index. The decision seemed reasonable until I looked closely at when IVFFlat learns its clusters.

IVFFlat uses an inverted file of uncompressed vectors. At build time it runs k-means over the existing vectors and picks a set of centroids. If there are 100 centroids, each vector is assigned to its nearest list. A query searches only the nearest few lists instead of most of the table.

The timing matters:

- **At `CREATE INDEX` (or `REINDEX`)**, pgvector runs k-means over whatever rows exist *right then* and freezes the centroids. They never move again.
- **On every `INSERT`**, the new row is assigned to its nearest *existing* centroid's list. No reindex needed; the row is immediately findable.

My migration creates the index on an **empty table**, then the seeder loads the records. The initial centroids therefore had no representative data behind them, and they would not update as the corpus grew from 22 records to 200 or 20,000. Inserts still join an existing list, but the partitioning used at query time remains tied to the earlier corpus.

My first fix was a setting called `probes`, which controls how many lists a query considers:

- **`probes = 100` (all lists).** At that point pgvector can prefer an exact plan rather than use IVFFlat at all. Either way, I had configured away the speed benefit I chose the approximate index for. The seeder also ran a `REINDEX` after loading to rebuild centroids over real data.
- **`probes = 5` (the actual speed optimization).** The query scans only the nearest few lists. If the clusters are poorly balanced, the true nearest neighbour may sit in a list the query never probes.

It worked, but I had configured the approximate index to behave exhaustively and added a maintenance step to the seeder. I would also need to revisit it as the corpus grew. That removed most of the benefit I wanted from IVFFlat.

So I switched to **HNSW** (Hierarchical Navigable Small World) before the first migration shipped. Rather than partitioning space into buckets, HNSW builds a layered graph where each vector is a node linked to its neighbours. Searching means entering at the sparse top layer, greedily walking toward the query, then dropping to denser layers to refine. There are no centroids at all.

Incremental graph construction avoids the centroid-training dependency:

- **No data-at-build-time dependency.** The graph is built incrementally as rows insert, so there's nothing that "learns" from whatever happened to be in the table when the migration ran. The empty-table caveat doesn't exist.
- **No corpus-training step.** The seeder's IVFFlat-specific `REINDEX` is gone. HNSW still has normal database maintenance costs, and deletes, vacuuming, construction settings, memory, and corpus growth remain worth observing.
- **A clearer query-time knob.** `hnsw.ef_search` is the main dial during retrieval. HNSW also has construction-time settings such as `m` and `ef_construction`, so it is not literally a one-knob index.

The tradeoff I accepted: HNSW inserts are heavier and the index uses more memory. For a knowledge base that's read far more than it's written and capped well under a million records, that's a trade I'll take every time.

## 05_WHAT_I_ACTUALLY_LEARNED

I came away with two practical lessons:

- **Index type follows operators, data shape, and workload.** My `namespace` → `namespaces[]` migration changed both the column and the query operator, so the B-tree became a GIN index. That is a useful concrete lesson without turning it into a universal mapping table.
- **Find out *when* your index learns.** IVFFlat learns once, at build time. HNSW learns continuously, on insert. That single difference decided everything downstream: whether the seeder needs a maintenance step, whether recall decays as the corpus grows, and whether a migration running against an empty table is harmless or quietly poisonous. It is the first question I'll ask of any index from now on.

The IVFFlat detour cost me a couple of days and left no code in the repository, but it gave me a much clearer understanding of why HNSW fits this deployment.

## 06_NEXT

The first storage design is in place: one record per retrieval unit, four indexes matched to current query patterns, and an HNSW graph that accepts incremental inserts. None of that proves a query returns the right record yet.

Next up, **[Two Legs, One List](/writing/vuln-bank-hybrid-retrieval)** follows the read path through semantic and lexical search, fusion, reranking, filtered HNSW behavior, and recall@5.
