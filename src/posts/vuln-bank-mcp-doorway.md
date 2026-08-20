---
title: 'Vuln Bank Part 4: Building the MCP Doorway'
titleHtml: 'Vuln Bank Part 4: Building the <em>MCP Doorway</em>'
summary: "Turning the retrieval engine into an MCP tool, including the custom protocol adapter, generated schemas, error handling, permissions, and an authentication bug."
standfirst: "A good doorway is boring. Mine got interesting whenever I forgot that the caller is a model making its next decision from my schema and wording."
date: '2026-08-19'
tag: 'HACKBOT'
readingMinutes: 14
status: 'ONGOING'
chip: 'BUILD_LOG'
---

## 01_WHERE_WE_LEFT_OFF

Three posts in, the engine works. [Part 2](/writing/vuln-bank-indexes) covered how knowledge is stored and indexed; [Part 3](/writing/vuln-bank-hybrid-retrieval) followed a query through hybrid search, fusion, reranking, and the recall number that says whether it's any good. Hand it a query, it hands back five ranked chunks.

The engine still needs a model-facing interface. This post covers the MCP layer that lets my hackbot, **bit**, reach the bank as a tool.

Back in [Part 1](/writing/vuln-bank-tech-stack) I separated the retrieval engine from its interfaces. The MCP adapter is small, but its wording and schema need care because a model uses both when deciding what to do next.

So this is the design log for roughly 400 lines of translation layer, including the places where the wire protocol and the clients using it disagreed with my tidy mental model.

## 02_WHY_I_WROTE_THE_PROTOCOL_BY_HAND

The source code for all that is said in this post can be found [here](https://github.com/0xspryon/bit_mcp/tree/main/apps/api/src/mcp)

The first decision looks like the wrong one: there is no `@modelcontextprotocol/sdk` in this project. I implemented JSON-RPC and the MCP method set myself.

The published SDK implements spec revision `2025-11-25`, while this server targets `2026-07-28`. The newer revision uses a stateless request model that did not fit the available stateful client library, so I implemented the required JSON-RPC and MCP methods directly.

The `2025-11-25` model begins with an `initialize` handshake and establishes a session. Under `2026-07-28`, each request carries its protocol metadata in `_meta` and no protocol session is stored. A server that needs continuity can return an explicit handle for the caller to pass back. The revision also added a `resultType` envelope, `server/discover`, and `ttlMs` / `cacheScope` hints for caching tool lists.

Targeting the newer revision meant writing the wire types, which came to about a hundred lines:

```ts:TypeScript
export interface JsonRpcResultResponse {
  readonly jsonrpc: '2.0';
  readonly id: JsonRpcId;
  readonly result: { readonly resultType: string } & Record<string, unknown>;
}

export const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
export const err = (id, code, message, data) => ({ jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } });
```

Statelessness paid for itself immediately by making the dispatcher easy to reason about in isolation:

```ts:TypeScript
export const handleRpc = async (
  request: unknown,
  ctx: McpContext          // headers and runtime only
): Promise<JsonRpcResponse | null> => { /* … */ }
```

Two concurrent calls share no protocol session. The transport is a single `POST /api/v1/mcp` that reads JSON-RPC, returns JSON, and forgets the request. Authentication, database contents, and model inference can still change the answer, but there is no hidden conversational state.

The small context type makes accidental session state harder to introduce, while tests verify that one request does not depend on another.

## 03_THE_HANDSHAKE_THAT_SHOULDN'T_EXIST

`2026-07-28` deleted `initialize`. I implemented `server/discover` as the entry point, as instructed, and the clients I tested still opened with `initialize`. When my server answered `-32601 Method not found`, they treated it as broken. I reproduced that behavior with Claude Code 2.1.205. That is enough evidence for a compatibility bridge, but not enough to claim every client behaves the same way.

To work with those deployed clients, I added a temporary handshake response:

```ts:TypeScript
// ---- REMOVE BY DECEMBER 2026 --------------------------------------------
// A bridge, not a supported revision. `2026-07-28` deleted the handshake,
// but the clients tested today still open with `initialize` and drop
// the connection on `-32601`. We answer it so those clients reach the
// tools; `server/discover` stays the real entry point and
// SUPPORTED_VERSIONS still advertises only `2026-07-28`.
case 'initialize':
  return ok(id, {
    resultType: 'complete',
    protocolVersion: LEGACY_HANDSHAKE_VERSION,   // '2025-11-25'
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    instructions: discoverResult().instructions
  });
// ---- end removal block ---------------------------------------------------
```

I kept the compatibility code isolated in three ways:

- **`LEGACY_HANDSHAKE_VERSION` is absent from `SUPPORTED_VERSIONS`.** I answer the handshake without advertising support for the older revision. Discovery still lists only `2026-07-28`.
- **It has an expiry date in the code, not in my head.** "REMOVE BY DECEMBER 2026" is written where someone will actually read it, and the instruction is to *recheck* at that date rather than to let it lapse into permanence by default.
- **Its removal is a single named block.** Delete the arm, the constant, and their tests. No archaeology required.

The block is named, tested, and dated so it can be removed after client support catches up.

## 04_THE_SCHEMA_IS_THE_PROMPT

An MCP tool publishes a name, description, and JSON Schema. These values enter the model's context and influence whether and how it calls the tool, so the schema is part of the model-facing interface rather than documentation alone.

That reframing changes what you optimise for. The tool list stays small, and its shape comes straight from the engine's own validators:

```ts:TypeScript
const bitRetrieveTool: McpTool = {
  name: 'bit_retrieve',
  description:
    'Retrieve ranked vulnerability methodology chunks for a natural-language ' +
    'query. Requires the record:read permission.',
  inputSchema: JSONSchema.make(RetrieveQuery)   // ← generated, never written
};
```

`JSONSchema.make(RetrieveQuery)` [derives the published schema from the *same* Effect `Schema` the service validates against.](https://github.com/0xspryon/bit_mcp/blob/main/apps/api/src/mcp/tools.ts#L38-L49) That removes a common source of drift: changing a field or bound updates both. Generated JSON Schema still deserves contract tests, especially around defaults, refinements, transforms, and unknown properties.

The generated schema tells the model that `k` is an integer from 1 to 50 with a default of 5, the query is a non-empty string capped at 8000 characters, and `namespaces` accepts up to 32 entries. The service validates the same constraints when the call arrives.

Two smaller decisions in the same spirit:

- **The tool list is sorted by name and static.** `bit_ingest` always appears before `bit_retrieve`. Stable ordering avoids needless prompt-cache churn; deterministic serialization is still needed before I can promise byte-identical responses.
- **`tools/list` carries cache hints.** `ttlMs: 3_600_000` and `cacheScope: 'public'` tell clients to hold it for an hour. `2026-07-28` made this possible; statelessness makes it *safe*, since there's no per-session variation for a cache to get wrong.

`RecordInput` has no embedding field, and strict validation rejects unknown properties. The API produces vectors, so a caller cannot directly choose where a record lands in semantic space. Malicious text can still influence retrieval, which is why staging, review, and read-only agent credentials remain necessary.

## 05_THE_DOORWAY_IS_FOUR_LINES

The tool runner itself is short:

```ts:TypeScript
const retrieveRunner: ToolRunner = (args, headers) =>
  authenticate(headers).pipe(
    Effect.flatMap(requirePermissions({ record: ['read'] })),
    Effect.flatMap(() => RetrieverService),
    Effect.flatMap((retriever) => retriever.retrieve(args))
  );
```

The runner authenticates the caller, checks permissions, and calls the service. Validation and ranking remain in the RAG core. `bit_ingest` follows the same pattern with a different permission and service.

The HTTP handlers use the same service functions, so adding MCP required no changes to `@repo/rag-core`.

The permissions encode the first part of the curation rule from the series index: bit's everyday credential must not be able to write to its own knowledge base.

```ts:TypeScript
export const adminRole = appAc.newRole({ record: ['ingest', 'read'], management: ['access'] });
export const userRole  = appAc.newRole({ record: ['read'] });
```

bit's key is a `user` key: it can retrieve but cannot write. Ingestion needs `record:ingest`, which only an admin holds, and new records land in `staging`. Authorization and staging are not a complete review workflow, but they put a real boundary in place while I build one.

The transport also limits JSON-RPC batch size:

```ts:TypeScript
const MAX_BATCH = 20;   // each batch item triggers its own auth lookup
```

JSON-RPC lets a client batch requests in an array, and authentication happens for every item. Without a cap, one unauthenticated POST containing 10,000 items could trigger 10,000 credential lookups. The server rejects batches above twenty.

## 06_TWO_KINDS_OF_WRONG

The protocol distinguishes two categories of failure:

- A **protocol error**, returned as JSON-RPC `error`, means the tool did not run because the method, parameters, or permission check failed.
- A **tool-execution error**, returned as a normal result with `isError: true`, means the call was accepted but the operation failed.

Think about that from the model's side, because that's who's reading. `isError: true` says the tool call was accepted but its work failed. A JSON-RPC error says the request could not be handled as a valid tool invocation. My current HTTP adapter returns both in JSON responses; authentication status handling still needs a separate standards pass rather than assuming the embedded `httpStatus` field is sufficient.

So every modeled failure routes to one side or the other, explicitly:

```ts:TypeScript
switch (error._tag) {
  // The tool never ran → protocol error.
  case 'UnauthorizedError':
    return err(id, ErrorCode.Unauthorized, 'Authentication is required.', { httpStatus: 401 });
  case 'ForbiddenError':
    return err(id, ErrorCode.Forbidden, 'You do not have permission to use this tool.', { httpStatus: 403 });

  // The tool ran and failed → the caller can act on this.
  case 'RetrieveQueryParseError':
  case 'RecordInputParseError':
    return toolExecutionError(id, error.message);   // ← the real validation message
  case 'EmbedError':
    return toolExecutionError(id, 'Unable to embed the input.');
  case 'RerankError':
    return toolExecutionError(id, 'Unable to rerank candidates.');
  case 'RetrievalRepoError':
    return toolExecutionError(id, 'Unable to run the retrieval.');
}
```

Validation errors return the specific message, such as `"query must be at most 8000 characters"`, so the model can correct its next call. Infrastructure errors return a generic message because the caller cannot repair the embedding server and should not receive internal details.

Effect represents modeled failures as typed, tagged values. `ToolProgramError` is a closed union of `AuthError | RetrievalError | IngestError`, so the compiler reports a new failure without a mapping. An unmodeled throw has no tag and becomes a generic internal error.

The auth error codes are `40100` and `40300`:

```ts:TypeScript
/** Application-defined: caller is unauthenticated. */
Unauthorized: 40100,
/** Application-defined: caller lacks the required permission. */
Forbidden: 40300
```

JSON-RPC reserves `-32768..-32000` for protocol-defined codes. Application codes must live outside that range, so positive values based on HTTP 401 and 403 remain easy to recognize without entering the reserved range.

## 07_THE_DAY_EVERY_STALE_KEY_LOOKED_LIKE_AN_OUTAGE

The bug I'd most like to save someone else from.

bit authenticates with an API key in an `x-api-key` header. My auth layer calls better-auth's `getSession`, and I'd written the obvious thing: no session means unauthenticated, return 401.

Except better-auth's API-key plugin does not return `null` for a bad key. It throws an `APIError`. My code caught it and reported a provider failure: HTTP 500, JSON-RPC `-32603`, *"Internal server error."*

Every expired, revoked, or mistyped key therefore looked like a vuln-bank outage. That sent the caller toward server debugging when the actual problem was its credential.

I first considered enumerating the failing status codes, but the plugin uses several statuses for credential rejection. An invalid key can surface as `UNAUTHORIZED` or `FORBIDDEN`, while a missing row appears as `NOT_FOUND`. The predicate therefore matches the status class:

```ts:TypeScript
export const isCredentialRejection = (cause: unknown): boolean =>
  cause instanceof APIError &&
  cause.statusCode >= 400 &&
  cause.statusCode < 500 &&
  cause.statusCode !== 429;
```

In the current adapter, most 4xx `APIError`s are treated as credential rejection and folded onto the unauthenticated path. That fixed stale and revoked keys, but the predicate is intentionally broad and needs tests against better-auth's actual error contract so unrelated policy or malformed-request errors are not misclassified. A 5xx, network failure, or non-`APIError` remains a provider failure.

Two status classes need separate handling:

- **429 is excluded.** Rate limiting says nothing about whether the credential is valid, so returning "unauthenticated" would suggest the wrong fix.
- **5xx must stay a provider error.** When the auth service is down I could not determine anything. Reporting that as "unauthenticated" is a lie *in the dangerous direction*: it tells the caller something definitive about their credential that I have no evidence for.

This still needs tests against better-auth's error contract because the broad 4xx rule could misclassify a different client error. The important part is keeping credential rejection separate from a provider outage.

## 08_TELLING_THE_AGENT_WHAT_IT_DOESN'T_KNOW

The response includes two pieces of context about its limits.

**Retrieval diagnostics:** [Part 3](/writing/vuln-bank-hybrid-retrieval) covered how an approximate index combined with a selective filter can return fewer candidates than requested. The MCP result includes the candidate counts:

```ts:TypeScript
Effect.flatMap(() => RetrieverService),
// Resolves `{ chunks, diagnostics }` and both are handed to the client
// verbatim. `diagnostics.semantic_search_degraded` tells an agent that the
// vector leg returned fewer candidates than requested. The ranking it is
// reading came from a smaller pool than intended, so a thin or off-target
// result set is worth a broader retry rather than trusting.
Effect.flatMap((retriever) => retriever.retrieve(args))
```

The tool returns the diagnostics unmodified. Today `semantic_search_degraded: true` means only that the dense leg returned fewer than 30 candidates. It may indicate ANN starvation, or it may simply mean fewer than 30 active records matched. The safe response is to treat the result as uncertain, not automatically widen a hard scope filter and risk crossing a boundary the caller intended.

For a human, an incomplete answer that looks complete is annoying. For an agent it's a *false premise* that everything downstream then reasons from.

**Methodology labels:** every returned chunk is labelled with its record type:

```ts:TypeScript
export const Chunk = Schema.Struct({
  // …
  sources: Schema.Array(ChunkSource),      // url + title + quality tier
  quality_tier: Schema.Number,
  score: Schema.Number,
  kind: Schema.Literal('methodology')      // ← always, on every chunk
});
```

`kind: 'methodology'` currently has only one possible value. It represents the trust boundary described in the [series index](/writing/building-a-vuln-bank-for-my-hackbot).

The bank stores generalized techniques, such as how to confirm cache poisoning when an unkeyed `X-Forwarded-Host` is reflected. It stores no observations about a live target. The agent still needs instructions not to present a retrieved methodology as evidence about the system it is testing.

So every chunk arrives self-describing: this is a methodology, here is its quality tier, and here are its sources with their tiers. That gives the model useful provenance cues. It cannot guarantee the model will use them correctly, so the hackbot's own instructions must still forbid treating methodology as target evidence.

The field is a literal rather than a free string. If the bank later stores engagement notes or target observations, widening the literal will require an explicit schema change.

## 09_NEXT

The first doorway is working: stateless, generated from the engine's schemas, and dated where it carries compatibility debt. bit can reach the bank, and the rough edges are now concrete enough to measure.

Next, **[Measuring What the Bank Remembers](/writing/vuln-bank-recall-observability)** turns the small recall harness into observability and tests retrieval settings and models under the VPS resource limits. The OpenCode wiring post will follow.
