---
title: 'Vuln Bank Part 1: Tech Stack & Architecture'
titleHtml: 'Vuln Bank Part 1: Tech Stack &amp; <em>Architecture</em>'
summary: "The stack behind the vuln bank — Effect, Hono, Postgres — and the one idea that shapes everything: the RAG system and the MCP interface are two separable pieces that only happen to ship together."
standfirst: 'The knowledge service and the agent interface live together, but they do not need to grow into one inseparable thing.'
date: '2026-08-03'
tag: 'HACKBOT'
readingMinutes: 9
status: 'ONGOING'
chip: 'BUILD_LOG'
---

## 01_RECAP

In the [series index](/writing/building-a-vuln-bank-for-my-hackbot) I laid out *why* my hackbot needs a vuln bank — a durable, searchable memory of how to find and exploit bug classes — and the tradeoffs I'd already committed to. This post is the architecture: the actual stack, and the shape the code takes.

The headline idea, before any of the tooling: **this is one service with two separable concerns.** The retrieval engine should not care whether it was called over HTTP or MCP.

## 02_THE_STACK

Here's what I'm building on and why each earned its place:

- **Postgres + pgvector** — the system of record. Typed records, full-text search, and vector search in one datastore. At sub-million scale I don't need a dedicated vector DB, and one store means one source of truth.
- **Effect** — the application spine. The whole system is a pipeline of *fallible* steps: validate a record, embed it, insert it; embed a query, search, rerank, return. Effect gives me typed errors, dependency injection, structured concurrency, and Schema for validating ingested records and MCP inputs. It is more machinery than a few promises, but the failure model is explicit, and I value that here.
- **Hono** — the web server. Small, fast, runs anywhere. It's the HTTP substrate that lets the knowledge service be reached over plain HTTP *and* carries MCP when I want a networked transport instead of stdio. Crucially, Hono is what makes the RAG usable *without* an agent at all — more on that in a second.
- **`BAAI/bge-m3`, run locally** — the dense embedding model. Local inference keeps queries containing live target context on infrastructure I control. BGE-M3 can also emit sparse and multi-vector representations, but this implementation only asks TEI for its 1024-dimensional dense vector.
- **1024 dimensions, no reduction.** That is BGE-M3's native dense width and it fits pgvector's indexed `vector` limits. The database and application both enforce it. A future model swap therefore means a new compatible index or a full re-embedding migration.
- **Hybrid search + `BAAI/bge-reranker-v2-m3`** — dense vectors for meaning, PostgreSQL English FTS for lexical matching, then a cross-encoder to reorder the fused shortlist.

## 03_TWO_SEPARABLE_PIECES

This is the part worth slowing down on.

When people hear "RAG system with an MCP tool," they picture one indivisible thing. It isn't. There are two independent concerns here, and they meet at a clean boundary:

**Piece one — the RAG system.** A self-contained knowledge service: ingest, index, retrieve, over Postgres. It knows nothing about *who* calls it or *how*. Hand it a query and it returns ranked methodology records plus retrieval diagnostics.

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
- The MCP layer stays **small** — mostly authentication, schema, error mapping, and translation — which is easier to audit at a trust boundary.

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
  readonly retrieve: (q: Query) => Effect.Effect<RetrieveResult, RetrievalError>
}

// Hono exposes it over HTTP...
app.post('/retrieve', (c) => runRetrieve(c.req))

// ...and the MCP server exposes the exact same core as a tool.
server.tool('bit_retrieve', RetrieveSchema, (args) => runRetrieve(args))
```

Both doorways call `runRetrieve`. Neither one *is* the retrieval — they translate a request into the core's language and translate the result back. Swap the model behind `Retriever`, and both doors get the upgrade for free. Add a third door, and the core never notices.

## 05_THE_DOORWAY_GOT_THINNER

As I was drawing this up, I chose to target MCP revision `2026-07-28`, whose stateless request model fits the design neatly. The server does not keep protocol sessions: every request carries what it needs, and application continuity would have to be represented explicitly.

That's nearly word-for-word the rule I'd already adopted for the engine. Retrieval is request/response and the MCP server holds no session state, so the new spec didn't cost me a redesign — it *ratified* the seam. A stateless doorway is the thinnest possible doorway.

In practice, that means implementing `server/discover`, stamping results with `resultType: "complete"`, and returning cache hints with `tools/list`. Shipping clients have not all caught up, so the adapter also carries a temporary `initialize` compatibility bridge. That tension between a clean target revision and the clients that exist today became [Part 4](/writing/vuln-bank-mcp-doorway).

## 06_NEXT

With the stack settled and the seam drawn, the next two posts go inside the engine: **[Four Indexes and One Wrong Turn](/writing/vuln-bank-indexes)** on how knowledge is stored and indexed, then **[Two Legs, One List](/writing/vuln-bank-hybrid-retrieval)** on hybrid search, reranking, and the security-specific gotchas that make this different from a generic docs-RAG.

*The engine first. The doorways can wait — that's the whole point of keeping them apart.*
