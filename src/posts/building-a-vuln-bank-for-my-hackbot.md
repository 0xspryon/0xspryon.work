---
title: 'Building a Vuln Bank for My Hackbot'
titleHtml: 'Building a <em>Vuln Bank</em> for My Hackbot'
summary: "A build log about giving my bug-hunting agent a long-term memory: a curated vulnerability knowledge base served over MCP, including the tradeoffs and wrong turns."
standfirst: 'My hackbot has no memory of how to hack. This is the series where I build it one.'
date: '2026-08-02'
tag: 'HACKBOT'
readingMinutes: 5
status: 'ONGOING'
chip: 'BUILD_LOG'
---

## 01_THE_GAP

I'm building a hackbot called **[bit](https://bit.0xspryon.work)**, an agent that helps me hunt for vulnerabilities. The more I use it, the clearer one gap becomes: it has no long-term memory of *how to hack*. Every session, I end up supplying the same knowledge about how to investigate a class of bug all over again.

That knowledge shouldn't be ephemeral. It should be a durable, growing asset the bot can reach for on every engagement. So I'm building a **vuln bank**: a curated knowledge base of vulnerability classes, techniques, signals, and chains, exposed through MCP so bit can ask for a useful methodology when it needs one. "Useful" matters here; retrieval is probabilistic, and much of this series is about learning how to measure it.

This post is the index for a short series where I document the decisions, tradeoffs, and detours as I build it.

## 02_WHAT_A_VULN_BANK_IS

It's the hackbot's reusable *offensive knowledge*. It contains general techniques rather than target data. For example: "When you see an unkeyed `X-Forwarded-Host` reflected but absent from the cache key, here's how to confirm cache poisoning." I want that kind of guidance to be searchable.

I keep two kinds of memory separate:

- **The vuln bank:** shared, permanent theory and technique.
- **Engagement memory:** per-target evidence, which never leaks into the shared bank.

Retrieved theory must never be cited as proof about a target. I treat that boundary as a design rule.

## 03_DECISIONS_SO_FAR

Before writing the implementation, I had to settle several design questions:

- **Postgres + pgvector.** I expect this corpus to stay well under a million records. At that scale, one datastore for typed records, full-text search, and vector search is simpler than adding a dedicated vector database. I'll reconsider that if a real scaling problem appears.
- **Structured records.** A database gives me typed queries, constraints, metadata filters, and explicit version fields. One technique is stored as one retrieval unit, which postpones the usual document-splitting problem.
- **Local embeddings.** Retrieval queries carry live target context, so I do not want to send them to a third-party embedding API.
- **Hybrid search.** Security is full of exact tokens such as header names, CVE IDs, and payloads. Dense embeddings can blur them, so PostgreSQL full-text search provides another retrieval path. Optional metadata filters narrow the scope when bit has enough context to use them.
- **Start with a reranker before chasing the embedding leaderboard.** A reranker can reconsider a small candidate set with the query and record side by side. Whether that buys more than a different embedder is an experiment, not a fact; I chose a reasonable baseline so I could keep building.
- **Pin the whole embedding identity.** Ingestion and query need the same weights, tokenizer, pooling, normalisation, dimensions, and serving behavior. The code currently fixes the model ID and 1024 dimensions, but the image tag and model revision still need pinning for true reproducibility.
- **Keep the index simple to start.** At this scale, a basic index or even brute-force search may be enough. More complexity has to earn its place through measurements.
- **The MCP server does retrieval, not answer generation.** It also exposes an admin-only ingestion tool, but neither tool calls an LLM to synthesize an answer. The agent remains the reasoning layer.
- **Split ingestion in two.** The AI reads a writeup and produces a structured record; a deterministic tool embeds and inserts it. The AI produces content, never vectors.
- **A curation gate on writes.** bit's normal key is read-only. Admin ingestion creates `staging` records, and only `active` records are retrievable. The review UI is still work in progress, so this is a boundary I have started enforcing, not a finished editorial workflow.

None of these choices are unusual. They reduce the number of moving parts while I learn what the system actually needs.

## 04_THE_SERIES

Over the coming days I'll go deep on each piece. Links go live as each post ships:

- **[Tech Stack Decision & High-Level Architecture](/writing/vuln-bank-tech-stack):** Effect, Hono, and Postgres, the ingest and retrieve paths, and the boundary between the RAG core and MCP.
- **[Four Indexes and One Wrong Turn](/writing/vuln-bank-indexes):** how records are stored, why the query patterns need different indexes, and why I replaced IVFFlat with HNSW.
- **[Two Legs, One List](/writing/vuln-bank-hybrid-retrieval):** dense and lexical retrieval, Reciprocal Rank Fusion, reranking, filtered HNSW behavior, and recall@5.
- **[Building the MCP Doorway](/writing/vuln-bank-mcp-doorway):** the hand-written protocol adapter, tool schemas, error handling, and the trust boundary at the tool edge.
- **[Measuring What the Bank Remembers](/writing/vuln-bank-recall-observability):** recall@k observability, retrieval settings, and model experiments that still have to run on a small VPS.
- **Setting It Up in OpenCode:** *still to come.* Agent permissions, a separate ingestion agent, and the terminal workflow.

## 05_WHY_WRITE_IT_UP

Half of this was over my head a week ago. Writing it down forces me to check whether I understand each tradeoff instead of copying a tutorial and hoping it fits. The next post covers the stack and architecture.
