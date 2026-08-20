---
title: 'Vuln Bank Part 1: Tech Stack & Architecture'
titleHtml: 'Vuln Bank Part 1: Tech Stack &amp; <em>Architecture</em>'
summary: "The stack behind the vuln bank uses Effect, Hono, and Postgres while keeping the retrieval system separate from its MCP interface."
standfirst: 'The knowledge service and the agent interface live together, but they do not need to grow into one inseparable thing.'
date: '2026-08-03'
tag: 'HACKBOT'
readingMinutes: 5
status: 'ONGOING'
chip: 'BUILD_LOG'
---

## 01_RECAP

In the [series index](/writing/building-a-vuln-bank-for-my-hackbot) I explained why my hackbot needs a searchable memory of vulnerability techniques. This post covers the stack and how the code is divided.

The headline idea, before any of the tooling: **this is one service with two separable concerns.** The retrieval engine should not care whether it was called over HTTP or MCP.

## 02_THE_STACK

The current stack is:

- **Postgres + pgvector:** the system of record. It handles typed records, full-text search, and vector search in one datastore. At this scale I do not need a dedicated vector database.
- **Effect:** the application spine. Validation, embedding, database access, retrieval, and reranking can all fail. Effect gives me typed errors, dependency injection, structured concurrency, and Schema validation for records and MCP inputs. It is more machinery than plain promises, but I find the explicit failure model useful here.
- **Hono:** the web server. It exposes the same knowledge service over ordinary HTTP and MCP. This also means I can use the RAG service without running an agent.
- **`BAAI/bge-m3`, run locally:** the dense embedding model. Local inference keeps queries containing live target context on infrastructure I control. BGE-M3 can emit sparse and multi-vector representations too, but this implementation only asks TEI for its 1024-dimensional dense vector.
- **1024 dimensions, no reduction.** That is BGE-M3's native dense width and it fits pgvector's indexed `vector` limits. The database and application both enforce it. A future model swap therefore means a new compatible index or a full re-embedding migration.
- **Hybrid search + `BAAI/bge-reranker-v2-m3`:** dense vectors for semantic retrieval, PostgreSQL English FTS for lexical matching, and a cross-encoder that reorders the fused shortlist.

## 03_TWO_SEPARABLE_PIECES

The RAG system and MCP interface are separate concerns with a defined boundary:

**The RAG system:** a knowledge service for ingesting, indexing, and retrieving records from Postgres. It accepts a query and returns ranked methodology records with diagnostics.

**The MCP interface:** a protocol adapter that lets an AI agent use the service. The MCP client lives inside OpenCode and calls the server, which translates the tool request into a RAG service call.

Either part can be used independently:

- **RAG without MCP:** expose it over HTTP for a dashboard, import it from a batch script, or drive it from a CLI.
- **MCP without this RAG:** an MCP server can wrap a filesystem, a REST API, or another service. MCP itself implies nothing about vector search.

They live in the same project because my main consumer is an AI agent and MCP gives it a tool interface. The retrieval code does not depend on MCP, so another adapter can call it later.

Why does this matter beyond tidiness? Because keeping the seam sharp buys real things:

This separation lets me test retrieval without an agent and reuse the same services from HTTP, MCP, and ingestion jobs. It also keeps authentication, schema conversion, and error mapping in a relatively small adapter that is easier to audit.

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

Both adapters call `runRetrieve`, translating their request into the core's input and formatting the result for the caller. A model change inside `Retriever` therefore applies to both interfaces.

## 05_THE_DOORWAY_GOT_THINNER

As I was drawing this up, I chose to target MCP revision `2026-07-28`, whose stateless request model fits the design neatly. The server does not keep protocol sessions: every request carries what it needs, and application continuity would have to be represented explicitly.

Retrieval was already request/response and the MCP server held no session state, so this revision did not require a redesign.

In practice, that means implementing `server/discover`, stamping results with `resultType: "complete"`, and returning cache hints with `tools/list`. Shipping clients have not all caught up, so the adapter also carries a temporary `initialize` compatibility bridge. That tension between a clean target revision and the clients that exist today became [Part 4](/writing/vuln-bank-mcp-doorway).

## 06_NEXT

With the stack settled and the seam drawn, the next two posts go inside the engine: **[Four Indexes and One Wrong Turn](/writing/vuln-bank-indexes)** on how knowledge is stored and indexed, then **[Two Legs, One List](/writing/vuln-bank-hybrid-retrieval)** on hybrid search, reranking, and the security-specific gotchas that make this different from a generic docs-RAG.
