---
title: 'Building a Vuln Bank for My Hackbot'
titleHtml: 'Building a <em>Vuln Bank</em> for My Hackbot'
summary: "Kicking off a series on giving an autonomous bug-hunting agent a long-term memory — a curated vulnerability knowledge base served over MCP, and the tradeoffs behind it."
standfirst: 'My hackbot has no memory of how to hack. This is the series where I build it one.'
date: '2026-08-02'
tag: 'HACKBOT'
readingMinutes: 6
status: 'ONGOING'
chip: 'BUILD_LOG'
---

## 01_THE_GAP

I'm building a hackbot — an agent that helps me hunt for vulnerabilities. The more I use it, the clearer one gap becomes: it has no long-term memory of *how to hack*. Every session, the knowledge of how to find and exploit a class of bug has to be re-supplied from scratch.

That knowledge shouldn't be ephemeral. It should be a durable, growing asset the bot reaches for on every engagement. So I'm building a **vuln bank**: a curated knowledge base of vulnerability classes, techniques, signals, and chains, exposed to the agent through an MCP tool so it can retrieve exactly the right methodology at the right moment.

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
- **Structured records, not a pile of markdown files.** Markdown can't do typed queries, referential integrity, or versioning. Bonus: when records are atomic, chunking becomes nearly free — one technique is one chunk, already the right size.
- **A local embedding model, not a hosted API.** Retrieval queries carry live target context. Shipping that to a third-party embedding endpoint leaks engagement data. Local it is.
- **Hybrid search, not pure semantic.** Security is full of exact tokens — header names, CVE IDs, payloads — that dense embeddings blur. A keyword leg catches what vectors miss; metadata filters keep a cache-poisoning query from ever returning XSS.
- **Invest in a reranker over a fancier embedder.** For this domain, reranking the shortlist buys more precision than a marginally better embedding model.
- **Version-pin the embedding model.** Ingestion and query must use the identical model — the vectors only mean something relative to the function that made them. Swapping models means re-embedding everything.
- **Keep the index simple to start.** At this scale, a basic index — or even brute-force search — is plenty. The fancy stuff only earns its keep when recall measurements demand it.
- **The MCP server does retrieval only — no generation.** In an agent setup, the model *is* the client. The server returns results and stops; the agent does the reasoning. No "call an LLM to synthesize" baked into the server.
- **Split ingestion in two.** The AI reads a writeup and produces a structured record; a deterministic tool embeds and inserts it. The AI produces content, never vectors.
- **A curation gate on writes.** An autonomous offensive agent must never be able to poison its own knowledge base. Writes are staged and reviewed, not committed live.

None of these are exotic. They're the boring-on-purpose choices that keep the system honest.

> Build the capability once, behind a clean interface, and every UI is just a frontend to it.
>
> The agent is the AI-in-the-loop frontend. A CLI can be the batch frontend. Same tool underneath.

## 04_THE_SERIES

Over the coming days I'll go deep on each piece. Links go live as each post ships:

- **[Tech Stack Decision & High-Level Architecture](/writing/vuln-bank-tech-stack)** — the full picture: Effect, Hono, and Postgres as the spine, the two-path (ingest vs. retrieve) design, and why the RAG core and the MCP interface are kept apart.
- **The Vuln RAG System** — *coming soon.* Ingestion, embeddings, hybrid search, reranking — and the security-specific gotchas: exact tokens, image-heavy writeups, chunk sizing.
- **MCP Client Implementation** — *coming soon.* Turning the bank into an MCP tool: schema-as-UX, bounded and labeled results, and the trust boundary at the tool edge.
- **Setting It Up in OpenCode** — *coming soon.* Wiring the bank into my hackbot: agent permissions, the ingestion "librarian" agent, and driving it all from the terminal.

## 05_WHY_WRITE_IT_UP

Half of this was over my head a week ago. Writing it down forces me to actually understand the tradeoffs instead of cargo-culting a tutorial — and maybe it saves someone else the same detours.

If you're building something similar, follow along. Next up: the tech stack and architecture.
