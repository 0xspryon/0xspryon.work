---
title: 'Vuln Bank Part 4: Building the MCP Doorway'
titleHtml: 'Vuln Bank Part 4: Building the <em>MCP Doorway</em>'
summary: "Turning the retrieval engine into a tool an agent can call — why I wrote the protocol by hand instead of using the SDK, why the tool schema is really a prompt, the two kinds of error MCP distinguishes and why it matters, and the auth bug that made every stale key look like an outage."
standfirst: "A good doorway is boring. Mine got interesting whenever I forgot that the caller is a model making its next decision from my schema and wording."
date: '2026-08-19'
tag: 'HACKBOT'
readingMinutes: 22
status: 'ONGOING'
chip: 'BUILD_LOG'
---

## 01_WHERE_WE_LEFT_OFF

Three posts in, the engine works. [Part 2](/writing/vuln-bank-indexes) covered how knowledge is stored and indexed; [Part 3](/writing/vuln-bank-hybrid-retrieval) followed a query through hybrid search, fusion, reranking, and the recall number that says whether it's any good. Hand it a query, it hands back five ranked chunks.

The engine still needs a model-facing interface. That's this post: the MCP doorway, the layer that lets my hackbot, **bit**, reach the bank as a tool.

Back in [Part 1](/writing/vuln-bank-tech-stack) I argued the engine and the interface are separable, and that the interface should stay thin and dumb. I still believe it. What I underestimated is how much careful thinking "thin and dumb" requires when the thing on the other side of the door is a language model rather than a program. A program reads your error code. A model reads your *wording*, then decides what to do next.

So this is the design log for roughly 400 lines of translation layer, including the places where the wire protocol and the clients using it disagreed with my tidy mental model.

## 02_WHY_I_WROTE_THE_PROTOCOL_BY_HAND

The source code for all that is said in this post can be found [here](https://github.com/0xspryon/bit_mcp/tree/main/apps/api/src/mcp)

The first decision looks like the wrong one: there is no `@modelcontextprotocol/sdk` in this project. I implemented JSON-RPC and the MCP method set myself.

"I wrote it myself" is usually a smell, so: the reason isn't craftsmanship. The published SDK implements spec revision `2025-11-25`, and this doorway targets `2026-07-28` — and between those two revisions MCP became **stateless**, which is not a feature you bolt onto a stateful client library.

The `2025-11-25` model works like a connection: the client opens with an `initialize` handshake, the server replies with capabilities, a session is established, later calls ride it. `2026-07-28` deletes all of that. Every request is self-contained, carrying its own protocol metadata in `_meta` — no handshake, no session id, no per-connection memory. A server needing continuity mints an explicit handle and has the caller pass it back as a normal argument, never as a hidden session. The revision also added a `resultType` envelope on every result, a `server/discover` method replacing the handshake as the entry point, and `ttlMs` / `cacheScope` hints so clients cache the tool list instead of re-polling it.

So the choice wasn't "SDK or artisanal protocol code." It was "target the old revision and inherit its session machinery, or target the new one and write the wire types." The wire types came to about a hundred lines:

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
  ctx: McpContext          // { headers, runtime } — nothing else
): Promise<JsonRpcResponse | null> => { /* … */ }
```

Two concurrent calls share no protocol session. There is no session table, connection registry, or cleanup on disconnect. The transport is a single `POST /api/v1/mcp` that reads JSON-RPC, returns JSON, and forgets the request. The function is not mathematically pure — authentication, database contents, and model inference can all change its answer — but it has no hidden conversational state.

The small context type makes accidental session state harder to introduce, while tests verify that one request does not depend on another.

> A stateless protocol isn't a smaller version of a stateful one. It's a different thing that happens to do the same job.
>
> When the spec's shape and your architecture's shape agree, the adapter almost writes itself.

## 03_THE_HANDSHAKE_THAT_SHOULDN'T_EXIST

Now the part where the spec meets reality, and reality wins.

`2026-07-28` deleted `initialize`. I implemented `server/discover` as the entry point, as instructed, and the clients I tested still opened with `initialize`. When my server answered `-32601 Method not found`, they treated it as broken. I reproduced that behavior with Claude Code 2.1.205. That is enough evidence for a compatibility bridge, but not enough to claim every client behaves the same way.

You can be right about the spec and still have zero working clients. So I added the handshake back, on sufferance:

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

Three details make this a bridge rather than a quiet fork of the design, and they're the reusable part:

- **`LEGACY_HANDSHAKE_VERSION` is deliberately absent from `SUPPORTED_VERSIONS`.** I answer the handshake; I do not claim to implement the revision. Discovery still advertises `2026-07-28` alone. A client that asks what I speak gets the truth.
- **It has an expiry date in the code, not in my head.** "REMOVE BY DECEMBER 2026" is written where someone will actually read it, and the instruction is to *recheck* at that date rather than to let it lapse into permanence by default.
- **Its removal is a single named block.** Delete the arm, the constant, and their tests. No archaeology required.

That's the honest way to carry compatibility debt: don't pretend the compromise is the design — isolate it, name it, date it. Undated shims are how a codebase ends up supporting a protocol nobody remembers agreeing to.

## 04_THE_SCHEMA_IS_THE_PROMPT

Here's the thing I most underestimated.

When you expose a tool over MCP, you publish a name, a description, and a JSON Schema for its inputs. For a normal API that's documentation — a human skims it once and writes the call. For an agent it is **the entire user interface**, and it goes into the model's context on every request. The schema *is* prompt text: every field name and constraint is something the model reads and reasons about before deciding how to call you.

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

Every constraint I wrote for safety therefore doubles as guidance the model gets for free: `k` is an `Int` in 1..50 defaulting to 5, `query` a non-empty trimmed string capped at 8000 characters, `namespaces` at least one entry and at most 32. The model sees all of it *before* calling, so most malformed calls never happen — prevented by the schema rather than corrected by an error message afterward.

Two smaller decisions in the same spirit:

- **The tool list is sorted by name and static** — `bit_ingest` always before `bit_retrieve`. Stable ordering avoids needless prompt-cache churn; deterministic serialization is the remaining piece if I want to promise byte-identical responses.
- **`tools/list` carries cache hints.** `ttlMs: 3_600_000` and `cacheScope: 'public'` tell clients to hold it for an hour. `2026-07-28` made this possible; statelessness makes it *safe*, since there's no per-session variation for a cache to get wrong.

There is a deliberate omission in the input schema too. `RecordInput` has **no embedding field**, and strict validation rejects unknown properties. The API produces vectors; a caller cannot choose where a record lands in semantic space by supplying one directly. That does not eliminate poisoning — malicious text can still influence retrieval — so staging, review, and read-only agent credentials remain necessary.

> The tool schema is the only documentation an agent will ever read, and it reads it every single time.
>
> Generate it from the validator. A hand-written schema is a lie waiting for a deploy.

## 05_THE_DOORWAY_IS_FOUR_LINES

The actual tool implementations are the least interesting code in the project, which is exactly the outcome Part 1 was arguing for:

```ts:TypeScript
const retrieveRunner: ToolRunner = (args, headers) =>
  authenticate(headers).pipe(
    Effect.flatMap(requirePermissions({ record: ['read'] })),
    Effect.flatMap(() => RetrieverService),
    Effect.flatMap((retriever) => retriever.retrieve(args))
  );
```

Authenticate, authorize, call the service. That's the whole tool. Note what *isn't* there: no validation (the service validates `args` against `RetrieveQuery` itself), no ranking, no business logic, no MCP-specific behaviour leaking into the engine. `bit_ingest` is the same four lines with a different permission and a different service.

Critically, this is the *identical* pipeline the HTTP handlers run — not a parallel implementation that agrees today, the same functions. Adding the MCP doorway required zero changes to `@repo/rag-core`. That's the seam from Part 1 paying out.

The permissions encode the first part of the curation rule from the series index: bit's everyday credential must not be able to write to its own knowledge base.

```ts:TypeScript
export const adminRole = appAc.newRole({ record: ['ingest', 'read'], management: ['access'] });
export const userRole  = appAc.newRole({ record: ['read'] });
```

bit's key is a `user` key: it can retrieve but cannot write. Ingestion needs `record:ingest`, which only an admin holds, and new records land in `staging`. Authorization and staging are not a complete review workflow, but they put a real boundary in place while I build one.

One more guard at the transport, which exists only because I asked "what can an *unauthenticated* caller make me do?":

```ts:TypeScript
const MAX_BATCH = 20;   // each batch item triggers its own auth lookup
```

JSON-RPC lets a client batch requests in an array, and auth happens per item inside each runner — so without a cap, one unauthenticated POST of 10,000 items becomes 10,000 credential lookups. Twenty is plenty for real use and turns an amplification primitive into a rejected request.

## 06_TWO_KINDS_OF_WRONG

This is the piece of MCP I think is genuinely well designed, and which I only appreciated after implementing it: the protocol distinguishes **two categories of failure**, and they mean very different things to the caller.

- A **protocol error** — a JSON-RPC `error` response — means *the tool did not run*. Bad method, malformed params, no permission.
- A **tool-execution error** — a normal `result` with `isError: true` — means *the tool ran and failed*. The call was well-formed; the work didn't succeed.

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

Look at the asymmetry in what gets *said*, because it's deliberate. Validation errors pass the real message through — `"query must be at most 8000 characters"` is precisely the sentence that lets a model fix its own call on the next attempt. Infrastructure errors get a flat generic string. The model can't fix my embedding server, so a stack trace would be noise at best and an information leak at worst. The detail goes to the logs; the model gets what it can act on.

This works because Effect made every failure a *typed, tagged* value. `ToolProgramError` is a closed union of `AuthError | RetrievalError | IngestError`, so the switch is exhaustive and the compiler tells me when a new failure mode appears without a mapping. An unmodeled throw — a genuine defect — has no tag, falls through to `Cause.failureOption` returning `None`, and becomes a generic internal error. A bug in my code can never accidentally teach an agent something specific about my infrastructure.

One last detail, easy to miss and worth stealing. The auth error codes are `40100` and `40300`:

```ts:TypeScript
/** Application-defined: caller is unauthenticated. */
Unauthorized: 40100,
/** Application-defined: caller lacks the required permission. */
Forbidden: 40300
```

JSON-RPC reserves `-32768..-32000` for protocol-defined codes. Application codes must live outside that range, so `40100` cannot ever collide with a code the spec adds later. They're just `401` and `403` shifted into safe territory — legible to a human reading a log, and structurally guaranteed not to clash.

## 07_THE_DAY_EVERY_STALE_KEY_LOOKED_LIKE_AN_OUTAGE

The bug I'd most like to save someone else from.

bit authenticates with an API key in an `x-api-key` header. My auth layer calls better-auth's `getSession`, and I'd written the obvious thing: no session means unauthenticated, return 401.

Except better-auth's api-key plugin doesn't return `null` for a bad key. It **throws** an `APIError`. My code caught the throw, correctly concluded "I could not verify this," and reported a provider failure — HTTP 500, JSON-RPC `-32603`, *"Internal server error."*

So every expired, revoked, or mistyped key read to an agent as **the vuln bank being down**. Not "your credential is stale, mint a new one" — a hard server error. From the outside those are indistinguishable, and the wrong one sends you debugging the wrong system.

The naive fix is to enumerate the failing status codes and fold them into 401. I started there and stopped: the plugin uses *several* statuses for one condition — an invalid key surfaces as both `UNAUTHORIZED` and `FORBIDDEN`, a missing row as `NOT_FOUND` — and an enumerated list rots the next time the library adds a rejection reason. So the predicate matches the status *class* instead:

```ts:TypeScript
export const isCredentialRejection = (cause: unknown): boolean =>
  cause instanceof APIError &&
  cause.statusCode >= 400 &&
  cause.statusCode < 500 &&
  cause.statusCode !== 429;
```

In the current adapter, most 4xx `APIError`s are treated as credential rejection and folded onto the unauthenticated path. That fixed stale and revoked keys, but the predicate is intentionally broad and needs tests against better-auth's actual error contract so unrelated policy or malformed-request errors are not misclassified. A 5xx, network failure, or non-`APIError` remains a provider failure.

The two carve-outs are where the real thinking is:

- **429 is deliberately excluded.** Rate limiting says nothing about your credential. Collapsing it into "unauthenticated" would send a caller off to re-mint a key that was never the problem — a fix that can't work, prompted by an error that lied.
- **5xx must stay a provider error.** When the auth service is down I could not determine anything. Reporting that as "unauthenticated" is a lie *in the dangerous direction*: it tells the caller something definitive about their credential that I have no evidence for.

That framing — *which direction does this lie in?* — is what I actually took away. Both mistakes turn "I don't know" into a confident claim. One sends you chasing a phantom credential problem; the other hides an outage behind a plausible 401.

> Every error message is an instruction to the caller about what to do next.
>
> An unhelpfully vague error wastes someone's afternoon. A confidently wrong one wastes their week.

## 08_TELLING_THE_AGENT_WHAT_IT_DOESN'T_KNOW

Two last design choices, both about the same principle: the doorway's job includes communicating *the limits of what it returned*.

**First, the diagnostics ride along.** [Part 3](/writing/vuln-bank-hybrid-retrieval) ended on a bug I chose to report rather than fix — an approximate index combined with a selective filter can return fewer candidates than requested, with no error. Here's where that reporting actually lands:

```ts:TypeScript
Effect.flatMap(() => RetrieverService),
// Resolves `{ chunks, diagnostics }` and both are handed to the client
// verbatim. `diagnostics.semantic_search_degraded` tells an agent that the
// vector leg returned fewer candidates than it asked for — the ranking it is
// reading came from a smaller pool than intended, so a thin or off-target
// result set is worth a broader retry rather than trusting.
Effect.flatMap((retriever) => retriever.retrieve(args))
```

The tool returns the diagnostics unmodified. Today `semantic_search_degraded: true` means only that the dense leg returned fewer than 30 candidates. It may indicate ANN starvation, or it may simply mean fewer than 30 active records matched. The safe response is to treat the result as uncertain, not automatically widen a hard scope filter and risk crossing a boundary the caller intended.

For a human, an incomplete answer that looks complete is annoying. For an agent it's a *false premise* that everything downstream then reasons from.

**Second, every chunk is labelled for what it is.** From the output contract:

```ts:TypeScript
export const Chunk = Schema.Struct({
  // …
  sources: Schema.Array(ChunkSource),      // url + title + quality tier
  quality_tier: Schema.Number,
  score: Schema.Number,
  kind: Schema.Literal('methodology')      // ← always, on every chunk
});
```

`kind: 'methodology'` is a literal that can only ever hold one value, which makes it look pointless. It isn't. It's the trust boundary from the [series index](/writing/building-a-vuln-bank-for-my-hackbot) made mechanical.

The bank stores *generalized technique* — "when you see an unkeyed `X-Forwarded-Host` reflected but absent from the cache key, here's how to confirm cache poisoning." It stores nothing about any live target. The failure mode I'm guarding against is an agent retrieving a methodology, finding it plausible, and writing it up as *evidence* about the system it's currently testing. Retrieved theory presented as proof is how you get a confident, well-written, entirely fabricated bug report.

So every chunk arrives self-describing: this is a methodology, here is its quality tier, and here are its sources with their tiers. That gives the model useful provenance cues. It cannot guarantee the model will use them correctly, so the hackbot's own instructions must still forbid treating methodology as target evidence.

That's also why the field is a literal and not a free string. The day the bank holds something that *isn't* a methodology — an engagement note, a target observation — that literal has to widen, and widening it is a change I make on purpose. A `string` would have let the distinction erode silently.

## 09_NEXT

The first doorway is working: stateless, generated from the engine's schemas, and dated where it carries compatibility debt. bit can reach the bank, and the rough edges are now concrete enough to measure.

Next: **[Measuring What the Bank Remembers](/writing/vuln-bank-recall-observability)** — turning the small recall harness into observability, then testing retrieval knobs and alternative models without making the VPS fall over. The OpenCode wiring post will follow after that.

*Four posts to build a doorway the agent walks through without noticing. That's the job.*
