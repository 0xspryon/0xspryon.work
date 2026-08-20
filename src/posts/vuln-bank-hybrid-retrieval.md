---
title: 'Vuln Bank Part 3: Two Legs, One List'
titleHtml: 'Vuln Bank Part 3: Two Legs, <em>One List</em>'
summary: "The vuln bank's read path combines semantic and lexical retrieval with Reciprocal Rank Fusion, reranking, and a recall@5 evaluation harness."
standfirst: "Everything here is one question asked four different ways: when bit asks for a playbook, does it get the right one?"
date: '2026-08-18'
tag: 'HACKBOT'
readingMinutes: 12
status: 'ONGOING'
chip: 'BUILD_LOG'
---

## 01_WHERE_WE_LEFT_OFF

[Part 2](/writing/vuln-bank-indexes) covered how the vuln bank stores knowledge: one technique per record, four indexes for the current query patterns, and HNSW over the embedding. This post starts when a query arrives.

This post follows a query through two parallel searches, rank fusion, reranking, and the initial measurement used to check the result.

There's also a failure mode in here. A filtered approximate search can return fewer candidates than requested without raising an error. I report the symptom today while I work toward detecting its cause more reliably.

The source code for all what has been discussed in the series so far can be found [here](https://github.com/0xspryon/bit_mcp/tree/e54935f8926c45737f8404b23bbd63dac62de556) in the `rag-core` package to be precise.

## 02_TWO_LEGS_ONE_LIST


So a query arrives. Here's the whole read path before we zoom in:

```text:READ_PATH
  query
    │
    ├─ validate (Effect Schema)
    ├─ build HARD filter: status='active' + namespaces/cwe/product/tier
    │
    ├──────────────┬──────────────┐
    │   dense leg  │  lexical leg │   ← run in parallel
    │   embed →    │  websearch_  │
    │   HNSW knn   │  to_tsquery  │
    │   30 rows    │  30 rows     │
    └──────────────┴──────────────┘
                   │
                RRF fuse  → 20 survivors
                   │
             cross-encoder rerank
                   │
                 top k=5
                   │
            hydrate sources → Chunk[]
```

[Both legs run concurrently](https://github.com/0xspryon/bit_mcp/blob/e54935f8926c45737f8404b23bbd63dac62de556/packages/rag-core/src/retriever.ts#L90-L92), they're independent, so `Effect.all` with unbounded concurrency means the query waits for the slower one, not for their sum. Each returns up to 30 candidates.

The two searches return scores on different scales. The dense leg produces a cosine distance, roughly `[0, 2]`, where smaller is better. The lexical leg produces an unbounded `ts_rank` where larger is better and the magnitude depends on term frequency and document length. A cosine distance of 0.31 cannot be compared directly with a `ts_rank` of 0.089. Min-max or z-score normalisation is possible, but either approach adds tuning choices and can behave poorly when one list is lopsided.

**[Reciprocal Rank Fusion](https://github.com/0xspryon/bit_mcp/blob/e54935f8926c45737f8404b23bbd63dac62de556/packages/rag-core/src/rrf.ts#L12)** avoids comparing the raw scores by using only rank order. A document's fused score is:

```text:RRF
score(d) = Σ  1 / (k + rank_of_d_in_list)     over every list d appears in
                                               (rank is 1-based, k = 60)
```

The first item in a list contributes `1/61`, the second `1/62`, and so on. A document appearing in both lists receives both contributions.

Let me work a concrete example, because the arithmetic is where the intuition lives. Say the dense leg returns `[A, B, C]` and the lexical leg returns `[B, C, A]`:

```text:WORKED_EXAMPLE
A: 1/(60+1) + 1/(60+3) = 0.016393 + 0.015873 = 0.032266
B: 1/(60+2) + 1/(60+1) = 0.016129 + 0.016393 = 0.032522   ← winner
C: 1/(60+3) + 1/(60+2) = 0.015873 + 0.016129 = 0.032002

fused order: B, A, C
```

**B** wins because both legs ranked it highly. A record appearing at rank 1 in only one list scores `1/61 = 0.0164`, about half the scores above. RRF therefore favors candidates found by both retrieval methods. That seems useful for this corpus, but the evaluation set still has to show whether it improves real queries.

RRF also keeps the initial setup fairly small:

- **Little tuning to get started.** No score normalisation or per-leg calibration. The `k = 60` constant is a common default and acts as a dampener. It is still a knob, alongside candidate widths and any future per-leg weights, so it belongs in the evaluation matrix rather than above questioning.
- **It degrades gracefully.** If the lexical leg returns nothing, RRF just ranks the dense list. No special-casing, no divide-by-zero, no empty result.

The implementation is 25 lines of dependency-free TypeScript. It dedupes by id and breaks score ties by id ascending, which removes one avoidable source of nondeterminism. Full reproducibility also needs pinned model revisions, serving images, database versions, and evaluation data; I do not have all of that pinned yet.

## 03_CHEAP_AND_WIDE_THEN_EXPENSIVE_AND_NARROW


RRF fuses down to 20 survivors, and those go to a **cross-encoder reranker**.

Embedding models and rerankers work differently. An embedding model is a **bi-encoder**: it reads the query and record separately, makes a vector for each, and compares them. This allows record vectors to be computed ahead of time. A cross-encoder reads the query and record together and outputs a relevance score. That richer interaction often improves ordering, but it requires one inference per pair and has to justify its cost on this corpus.

The reranker receives `title\nsymptom\nprocedure`. The dense embedding contains only `symptom\nprocedure`, so the reranker also sees the title and evaluates the full text together with the query.

So the fan-out widths in the pipeline are exactly the shape of that tradeoff:

```ts:TypeScript
const CANDIDATE_K = 30; // candidates returned by each retrieval leg
const FUSED_K     = 20; // candidates passed to the reranker
// ...then q.k (default 5) chunks are returned
```

RRF needs to preserve useful candidates for the reranker. Its exact ordering matters less at this stage because the cross-encoder scores the twenty survivors again. This makes candidate recall before reranking an important measurement.

## 04_THE_BUG_APPROXIMATE_INDEXES_HIDE


Approximate search and filtering have a known interaction that matters here. This is not a pgvector correctness bug.

Look at the dense query and tell me what it does:

```ts:TypeScript
db.select(recordReadColumns)
  .from(records)
  .where(and(...recordFilterConditions(f)))          // namespace, cwe, status…
  .orderBy(asc(sql`${records.embedding} <=> ${vec}`)) // cosine distance
  .limit(k);                                          // k = 30
```

It reads like three phases: filter the table, order the survivors by distance, take 30. That is not what happens, and the difference is the bug.

Postgres executes this as a **pipeline**. There is no moment where all rows are filtered, and no moment where all rows are ordered. The `Limit` node pulls one row at a time from the index scan; the scan walks the HNSW graph to the next-nearest row, applies the `WHERE` to it, discards it on a miss and walks on, yields it on a hit; the `Limit` counts only survivors and stops the walk once it has 30.

The filter is applied before a row counts toward `k`, so this is not a simple "take 30 and filter them down" query. The problem is that the graph walk is finite. Eligible rows outside the explored region are never visited. In rough terms:

```text:FAILURE_MODE
rows returned  ≈  rows visited  ×  filter selectivity
```

and when that product lands under `k`, you get a short list and **no error**. Measured on pgvector 0.8.6 against 20k rows, `k = 30`, `ef_search = 100`:

```text:MEASURED
filter selectivity 33%    ->  92 rows visited,  30 returned   (fine)
filter selectivity  2%    ->  index chosen,     18 returned   (short result)
filter selectivity  0.1%  -> 703 rows visited,   0 returned   (empty!)
```

In the 0.1% case, matching records existed but the query returned none and raised no error.

The query planner often switches to an exact scan-and-sort plan below roughly 1 to 2 percent selectivity. That threshold is only a cost estimate and changes with table size, statistics, `ANALYZE`, and `ef_search`. The risky range is where a filter starves the graph walk without making the planner choose the exact plan.

Measuring `ef_search` showed that it affects both execution and planning:

1. **At execution**, it bounds the graph walk, capping how many rows can survive the `WHERE`. Same setup as above: `ef_search = 10` → 2 rows back; `40` → 10 rows; `100` → 18 rows.
2. **At planning**, it feeds pgvector's cost estimate for the index path and can influence whether the index is used. In the same test, `ef_search = 100` chose the index and returned 18 rows. At `ef_search = 200`, Postgres switched to a sequential scan and returned all 30.

Raising `ef_search` can therefore improve the graph search or cause Postgres to choose a different plan. I documented both behaviors beside the constant in `record-repo.ts` so I remember to measure again before changing it.

I could mitigate this with a partial index matching the always-on predicate (`status = 'active' and deleted_at is null`), or `hnsw.iterative_scan` with a raised `max_scan_tuples`. For now I expose a warning signal, because a short list that looks exhaustive is more dangerous than one that admits uncertainty:

```ts:TypeScript
// Recorded before fusion. After RRF there is no way to tell a starved
// dense leg from a dense leg that simply agreed with the lexical one.
const diagnostics = {
  semantic_search_k: CANDIDATE_K,
  semantic_search_count: denseRows.length,
  semantic_search_degraded: denseRows.length < CANDIDATE_K,
  lexical_search_k: CANDIDATE_K,
  lexical_search_count: lexicalRows.length
};
```

The placement is useful, but the name currently over-promises. `denseRows.length < 30` only proves the candidate pool was short. It does **not** prove HNSW starved: perhaps only twelve active records matched the filter. The next version needs the eligible-row count, the chosen query plan, or a sampled exact-search comparison before it can call the search genuinely degraded.

Real embeddings may behave better than the synthetic figures because `bge-m3` vectors cluster by topic and `namespaces` often correlates with topic. An on-topic query can move the graph walk toward rows that pass the filter. A query whose meaning does not align with its namespace can still expose the failure mode, especially when an agent constructs its own filters.

## 05_HOW_I_KNOW_ANY_OF_THIS_WORKS


I use **recall@k** for an initial check of whether the pipeline retrieves the expected records.

In information retrieval, for a single query with a known set of relevant documents:

```text:RECALL_AT_K
recall@k(q) = |Relevant(q) ∩ Retrieved_k(q)| / |Relevant(q)|
```

For a query `q`:

- `Relevant(q)` is the set of records judged relevant to the query.
- `Retrieved_k(q)` is the set of records returned in the first `k` positions.
- `∩` keeps only records that belong to both sets.
- `|S|` is the cardinality of set `S`, meaning the number of elements it contains.

Suppose two records are relevant, `Relevant(q) = {A, B}`, and the top five results are `Retrieved_5(q) = {B, C, D, E, F}`. The intersection is `{B}`, so:

```text:RECALL_EXAMPLE
recall@5(q) = |{A, B} ∩ {B, C, D, E, F}| / |{A, B}|
            = |{B}| / 2
            = 0.5
```

The five returned records are not used as the numerator. Only the one returned record that is also relevant counts. This keeps recall bounded between 0 and 1. If a relevant answer is at rank 8 and the caller receives only five records, it is absent from `Retrieved_5(q)` and counts as a miss.

Across `N` evaluation queries, I can report macro-average recall by giving each query equal weight:

```text:MACRO_RECALL_AT_K
macro_recall@k = (1 / N) × Σ recall@k(q_i), for i = 1..N
```

It helps to see what recall@k is *not*:

- **precision@k:** of the `k` returned records, how many were relevant?
- **MRR / nDCG:** where did a relevant record appear in the ranking?

Recall@5 is the first metric I care about because the retriever returns five chunks and the agent can inspect all five. A relevant playbook at rank 8 is invisible. But recall is not the only metric that matters: irrelevant records consume context and can distract the model, while rank 1 is still more likely to influence it than rank 5. I will keep recall@5 as the headline and add MRR or nDCG plus latency as the test set grows.

The harness seeds about 20 records into a scratch namespace, promotes them to `active`, then runs about 20 `(query → expected record id)` pairs through the live embedding server, reranker, and Postgres database:

```ts:TypeScript
let hits = 0;
for (const { query, id } of expected) {
  const { chunks } = await retrieve({ query, namespaces: ['eval'], k: 5 });
  if (chunks.slice(0, 5).some((c) => c.id === id)) hits += 1;
}
console.log(`recall@5 = ${(hits / expected.length).toFixed(3)}`);
```

The pairs try to paraphrase the records, although the first set still shares obvious anchors such as "reset" and "host header." That makes it a smoke test, not a hard semantic benchmark. Better cases need aliases, abbreviations, symptoms without vulnerability names, and realistic queries collected from bit's work.

With one gold document per query, `|Relevant(q)| = 1`, so per-query recall can only be 0 or 1. In that special case, macro recall@k is numerically equal to hit-rate@k or success@k: the fraction of queries whose expected record appeared in the first `k` results.

The next improvements are more query pairs, multiple gold ids, and recall@1, @3, and @10. MRR@k can follow when I have enough judgments to make rank within the window meaningful.

## 06_WHAT_I_ACTUALLY_LEARNED

The implementation left me with three practical lessons:

- **"Approximate" applies to which rows are found, not only their order.** An ANN index combined with a filter can return fewer rows than requested without an error. Candidate counts need to be captured before fusion removes that information.
- **Start with fewer tuning requirements.** RRF avoids score normalisation and still works when one retrieval leg is empty. Its constant and candidate limits remain settings to evaluate, but it gave me a simpler baseline.
- **Pick the metric that matches your consumer.** recall@5 is right here *only* because the agent reads all five results. A UI showing one answer would want MRR. Copying a metric from a paper whose consumer behaves differently is how you optimise the wrong number confidently.

All three findings point to the same practical need: expose uncertainty and measure it rather than assuming the pipeline is complete.

## 07_NEXT

The engine now has an initial measurement harness and reports some of its limits. Next up, **[the MCP interface](/writing/vuln-bank-mcp-doorway)** turns retrieval into a tool an agent can call while keeping methodology separate from target evidence.
