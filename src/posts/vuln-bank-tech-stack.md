---
title: 'Vuln Bank Part 1: Tech Stack & Architecture'
titleHtml: 'Vuln Bank Part 1: Tech Stack &amp; <em>Architecture</em>'
summary: "The stack behind the vuln bank — Effect, Hono, Postgres — and the one idea that shapes everything: the RAG system and the MCP interface are two separable pieces that only happen to ship together."
standfirst: 'Two pieces, one app. The knowledge service and the agent interface are independent — and keeping them that way is the whole design.'
date: '2026-08-02'
tag: 'HACKBOT'
readingMinutes: 9
status: 'ONGOING'
chip: 'BUILD_LOG'
---

## 01_RECAP

In the [series index](/writing/building-a-vuln-bank-for-my-hackbot) I laid out *why* my hackbot needs a vuln bank — a durable, searchable memory of how to find and exploit bug classes — and the tradeoffs I'd already committed to. This post is the architecture: the actual stack, and the shape the code takes.

The headline idea, before any of the tooling: **this is really two applications wearing one repo.** Get that separation right and everything else is detail.

## 02_THE_STACK

Here's what I'm building on and why each earned its place:

- **Postgres + pgvector** — the system of record. Typed records, full-text search, and vector search in one datastore. At sub-million scale I don't need a dedicated vector DB, and one store means one source of truth.
- **Effect** — the standard library. The whole system is a pipeline of *fallible* steps: read a writeup, validate it, embed it, insert it; embed a query, search, rerank, return. Effect models each step as a composable value with **typed errors**, gives me **dependency injection** (swap the embedding model or the DB without touching call sites), **structured concurrency** (run the vector and keyword legs in parallel, safely), and **Schema** for validating both ingested records and MCP tool inputs. For a system that is essentially "typed pipelines with lots of failure modes," it's the right spine.
- **Hono** — the web server. Small, fast, runs anywhere. It's the HTTP substrate that lets the knowledge service be reached over plain HTTP *and* carries MCP when I want a networked transport instead of stdio. Crucially, Hono is what makes the RAG usable *without* an agent at all — more on that in a second.
- **`bge-m3`, run locally** — the embedding model. Local because queries carry live target context, and that never leaves the box. It emits **dense *and* sparse** vectors from a single model, which feeds both legs of the hybrid search below — no second model to keep version-pinned in lockstep.
- **1024 dimensions, no reduction.** `bge-m3`'s dense vectors are natively 1024-dim, which lands comfortably under pgvector's 2000-dimension index ceiling. So I index with the plain `vector` type and skip the truncation dance a 3072-dim model (like `text-embedding-3-large`) would force just to be indexable. That 1024 is now part of the embedding's fixed identity: same model *and* the same dimension at both ingest and query, always.
- **Hybrid search + a reranker** — dense vectors for meaning, sparse/keyword for the exact tokens security is full of, a cross-encoder to sharpen the top few.

## 03_TWO_SEPARABLE_PIECES

This is the part worth slowing down on.

When people hear "RAG system with an MCP tool," they picture one indivisible thing. It isn't. There are two independent concerns here, and they meet at a clean boundary:

**Piece one — the RAG system.** A self-contained knowledge service: ingest, index, retrieve, over Postgres. It knows nothing about *who* calls it or *how*. Hand it a query, it hands back ranked chunks. That's the entire contract.

**Piece two — the MCP interface.** A protocol adapter that lets an AI agent use the service. The MCP *server* is a thin translation layer — "agent tool call" in, "RAG service call" out. The MCP *client* lives inside the agent (OpenCode, in my case) and does the calling. MCP is about *who consumes and how* — not about *what the knowledge is*.

These are orthogonal, and each can exist without the other:

- **RAG without MCP** — expose it over HTTP with Hono for a dashboard, import it as a library from a batch script, or drive it from a CLI. Still completely useful.
- **MCP without this RAG** — an MCP server can wrap a filesystem, a REST API, anything. MCP implies nothing about vector search.

They're combined in *this* project for one reason only: my consumer happens to be an AI agent, and MCP is the clean way to let an agent call tools. That's a **composition choice, not an inherent coupling.**

> The RAG system is the *engine*. MCP is one *doorway* into it.
>
> Build the engine so it doesn't know which doorway it's behind — then you can add another door without touching the engine.

Why does this matter beyond tidiness? Because keeping the seam sharp buys real things:

- I can **test the RAG core** with zero agent in the loop.
- I can **swap or add interfaces** — a REST frontend, a different agent protocol — without reopening retrieval.
- I can **reuse the same core** from the ingestion "librarian" path *and* the agent's query path.
- The MCP layer stays **thin and dumb** — just schema and translation — which is exactly what you want sitting at a trust boundary.

## 04_HIGH_LEVEL_ARCHITECTURE

Concretely, the app is the two ingest/retrieve paths from the index, layered so the core is unaware of its callers:

```text:Layers
        ┌──────────────┐   ┌──────────────┐
        │  MCP server  │   │  Hono HTTP   │   ← interfaces (thin, swappable)
        └──────┬───────┘   └──────┬───────┘
               └────────┬─────────┘
                 ┌───────────────┐
                 │  RAG core     │            ← Effect services: ingest, retrieve
                 │  (Effect)     │              typed errors, DI, schema
                 └───────┬───────┘
                 ┌───────────────┐
                 │  Postgres     │            ← records + FTS + pgvector
                 └───────────────┘
```

The seam is a plain service interface. The core exposes it; the interfaces are two thin call sites over the same thing:

```ts:TypeScript
// The RAG core knows nothing about HTTP or MCP.
interface Retriever {
  readonly retrieve: (q: Query) => Effect.Effect<Chunk[], RetrievalError>
}

// Hono exposes it over HTTP...
app.post('/retrieve', (c) => runRetrieve(c.req))

// ...and the MCP server exposes the exact same core as a tool.
server.tool('vulnbank_retrieve', RetrieveSchema, (args) => runRetrieve(args))
```

Both doorways call `runRetrieve`. Neither one *is* the retrieval — they translate a request into the core's language and translate the result back. Swap the model behind `Retriever`, and both doors get the upgrade for free. Add a third door, and the core never notices.

## 05_THE_DOORWAY_GOT_THINNER

As I was drawing this up, MCP shipped its `2026-07-28` revision — the largest rewrite since launch — and its headline change is a gift to this design: **the protocol went stateless.** No more `initialize` handshake, no protocol-level session, no session header. Every request is self-contained; if a server needs continuity it mints an explicit handle and has the caller pass it back as a plain argument, never a hidden session.

That's nearly word-for-word the rule I'd already adopted for the engine. Retrieval is request/response and the MCP server holds no session state, so the new spec didn't cost me a redesign — it *ratified* the seam. A stateless doorway is the thinnest possible doorway.

In practice, targeting `2026-07-28` means a short checklist on the interface side: implement the `server/discover` RPC, stamp every result with `resultType: "complete"`, and return `ttlMs` + `cacheScope` on the now-cacheable `tools/list` so clients cache my tool list instead of re-polling it. And because method and tool names now travel in `Mcp-Method` / `Mcp-Name` headers, the Hono edge can route and authorize on headers without ever reading the body — a bonus that only makes the interface layer dumber, which is exactly where I want it.

## 06_NEXT

With the stack settled and the seam drawn, the next post goes inside the engine: **The Vuln RAG System** — ingestion, embeddings, hybrid search, and reranking, with the security-specific gotchas that make this different from a generic docs-RAG.

*The engine first. The doorways can wait — that's the whole point of keeping them apart.*
