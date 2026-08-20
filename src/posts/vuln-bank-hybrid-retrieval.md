---
title: 'Vuln Bank Part 3: Two Legs, One List'
titleHtml: 'Vuln Bank Part 3: Two Legs, <em>One List</em>'
summary: "The read path of the vuln bank — how Reciprocal Rank Fusion merges two rankings whose scores can't be compared, what a cross-encoder buys over an embedding model, the short list an approximate index hands you without erroring, and measuring the whole thing with recall@5."
standfirst: "Everything here is one question asked four different ways: when bit asks for a playbook, does it get the right one?"
date: '2026-08-18'
tag: 'HACKBOT'
readingMinutes: 18
status: 'ONGOING'
chip: 'BUILD_LOG'
---

## 01_WHERE_WE_LEFT_OFF

[Part 2](/writing/vuln-bank-indexes) settled how the vuln bank *stores* knowledge: one technique per record, four indexes each matched to the shape of its column, and HNSW over the embedding so the vector index maintains itself. That's everything that happens before a query exists.

This post is the query. We follow one from the moment it arrives to the moment five chunks come back — through two searches that run in parallel, a merge step for rankings that can't be compared, a reranker, and finally the measurement that tells me whether the whole apparatus is doing its job.

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

And now the interesting problem. I have two ranked lists and I need one. But their scores are **not comparable**. The dense leg produces a cosine distance — roughly `[0, 2]`, smaller is better. The lexical leg produces a `ts_rank` — unbounded, larger is better, magnitude depending on term frequency and document length. There is no principled way to say a cosine distance of 0.31 is "worth" a ts_rank of 0.089. You can normalise — min-max or z-score each list — but every normalisation scheme is a tuning parameter you own forever, and it breaks the moment one list comes back lopsided.

**[Reciprocal Rank Fusion](https://github.com/0xspryon/bit_mcp/blob/e54935f8926c45737f8404b23bbd63dac62de556/packages/rag-core/src/rrf.ts#L12)** dodges the entire problem by throwing the scores away and keeping only the *rank order*. A document's fused score is:

```text:RRF
score(d) = Σ  1 / (k + rank_of_d_in_list)     over every list d appears in
                                               (rank is 1-based, k = 60)
```

That's it. The first item in a list contributes `1/61`, the second `1/62`, and so on. A document appearing in *both* lists gets both contributions added together.

Let me work a concrete example, because the arithmetic is where the intuition lives. Say the dense leg returns `[A, B, C]` and the lexical leg returns `[B, C, A]`:

```text:WORKED_EXAMPLE
A: 1/(60+1) + 1/(60+3) = 0.016393 + 0.015873 = 0.032266
B: 1/(60+2) + 1/(60+1) = 0.016129 + 0.016393 = 0.032522   ← winner
C: 1/(60+3) + 1/(60+2) = 0.015873 + 0.016129 = 0.032002

fused order: B, A, C
```

**B** wins despite not being ranked first by the *dense* leg, because both legs rated it highly. And here's the number that shows what RRF is really optimising for: a record that appeared at rank 1 in only *one* list would score `1/61 = 0.0164` — barely half of any of the three above, placing it below all of them. Agreement between two independent retrieval strategies beats a strong showing in one. In practice that heuristic is excellent: a record that both "sounds like what you meant" *and* "contains the words you typed" is almost always the one you wanted.

Two things I like about RRF beyond the results:

- **Little tuning to get started.** No score normalisation or per-leg calibration. The `k = 60` constant is a common default and acts as a dampener. It is still a knob, alongside candidate widths and any future per-leg weights, so it belongs in the evaluation matrix rather than above questioning.
- **It degrades gracefully.** If the lexical leg returns nothing, RRF just ranks the dense list. No special-casing, no divide-by-zero, no empty result.

The implementation is 25 lines of dependency-free TypeScript. It dedupes by id and breaks score ties by id ascending, which removes one avoidable source of nondeterminism. Full reproducibility also needs pinned model revisions, serving images, database versions, and evaluation data; I do not have all of that pinned yet.

## 03_CHEAP_AND_WIDE_THEN_EXPENSIVE_AND_NARROW


RRF fuses down to 20 survivors, and those go to a **cross-encoder reranker**.

The distinction is worth stating plainly, because "embedding model" and "reranker" get used interchangeably and they're architecturally different. An embedding model is a **bi-encoder**: it reads the query and record separately, makes a vector for each, and compares them. That separation is what makes it fast. A cross-encoder reads query and record together and outputs a relevance score directly. This richer interaction often improves ordering, but it costs one inference per pair and has to earn its place on my corpus through measurement.

"Document," concretely, is three fields glued together — `title\nsymptom\nprocedure` — so the cross-encoder scores the query against the same text the dense leg embedded, plus the `title` the embedding left out. Same record, read two ways: once compressed to a point ahead of time, once read in full against the actual query.

So the fan-out widths in the pipeline are exactly the shape of that tradeoff:

```ts:TypeScript
const CANDIDATE_K = 30; // per-leg candidate pool  — cheap, recall-oriented
const FUSED_K     = 20; // survivors to the reranker — expensive, precision-oriented
// ...then q.k (default 5) chunks are returned
```

Cheap and wide first, expensive and narrow second. RRF's job is *recall*: get the right candidates into the shortlist. It's allowed to be approximate about their ordering because the reranker reorders them properly afterward. What RRF must never do is drop the right record before the reranker gets a look — and that framing is what tells you which metric to measure. That's section 05.

## 04_THE_BUG_APPROXIMATE_INDEXES_HIDE


This is the part I'd most want someone to have told me, so it gets its own section. It is a known interaction between approximate search and filtering, not a pgvector correctness bug.

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

The good news is that the filter is applied *before* anything counts toward `k` — you never get "top 30, then filtered down to 4." Every row the walk discards is discarded correctly.

The bad news is that **the walk is finite**. Rows that *would* pass the filter but sit outside the region the graph walk explores are never visited at all. So:

```text:FAILURE_MODE
rows returned  ≈  rows visited  ×  filter selectivity
```

and when that product lands under `k`, you get a short list and **no error**. Measured on pgvector 0.8.6 against 20k rows, `k = 30`, `ef_search = 100`:

```text:MEASURED
filter selectivity 33%    ->  92 rows visited,  30 returned   (fine)
filter selectivity  2%    ->  index chosen,     18 returned   (short — silently)
filter selectivity  0.1%  -> 703 rows visited,   0 returned   (empty!)
```

That 0.1% row is the one that should make you sit up. There are matching records in the table. The query is correct. It returns nothing, successfully.

What mostly saves you is the query planner: below roughly 1–2% selectivity it costs the HNSW path above a sequential scan and switches to scan-plus-sort, which is exact and returns everything. But that's a *cost estimate*, not a guarantee — it shifts with table size, statistics, a stale `ANALYZE`, and `ef_search`. The exposed band is filters selective enough to starve the walk but not selective enough to trigger the switch.

Speaking of `ef_search` — the HNSW recall knob — measuring it taught me it does **two** jobs, and I only knew about the first:

1. **At execution**, it bounds the graph walk, capping how many rows can survive the `WHERE`. Same setup as above: `ef_search = 10` → 2 rows back; `40` → 10 rows; `100` → 18 rows.
2. **At planning**, it feeds pgvector's cost estimate for the index path — so it also decides whether the index gets used *at all*. In that same test, `ef_search = 100` chose the index and returned 18 rows, while `ef_search = 200` made the index look expensive enough that Postgres switched to a sequential scan and returned all 30.

So "raise `ef_search` for more recall" is only true up to a threshold, past which you're not tuning recall — you're flipping the plan. Both behaviours are documented at the constant in `record-repo.ts`, with the numbers, because future-me will absolutely try to bump that value without re-measuring.

I could mitigate this with a partial index matching the always-on predicate (`status = 'active' and deleted_at is null`), or `hnsw.iterative_scan` with a raised `max_scan_tuples`. For now I expose a warning signal, because a short list that looks exhaustive is more dangerous than one that admits uncertainty:

```ts:TypeScript
// Recorded BEFORE fusion — after RRF there is no way to tell a starved
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

Real embeddings are also kinder than those numbers suggest, and it's worth knowing why: `bge-m3` vectors cluster by topic, and `namespaces` correlates with topic. So for an on-topic query the walk moves *toward* the surviving set rather than orthogonally to it. The pathological case is a query whose semantics don't align with its namespace filter — which, for an autonomous agent that composes its own filters, is not a hypothetical.

> An approximate index plus a `WHERE` clause is not "filter, then rank."
>
> It's a bounded walk that discards as it goes — and it will hand you a short list with a `200 OK`.

## 05_HOW_I_KNOW_ANY_OF_THIS_WORKS


Everything above is machinery. None of it is evidence. So: **recall@k**.

In information retrieval, for a single query with a known set of relevant documents:

```text:RECALL_AT_K
recall@k(q) = |Relevant(q) ∩ Retrieved_k(q)| / |Relevant(q)|
```

In words: of the documents that *should* have come back, what fraction actually appeared in the top *k* results? It deliberately ignores everything below rank `k` — if the right answer is at rank 8 and you only show 5, it didn't help you, so it counts as a miss.

The intersection in the numerator is worth a sentence, because it's the part I had to think about. If `k` is larger than the number of relevant documents, `Retrieved_k(q)` will contain more items than `Relevant(q)` does — so you can't just count what came back. Intersecting first restricts the count to *retrieved documents that are actually relevant*, which keeps the ratio bounded at 1.0 and keeps the metric honest.

It helps to see what recall@k is *not*:

- **precision@k** — of the `k` you returned, how many were relevant? (Are you returning junk?)
- **MRR / nDCG** — *where* in the top-k did the relevant item land? (Rank 1 vs rank 5.)

Recall@5 is the first metric I care about because the retriever returns five chunks and the agent can inspect all five. A relevant playbook at rank 8 is invisible. But recall is not the only metric that matters: irrelevant records consume context and can distract the model, while rank 1 is still more likely to influence it than rank 5. I will keep recall@5 as the headline and add MRR or nDCG plus latency as the test set grows.

The harness itself is deliberately boring. It seeds ~20 records into a scratch namespace, promotes them to `active`, then runs ~20 `(query → expected record id)` pairs through the **real** pipeline — live embedding server, live reranker, real Postgres, no mocks anywhere:

```ts:TypeScript
let hits = 0;
for (const { query, id } of expected) {
  const { chunks } = await retrieve({ query, namespaces: ['eval'], k: 5 });
  if (chunks.slice(0, 5).some((c) => c.id === id)) hits += 1;
}
console.log(`recall@5 = ${(hits / expected.length).toFixed(3)}`);
```

The pairs try to paraphrase the records, although the first set still shares obvious anchors such as "reset" and "host header." That makes it a smoke test, not a hard semantic benchmark. Better cases need aliases, abbreviations, symptoms without vulnerability names, and realistic queries collected from bit's work.

With one gold document per query this is technically also called hit-rate@k or success@k — every query scores either 0 or 1, and the reported number is just the fraction of queries whose correct record made the top 5.

The obvious next moves, when I need more resolution: more pairs, multiple gold ids per query, reporting recall@1/@3/@10 side by side to see how tight the top of the ranking is, and adding MRR@k *if* rank-within-the-window ever starts to matter. It doesn't yet, and adding a metric you don't act on is just a number that makes you feel rigorous.

> A retrieval system without a recall number is a vibe.
>
> Measure the window you actually ship. If the agent reads five, measure five.

## 06_WHAT_I_ACTUALLY_LEARNED

Standing back from the read path, three things generalise well beyond this project:

- **"Approximate" is a claim about the search, not just the ranking.** An ANN index plus a filter can return fewer rows than you asked for, with no error. If you can't fix it today, *measure it and report it* — capturing the evidence before it's destroyed is a design decision, not an afterthought.
- **Prefer the technique with no knobs.** RRF beat score normalisation not because it ranks better, but because it needs nothing tuned and degrades gracefully when a leg comes back empty. Every parameter you introduce is one someone has to be right about later.
- **Pick the metric that matches your consumer.** recall@5 is right here *only* because the agent reads all five results. A UI showing one answer would want MRR. Copying a metric from a paper whose consumer behaves differently is how you optimise the wrong number confidently.

The thread running through all three: every one of them is a decision about what to do when you *can't* be certain — the index might come up short, the fusion might mis-rank, the metric might be measuring the wrong thing. The answer was never to eliminate the uncertainty. It was to make it visible and then check it on purpose.

## 07_NEXT

The engine now has an initial measurement harness and the read path reports some of its limits. Next up: **[the MCP interface](/writing/vuln-bank-mcp-doorway)** — turning this into a tool an agent can call, and keeping retrieved theory distinct from evidence about a live target.

*The engine knows how to find things. Teaching an agent how to ask is a different problem entirely.*
