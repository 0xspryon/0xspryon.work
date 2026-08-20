---
title: 'Building a Vuln Bank for My Hackbot'
titleHtml: 'Building a <em>Vuln Bank</em> for My Hackbot'
summary: "A build log about giving my bug-hunting agent a long-term memory: a curated vulnerability knowledge base served over MCP, including the tradeoffs and wrong turns."
standfirst: 'My hackbot has no memory of how to hack. This is the series where I build it one.'
date: '2026-08-02'
tag: 'HACKBOT'
readingMinutes: 6
status: 'ONGOING'
chip: 'BUILD_LOG'
---

## 01_THE_GAP

I'm building a hackbot called **[bit](https://bit.0xspryon.work)**, an agent that helps me hunt for vulnerabilities. The more I use it, the clearer one gap becomes: it has no long-term memory of *how to hack*. Every session, I end up supplying the same knowledge about how to investigate a class of bug all over again.

That knowledge shouldn't be ephemeral. It should be a durable, growing asset the bot can reach for on every engagement. So I'm building a **vuln bank**: a curated knowledge base of vulnerability classes, techniques, signals, and chains, exposed through MCP so bit can ask for a useful methodology when it needs one. "Useful" matters here; retrieval is probabilistic, and much of this series is about learning how to measure it.

This post is the index for a short series where I document the build in the open — decisions, tradeoffs, and detours included.

## 02_WHAT_A_VULN_BANK_IS

It's the hackbot's reusable *offensive knowledge* — not target data, but generalized technique. "When you see an unkeyed `X-Forwarded-Host` reflected but absent from the cache key, here's how to confirm cache poisoning." That kind of thing, made searchable.

It stays strictly separate from two other memories:

- **The vuln bank** — shared, permanent theory and technique.
- **Engagement memory** — per-target evidence, which never leaks into the shared bank.
- **The boundary between them** — retrieved theory is never cited as proof about a target.

Keeping those apart is a design rule, not an afterthought.

## 03_DECISIONS_SO_FAR

Before writing a line of the real thing, a pile of forks got resolved. The *reasoning* is the interesting part, so here it is:

- **Postgres + pgvector, not a dedicated vector database.** I expect this corpus to stay well under a million records. At that scale, one datastore that does typed records, full-text search, *and* vector search beats going polyglot. I'll reach for a specialized vector DB only when a real pressure shows up.
- **Structured records, not a pile of markdown files.** A database gives me typed queries, constraints, metadata filters, and explicit version fields. One technique is stored as one retrieval unit, so I can postpone the usual document-splitting problem rather than pretending I solved it.
- **A local embedding model, not a hosted API.** Retrieval queries carry live target context. Shipping that to a third-party embedding endpoint leaks engagement data. Local it is.
- **Hybrid search, not pure semantic.** Security is full of exact tokens — header names, CVE IDs, payloads — that dense embeddings can blur. PostgreSQL full-text search catches some of what vectors miss, while optional metadata filters narrow the search when bit knows the relevant scope.
- **Start with a reranker before chasing the embedding leaderboard.** A reranker can reconsider a small candidate set with the query and record side by side. Whether that buys more than a different embedder is an experiment, not a fact; I chose a reasonable baseline so I could keep building.
- **Pin the whole embedding identity.** Ingestion and query need the same weights, tokenizer, pooling, normalisation, dimensions, and serving behavior. The code currently fixes the model ID and 1024 dimensions, but the image tag and model revision still need pinning for true reproducibility.
- **Keep the index simple to start.** At this scale, a basic index — or even brute-force search — is plenty. The fancy stuff only earns its keep when recall measurements demand it.
- **The MCP server does retrieval, not answer generation.** It also exposes an admin-only ingestion tool, but neither tool calls an LLM to synthesize an answer. The agent remains the reasoning layer.
- **Split ingestion in two.** The AI reads a writeup and produces a structured record; a deterministic tool embeds and inserts it. The AI produces content, never vectors.
- **A curation gate on writes.** bit's normal key is read-only. Admin ingestion creates `staging` records, and only `active` records are retrievable. The review UI is still work in progress, so this is a boundary I have started enforcing, not a finished editorial workflow.

None of these are exotic. They're the boring-on-purpose choices that keep the system honest.

> Build the capability once, behind a clean interface, and every UI is just a frontend to it.
>
> The agent is the AI-in-the-loop frontend. A CLI can be the batch frontend. Same tool underneath.

## 04_THE_SERIES

Over the coming days I'll go deep on each piece. Links go live as each post ships:

- **[Tech Stack Decision & High-Level Architecture](/writing/vuln-bank-tech-stack)** — the full picture: Effect, Hono, and Postgres as the spine, the two-path (ingest vs. retrieve) design, and why the RAG core and the MCP interface are kept apart.
- **[Four Indexes and One Wrong Turn](/writing/vuln-bank-indexes)** — how knowledge is stored: why one record is already one chunk, why each index matches the shape of its column, and why I ripped out IVFFlat for HNSW before the first migration shipped.
- **[Two Legs, One List](/writing/vuln-bank-hybrid-retrieval)** — the read path: Reciprocal Rank Fusion over two rankings that can't be compared, what a cross-encoder buys over an embedding model, the short list an approximate index hands you without erroring, and measuring it with recall@5.
- **[Building the MCP Doorway](/writing/vuln-bank-mcp-doorway)** — turning the engine into a tool an agent can call: why I wrote the protocol by hand, why the tool schema is really a prompt, MCP's two kinds of error, and the trust boundary at the tool edge.
- **[Measuring What the Bank Remembers](/writing/vuln-bank-recall-observability)** — the next step: turning recall@k into an observable regression signal, mapping the knobs that affect it, and testing stronger or security-adapted models without forgetting the tiny VPS that has to run them.
- **Setting It Up in OpenCode** — *still to come.* Wiring the bank into my hackbot: agent permissions, the ingestion "librarian" agent, and driving it all from the terminal.

## 05_WHY_WRITE_IT_UP

Half of this was over my head a week ago. Writing it down forces me to actually understand the tradeoffs instead of cargo-culting a tutorial — and maybe it saves someone else the same detours.

If you're building something similar, follow along. Next up: the tech stack and architecture.
