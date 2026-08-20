---
title: 'Vuln Bank Part 5: Measuring What the Bank Remembers'
titleHtml: 'Vuln Bank Part 5: Measuring What the Bank <em>Remembers</em>'
summary: "The next phase of the vuln bank: making recall@k observable, mapping the knobs that affect it, and testing stronger or security-adapted models without forgetting the small VPS that has to run them."
standfirst: "I have a retrieval pipeline and one recall script. The next job is turning that snapshot into a feedback loop."
date: '2026-08-19'
tag: 'HACKBOT'
readingMinutes: 16
status: 'ONGOING'
chip: 'BUILD_LOG'
---

## 01_THE_HONEST_STARTING_POINT

At the end of [Part 3](/writing/vuln-bank-hybrid-retrieval), I had a number: recall@5 over twenty hand-written queries and twenty known records. That was a useful moment. It proved the real pipeline could retrieve something other than the wording it had just ingested.

It did not prove the bank was good.

Twenty queries are a smoke test. They do not represent the vocabulary, ambiguity, filters, misspellings, product names, payload fragments, or half-formed observations bit will produce during a real hunt. The harness runs when I remember to run it, prints one aggregate, and leaves no history. If recall drops next week, I cannot tell whether the cause was an embedding model, a reranker, a candidate limit, a new namespace, or a change in the corpus.

The next phase is therefore not "install a better model." It is **build enough observability to know what better means**.

## 02_RECALL_AS_A_TIME_SERIES

The current harness has one gold record per query, so its reported recall@k is also success@k: did the expected record appear in the first `k` results?

```text:CURRENT_METRIC
success@k = queries with the expected record in top k / all evaluated queries
```

That stays as the headline because it maps directly to the product: bit receives five records, so an expected methodology outside the top five is unavailable to it. But I want every evaluation run to record more than one number:

- **success@1, @3, @5, and @10** to show whether a change improves retrieval or merely pushes the same answer around;
- **MRR@10** to make rank movement visible when the gold record is present;
- **candidate recall before reranking** to separate retrieval failures from reranker failures;
- **dense-only, lexical-only, fused, and reranked results** for a small ablation on every run;
- **p50 and p95 latency** for embedding, both database legs, fusion, reranking, and end to end;
- **candidate counts and eligible-row counts** so a short dense list is not automatically blamed on HNSW;
- **model revision, serving image, dimensions, corpus version, evaluation-set version, and all retrieval settings** so two runs are actually comparable.

The unit I care about is an evaluation run, not a log line. Each run should have an id and immutable configuration, with per-query results underneath it:

```json:EVAL_RUN
{
  "run_id": "2026-08-19T18:42:11Z",
  "corpus_version": "seed-0002",
  "eval_set": "security-retrieval-v2",
  "embedding": "BAAI/bge-m3@<revision>",
  "reranker": "BAAI/bge-reranker-v2-m3@<revision>",
  "candidate_k": 30,
  "fused_k": 20,
  "output_k": 5,
  "hnsw_ef_search": 100,
  "success_at_5": 0.0,
  "p95_ms": 0
}
```

Those zeroes are deliberate placeholders. I do not want to publish a benchmark result I have not reproduced and stored.

Once runs are persisted, the useful view is a graph: recall and latency over time, annotated with model, corpus, and configuration changes. A regression threshold can then fail CI or block a deployment. At first I will use both an absolute floor and a "no worse than baseline" check; with a tiny evaluation set, one miss moves the score by five percentage points, so pretending the estimate is precise would be silly.

## 03_BUILDING_A_TEST_SET_I_CAN_TRUST

The metric is the easy part. The gold set is the work.

I want to grow it in layers:

- **Curated paraphrases:** queries that describe an observation without repeating the record title or vulnerability class.
- **Lexical needles:** CVE ids, header names, parameters, framework symbols, payload fragments, and punctuation-heavy tokens that English FTS may split badly.
- **Confusable negatives:** techniques that share vocabulary but require different preconditions, such as cache poisoning versus host-header password-reset poisoning.
- **Filtered cases:** the same query under different namespace, CWE, product, and quality-tier filters.
- **No-answer cases:** queries for which the bank has no suitable methodology, so returning a plausible neighbor is not counted as success.
- **Queries from real use:** sanitised and reviewed traces of what bit actually asked, especially misses and reformulations.

One gold id per query is convenient but often false. A methodology question can have several useful answers, and relevance can be graded. I eventually want judgments such as `essential`, `useful`, `related`, and `irrelevant`, made without looking at which model produced the candidate. That opens the door to nDCG and gives the reranker a much fairer test.

I also need a frozen holdout. If every miss becomes a new test and I tune against all of them, I will build an excellent retriever for yesterday's mistakes. A development set is for choosing knobs; the holdout is for checking whether those choices generalise.

## 04_THE_KNOBS_BEFORE_THE_MODELS

Model swaps are expensive and visible, so they attract attention. Several cheaper knobs may matter just as much:

| Knob | Current baseline | What it trades |
| --- | --- | --- |
| Dense candidates | 30 | More recall versus database work and a larger fusion pool |
| Lexical candidates | 30 | More exact-term coverage versus database work |
| RRF constant | 60 | How strongly adjacent ranks differ |
| Fused candidates | 20 | More reranker opportunity versus CPU latency |
| Returned `k` | 5 | Agent coverage versus context cost and distraction |
| `hnsw.ef_search` | 100 | ANN exploration, latency, and sometimes the chosen query plan |
| Embedded fields | `symptom + procedure` | Semantic signal versus noise and truncation |
| Reranked fields | `title + symptom + procedure` | Pair quality versus token count and latency |
| FTS dictionary | `english` | Stemming and natural language versus literal security tokens |

I will change one family at a time. First candidate widths and `ef_search`, then representation fields, then lexical analysis, then models. Every run gets the same corpus and gold set, a warm-up, repeated latency samples, and a cold-start measurement. A configuration only wins if the gain survives across vulnerability classes and still fits the operational budget.

There are two especially interesting representation experiments. The first is adding `title`, `when_to_use`, and `confirmation_signal` to the dense text instead of embedding only `symptom + procedure`. The second is splitting natural-language FTS from literal identifiers, perhaps with a `simple` dictionary or trigram index. Better input can outperform a larger model, and it is much cheaper to test.

## 05_WHY_BGE_M3_IS_THE_BASELINE

The current pair is [`BAAI/bge-m3`](https://huggingface.co/BAAI/bge-m3) for 1024-dimensional dense embeddings and [`BAAI/bge-reranker-v2-m3`](https://huggingface.co/BAAI/bge-reranker-v2-m3) for cross-encoder reranking.

I did not choose them because I had proven they were the best cybersecurity models. I chose them because they were a credible, compatible pair that I could serve locally on CPU through Hugging Face Text Embeddings Inference. BGE-M3 supports long inputs and many languages, its 1024 dimensions fit pgvector cleanly, and the reranker is described by its authors as the lightweight member of their v2 family.

Most importantly, they ran on the VPS I already had.

Even then, the default TEI token budget caused an out-of-memory kill during model loading, so both services now use a 2048-token batch cap and automatic truncation. That constraint is not an embarrassing footnote; it is part of the architecture. A model that improves success@5 by two points but needs a GPU or turns every retrieval into a ten-second pause is not an upgrade for this deployment.

There was also a simpler reason: I needed to make a decision and keep moving. It is easy to spend two weeks reading embedding leaderboards before the system has one trustworthy evaluation query. BGE-M3 gave me a sound baseline against which future decisions can be evidence rather than taste.

One correction to my earlier language: only the model IDs and dimensions are fixed today. The production compose files still use `cpu-latest`, and no Hugging Face commit revision is pinned. Pinning both is part of the observability work because a baseline that can change underneath me is not a baseline.

## 06_MODELS_WORTH_TESTING

There are two different ideas hiding behind "a cybersecurity model," and I need to keep them separate.

The first is a **stronger retrieval model** trained for semantic search. Examples include [`jinaai/jina-embeddings-v3`](https://huggingface.co/jinaai/jina-embeddings-v3), with task-specific retrieval adapters and configurable dimensions, and [`NovaSearch/stella_en_1.5B_v5`](https://huggingface.co/NovaSearch/stella_en_1.5B_v5), an English retrieval model that supports Matryoshka dimensions. These are plausible retrieval candidates out of the box. Stella's roughly 1.5B-class backbone is also much heavier than BGE-M3, so CPU memory and latency may reject it before recall does. Jina v3 changes the query/document prompting contract, which means the experiment must apply its retrieval task correctly rather than merely swapping a model id.

The second is a **cybersecurity language model** such as [`ehsanaghaei/SecureBERT`](https://huggingface.co/ehsanaghaei/SecureBERT) or its newer Cisco successor. SecureBERT was pretrained on cybersecurity text, so vocabulary such as malware families, indicators, and threat intelligence should be less foreign to it than to a general encoder. But its published checkpoint is a masked-language-model backbone, not a sentence-retrieval model. Mean-pooling its hidden states and calling that an embedding would not be a fair comparison.

The interesting experiment is to use a cybersecurity encoder as the starting point for **contrastive fine-tuning** on `(query, relevant methodology, hard negative)` triples. That could teach both the domain language and the retrieval objective. It also creates a model I have to train, version, evaluate, and maintain, so it comes after the benchmark, not before it.

The reranker has a similar ladder:

- keep `bge-reranker-v2-m3` as the CPU-friendly baseline;
- test a small English cross-encoder such as `cross-encoder/ms-marco-MiniLM-L-6-v2` for latency, accepting that web-search training is not security training;
- test the larger BGE v2 Gemma or MiniCPM rerankers if hardware allows, since BAAI positions them above v2-m3 for quality but at a much higher serving cost;
- fine-tune a DeBERTa or SecureBERT-family sequence classifier on my graded security relevance pairs, with hard negatives from the current retriever.

Domain adaptation is most likely to help on the hard distinctions: two records that share "Host header" but differ in exploit preconditions, or a terse symptom that never names the vulnerability. It can also overfit to familiar jargon and become worse at the messy language bit actually uses. That is exactly why the holdout and per-category breakdown matter.

## 07_THE_EXPERIMENT_ORDER

To keep this from becoming an endless model bake-off, I want a fixed order:

1. **Freeze the baseline.** Pin model revisions and inference images; persist current per-query outputs and latency.
2. **Grow the evaluation set.** Add confusable, filtered, literal-token, multilingual, and no-answer cases; keep a holdout.
3. **Instrument the pipeline.** Store stage timings, candidate ids and ranks, pool sizes, filter selectivity, truncation, and configuration.
4. **Tune cheap knobs.** Candidate widths, `ef_search`, FTS behavior, and which fields each stage sees.
5. **Run ablations.** Dense only, lexical only, fusion without reranking, and the full pipeline.
6. **Swap general retrieval models.** Re-embed into a parallel index, compare quality and resource use, then discard or promote.
7. **Try domain adaptation.** Fine-tune only after the error set is large enough to tell me what the model needs to learn.

Parallel indexes matter here. Replacing the live `vector(1024)` column in place would turn an experiment into a migration. A model-versioned embedding table lets old and new models retrieve the same record ids side by side, supports shadow evaluation, and gives me a rollback path.

## 08_WHAT_SUCCESS_LOOKS_LIKE

The goal is not the highest recall number I can produce on a laptop. It is a retrieval system whose behavior I can explain:

- I can see when success@5 regresses and which query categories moved.
- I can tell whether the miss happened during candidate generation, fusion, or reranking.
- I know the latency and memory cost of every claimed improvement.
- I can reproduce a run from pinned code, models, data, and configuration.
- I can change models without overwriting the last known-good index.

That is less glamorous than announcing a cybersecurity embedding model. It is also the work that makes such a model useful.

The first four posts were about making bit remember. This next phase is about noticing what it forgets, and learning from every miss.
