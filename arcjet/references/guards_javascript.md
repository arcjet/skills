# JavaScript/TypeScript Guard

## What Guard Is

Guard protects code paths that don't have an HTTP request — tool calls, agent loops, MCP handlers, queue consumers, background jobs. It's a separate SDK (`@arcjet/guard`) from the HTTP request SDKs (`@arcjet/node`, `@arcjet/next`, etc.) because there's no request object to inspect. Instead, you pass explicit context (labels, keys, text to scan) at each call site.

## Installation

Install with whichever package manager the project already uses (`npm install`, `pnpm add`, `yarn add`, `bun add`) — don't hand-edit `package.json`:

```bash
npm install @arcjet/guard
```

Requires `@arcjet/guard` ≥ 1.4.0 for basic Guard protection. Features called out as 1.6.0 below still apply. Capture, registration, Rampart, nested metadata, and threat/billing require **`@arcjet/guard` 1.10.0**. Runtime minimums match the current Arcjet JS SDK line:

| Runtime            | Minimum version          |
| ------------------ | ------------------------ |
| Node.js            | `>=22.21.0 <23 || >=24.5.0` |
| Bun                | 1.3.0                    |
| Deno               | `stable` / `lts`         |
| Cloudflare Workers | compat date `2025-09-01` |

The correct transport is picked automatically via conditional exports (HTTP/2 on Node and Bun, fetch-based on Deno and Workers) — import from `@arcjet/guard` either way. If the project is on Node 20/21, Node 23, Node 24 below 24.5.0, or an older Bun/Workers compat date, warn the user and stop until the runtime is bumped.

Read the installed package's types and doc comments for the full API surface.

> _Runtime support last verified against the published `@arcjet/guard` **v1.10.0** on **2026-08-11**. `moderateContent` (graduated name), `@arcjet/guard/mastra/v1`, `@arcjet/guard/langgraph/v1`, and `@arcjet/guard/claude-agent-sdk/v0` are on current docs and `main`; they are not in 1.10.0 (the next release line is unpublished) — importing one from 1.10.0 fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`. Read the installed package's types before using any of them. Minimums tend to creep upward — check the [Runtime support section](https://github.com/arcjet/arcjet-js/tree/main/arcjet-guard#runtime-support) of the current README._

## Architecture: Why Things Go Where They Do

### Client at module scope

```typescript
import { launchArcjet } from "@arcjet/guard";
const arcjet = launchArcjet({ key: process.env.ARCJET_KEY! });
```

The client holds a persistent HTTP/2 connection to the Arcjet decision service. Creating it inside a function means a new connection per call — slow and wasteful.

### Rules at module scope

Rate limit state is tracked server-side by the combination of `bucket` and other configuration properties, so recreating rules per call won't break counting. However, defining rules at module scope is still best practice because:

- It makes the per-rule result accessors (e.g. `userLimit.deniedResult(decision)`) work — you need a stable reference to call methods on.
- It avoids unnecessary object allocation on every invocation.
- It keeps rule configuration visible and centralized.

```typescript
import { tokenBucket, detectPromptInjection } from "@arcjet/guard";

// WORKS but awkward — no stable reference for result inspection
function handleTool() {
  const limit = tokenBucket({ /* config */ }); // hard to call limit.deniedResult() later
}

// BETTER — declare rules at module scope, dynamically choose which to apply
const adminLimit = tokenBucket({
  label: "admin.tool-calls",
  bucket: "admin-tools",
  refillRate: 100,
  intervalSeconds: 60,
  maxTokens: 1000,
});
const memberLimit = tokenBucket({
  label: "member.tool-calls",
  bucket: "member-tools",
  refillRate: 10,
  intervalSeconds: 60,
  maxTokens: 100,
});
const piRule = detectPromptInjection();

function toolRules(userId: string, role: string, text: string) {
  const limit = role === "admin" ? adminLimit : memberLimit;
  return [
    limit({ key: userId, requested: 1 }),
    piRule(text),
  ];
}
```

### guard() at the operation, with a hardcoded label

Place `guard()` wherever you already know exactly what operation is happening. That's typically inside the specific tool/task function, but the dispatch arm right before the call works equally well — sometimes it gives cleaner error propagation:

```typescript
// Option A: guard inside the tool function
async function getWeather(city: string, userId: string) {
  const decision = await arcjet.guard({
    label: "tools.get-weather",
    rules: [toolCallLimit({ key: userId, requested: 1 })],
    metadata: { user: { id: userId } },
  });
  if (decision.conclusion === "DENY") throw new Error(decision.reason);
  // ...do the work
}

// Option B: guard at the dispatch site, right before calling the tool
switch (toolName) {
  case "get_weather": {
    const decision = await arcjet.guard({
      label: "tools.get-weather",
      rules: [toolCallLimit({ key: userId, requested: 1 })],
      metadata: { user: { id: userId } },
    });
    if (decision.conclusion === "DENY") throw new Error(decision.reason);
    return getWeather(args.city);
  }
  // ...
}

// Avoid: generic dispatcher with interpolated label
async function handleToolCall(name: string, args: Record<string, unknown>, userId: string) {
  const decision = await arcjet.guard({ label: `tools.${name}`, rules: [/* ... */] }); // 👎
}
```

The `label` should be a hardcoded string — `"tools.get-weather"`, not `` `tools.${name}` ``. Hardcoded labels stay greppable, and the Console groups by them; interpolation produces a sea of distinct-looking calls instead of one bucket per operation.

**Label naming rules (often surprising):** labels are validated server-side as slugs — **lowercase letters, digits, dash (`-`), and dot (`.`) only**, must start and end with a letter or digit, max 256 bytes. Underscores, uppercase, and forward slashes are rejected even though the `GuardOptions.label` TSDoc lists them as allowed. Use `tools.get-weather`, not `tools.get_weather`. Same rules apply to rate-limit `bucket` names.

Pass `metadata` whenever you have useful auditing context. It is nested JSON, not a flat string map — `{ user: { id: userId }, requestId }` is valid. It shows up in the Console and does not affect the decision. Do not put secrets or PII in it.

## Choosing a Rate Limit Strategy

See the "Rate Limiting Strategies" section in the main skill for a comparison of token bucket vs fixed window vs sliding window.

Key guard-specific notes: all rate limit rules require a `key` parameter at call time (user ID, session ID, API key) — without it, limits are global across all callers. They also need a `bucket` name to avoid collisions between different rules.

**Picking a `key` when there's no user:** Some call sites have no per-user context — e.g. a stdio MCP server where the client is the only caller, or a single-tenant queue worker. Don't try to fake it by passing an empty string. Use whatever identifier actually matches the scope of the limit:
- single-tenant worker → the deployment name or env (`process.env.HOSTNAME ?? "default"`)
- stdio MCP server → the MCP client/session id if exposed by the SDK, otherwise the process identity
- shared limit across all callers → a stable literal like `"global"`, and add a comment explaining why
The point is to be intentional. A wrong-but-explicit `key` is much easier to fix than a missing one.

## Content Scanning Rules

### Prompt injection detection

Use `detectPromptInjection()` on any untrusted text before it reaches a model or is used as a tool argument. This catches jailbreaks, role-play escapes, and instruction overrides. Also useful on tool call *results* when the tool fetches content from untrusted sources.

### Sensitive information detection

Use `localDetectSensitiveInfo()` to block PII from entering or leaving the system (e.g. users sending credit card numbers, or tool outputs leaking email addresses). The scan runs locally — raw text never leaves the SDK. The default backend is WASM; see Rampart below for names and government / financial identifiers.

**The default backend detects exactly four entity types** — `"EMAIL"`, `"PHONE_NUMBER"`, `"IP_ADDRESS"`, `"CREDIT_CARD_NUMBER"` — even though `SensitiveInfoEntityType` names twenty. Listing any of the other sixteen without a `backend` produces a rule that can never match: current `main` rejects it at compile time (`allow` / `deny` narrow to `NativeSensitiveInfoEntityType` when no `backend` is set), and published 1.10.0 throws at module load with a message naming the type. Either way, add `backend: rampart()` or drop the type.

### Content moderation

`moderateContent()` flags unsafe or policy-violating text for Guard call sites (not available on `protect()`). The result is `{ detected, billing? }` — `billing.unit` is `text_units` when present. Published **1.10.0** still exports `experimental_moderateContent` as the public name; current docs and `main` graduate it to `moderateContent` and keep the old name as a deprecated alias. Import whichever the installed types export. `decision.reason` is `"MODERATE_CONTENT"` on deny.

### On-device Rampart backend

`localDetectSensitiveInfo()` defaults to the bundled WASM engine (card, email, phone, IP). For names, addresses, and government / financial identifiers, install `@arcjet/sensitive-info-rampart` and pass `backend: rampart()`. Detection still runs locally. Rampart needs Node/Bun/Deno with filesystem access — not edge.

```typescript
import { localDetectSensitiveInfo } from "@arcjet/guard";
import { rampart } from "@arcjet/sensitive-info-rampart";

const si = localDetectSensitiveInfo({
  deny: ["GIVEN_NAME", "SURNAME", "EMAIL", "SSN"],
  backend: rampart(),
});
```

## Decision Handling

`decision.conclusion` is either `"ALLOW"` or `"DENY"`. Always check before proceeding.

For useful error messages, branch on **which rule** denied — not just on `DENY`. Each rule defined at module scope exposes a `.deniedResult(decision)` accessor that returns rule-specific info (e.g. `resetAtUnixSeconds` for rate limits). Use this to give the caller something actionable:

```typescript
if (decision.conclusion === "DENY") {
  const rateLimited = toolCallLimit.deniedResult(decision);
  if (rateLimited) {
    throw new Error(`rate limited — retry after unix ${rateLimited.resetAtUnixSeconds}`);
  }
  if (decision.reason === "PROMPT_INJECTION") {
    throw new Error("input flagged as prompt injection");
  }
  throw new Error("blocked");
}
```

`decision.reason` is a flat string when `conclusion === "DENY"` — one of `"RATE_LIMIT"`, `"PROMPT_INJECTION"`, `"SENSITIVE_INFO"`, `"MODERATE_CONTENT"`, `"CUSTOM"`, `"ERROR"`, `"NOT_RUN"`, `"UNKNOWN"`. (On ALLOW it's `undefined`.) Prompt-injection and content-moderation results may include optional `billing` (`{ unit, count }` as bigint). Prompt injection uses `tokens`; moderation uses `text_units`. Read the types on the decision object for the full structure.

### Errors vs warnings (failing open)

`guard()` never throws for runtime degradation — a transport failure or a rule that couldn't be processed comes back as a fail-open `"ALLOW"` decision, not an exception. Two distinct signals (available from **`@arcjet/guard` 1.6.0**) tell you what happened:

- `decision.hasFailedOpen()` — `true` when the decision is `"ALLOW"` *only* because a rule or the decision itself could not be processed. This is the **fail-closed gate**: if the operation is sensitive enough that a degraded Arcjet signal should block rather than allow, branch on this and deny. `decision.errorResults()` returns the errored results (each with a `code`/`message`) for logging.
- `decision.warnings` — request-validation diagnostics (e.g. an invalid metadata key that was stripped). The decision is still valid and trustworthy; warnings never change the conclusion. Log them so the config gets fixed, but don't block on them.

To attribute a failure to a *specific* rule rather than scanning the whole decision, each rule also exposes `.errorResult(decision)` (new in **`@arcjet/guard` 1.6.0**) — the mirror of `.deniedResult(decision)`. It returns that rule's `RuleResultError` (with `code`/`message`) if that rule errored, else `null`. Use it when only one rule failing open is actually unsafe (e.g. the prompt-injection scan) while others failing open is tolerable.

```typescript
const decision = await arcjet.guard({ label: "tools.get-weather", rules });
if (decision.hasFailedOpen()) {
  // Arcjet couldn't fully evaluate. Allow by default, or deny for a sensitive op.
  console.error("guard failed open", decision.errorResults());
}
for (const w of decision.warnings) console.warn(`${w.code}: ${w.message}`);
```

On `@arcjet/guard` ≤ 1.5.0 the only signal is `decision.hasError()`, which is **deprecated** from 1.6.0 (it conflated request diagnostics with rule errors). Check the installed package's types — if `hasFailedOpen` exists, prefer it over `hasError()`.

### Correlation IDs

Available from **`@arcjet/guard` 1.6.0**: pass `correlationId` to `.guard()` to correlate a guard decision with a request, workflow run, or agent trace. It is a dedicated field, not metadata, and it does not affect the decision.

### Outbound HTTP proxy

Available from **`@arcjet/guard` 1.6.0**: standard `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` environment variables are auto-detected for outbound Arcjet API calls where the runtime supports proxying. Do not log proxy URLs because they may contain credentials.

## Capture and flush

`capture()` records that an action happened. It is not a security decision — it never denies, never throws, and never sets `hasFailedOpen()`.

```typescript
arcjet.capture({
  action: "refund.issued",
  correlationId: runId,
  decisionId: decision.id,
  metadata: { invoice: { id, amount: 4200 }, refunded: true },
});
```

Events batch in memory and send in the background. Call `await arcjet.flush()` on shutdown (default 1s deadline). On Cloudflare, pass `waitUntil` per capture or `ctx.waitUntil(arcjet.flush())` at the end of the handler. Vercel discovers `waitUntil` automatically.

## Optional registration

`launchArcjet()` never touches global state. `registerArcjet(arcjet)` is a separate, explicit call for code too deep to receive a client:

```typescript
import { launchArcjet, registerArcjet, capture, guard } from "@arcjet/guard";

registerArcjet(launchArcjet({ key: process.env.ARCJET_KEY! }));
// later, with no client in scope:
capture({ action: "refund.issued", metadata: { invoice: id } });
```

Free `guard()` fail-opens if nothing is registered — `hasFailedOpen()` is true; treat that as "policy did not run." Free `capture()` drops silently. A second `registerArcjet` does not displace the first. `unregisterArcjet()` clears whatever is there — libraries should not call it.

For tests, `registerTestClient()` from `@arcjet/guard/testing` records calls and talks to nothing. Use `using` (or `unregister()` in `finally` on Node 22). Its `guard()` always returns fail-open ALLOW, so fail-closed wrappers (`guardTool`, `guardAction`) will deny against it.

## Framework integrations

Import the versioned path. Unversioned aliases (`@arcjet/guard/vercel-ai`, `/vercel-eve`, `/mastra`, `/langgraph`, `/claude-agent-sdk`) do not resolve. Wrappers fail closed by default (`onGuardError: "deny"`).

| Integration | Import | Use when |
| --- | --- | --- |
| Vercel AI SDK v7 | `@arcjet/guard/vercel-ai/v7` | Authored `tool({ execute })`. `guardTool` + `aiToolsContext(createAgentContext(), tools)`. Also exports `guardAction`, `captureAction`, `securityMetadata`. Wrapped tools cannot already declare `contextSchema`. |
| Vercel Eve v0 | `@arcjet/guard/vercel-eve/v0` | Eve agents. Optional peer `eve` `>=0.34.0 <1` (still 0.x). Node ≥ 24. `guardInbound` on channels (only place to decline a turn before it starts) — its verdict carries `outcome` (`"DENY"` \| `"UNAVAILABLE"`, denial vs outage) and the rule category on `verdict.decision?.reason`; `verdict.reason` is a deprecated alias for `outcome`, so do not return it as the category. `guardApproval` on OpenAPI/MCP connections (no local `execute`): `approval` is a function or `{ request, response }`; do not compose with Eve `always()`/`once()`/`never()`. `onAllow: "user-approval"` parks for HITL; optional `response` authorizes the responder. Request/response form is on current docs/`main`, not published 1.10.0. `arcjetHooks` is observe-only. |
| Mastra v1 | `@arcjet/guard/mastra/v1` | On current docs/`main`, not published 1.10.0. Wrapping a `createTool()` result under `exactOptionalPropertyTypes` needs `main` — earlier builds constrained `guardTool` to `ToolAction<any, any>`, which a real Mastra `Tool` cannot satisfy (TS2379). `guardProcessor` for inbound/outbound text (no `guardInbound`). `guardTool` for authored tools. `guardHooks` for unwrapped MCP/workspace tools (`beforeToolCall` can deny). No `guardApproval` — Mastra `requireApproval` is human HITL. Do not also wrap with `vercel-ai/v7`. |
| Claude Agent SDK v0 | `@arcjet/guard/claude-agent-sdk/v0` | On current docs/`main`, not published 1.10.0. `guardTool` for authored `tool()` + `createSdkMcpServer()`. `guardHooks` supplies `UserPromptSubmit` (the only place a turn can be declined before the model reads it) and `PreToolUse` (the only deny for built-ins and unwrapped MCP); `PostToolUse` is capture only. No `guardInbound`. `canUseTool` is **not** a policy gate — it is skipped by `allowedTools`, allow rules and `bypassPermissions`. `claudeAgentContext` reads `session_id` / `options.sessionId`. Optional peer `@anthropic-ai/claude-agent-sdk` `>=0.1.0 <1`. Node.js 22+. |
| LangGraph v1 | `@arcjet/guard/langgraph/v1` | On current docs/`main`, not published 1.10.0. Graph API (`StateGraph` + `ToolNode` from `@langchain/langgraph/prebuilt`), not LangChain `createAgent` / `wrapToolCall`. Do not build on `createReactAgent`. `guardTool` for authored `tool()` / `StructuredTool`. `guardToolNode` for MCP / unwrapped tools. `langgraphAgentContext` reads `thread_id`. No `guardInbound` / `guardApproval` / `guardInterrupt` — `interrupt()` is human HITL. Optional peers `@langchain/langgraph` and `@langchain/core` `>=1 <2`. Node.js 22+. Do not also wrap with `vercel-ai/v7`. |

### Claude Agent SDK

Exports: `guardTool`, `guardHooks`, `claudeAgentContext`, plus the shared
`guardAction` / `captureAction` / `securityMetadata`. There is no unversioned
`@arcjet/guard/claude-agent-sdk` alias.

- **`guardTool`** wraps an authored `tool()` definition (the ones you pass to `createSdkMcpServer`) so the handler never runs on DENY. It does not throw: the model receives a `CallToolResult` with `isError: true` and `structuredContent.arcjetDenied`.
- **`guardHooks`** returns hooks for `query({ options.hooks })`. `inbound` screens `UserPromptSubmit` — the only place a turn can be declined before the model reads the prompt, so prompt-injection rules go here. `PreToolUse` denies with `permissionDecision: "deny"` and is the only gate for built-ins (Bash, Write) and unwrapped MCP tools. `PostToolUse` is observe-only.
- **`exclude`** on `guardHooks` lists tools that already guard themselves via `guardTool`. `PreToolUse` fires for every tool and the hook input carries only a name, so without it a wrapped tool is guarded twice per invocation — two round trips, two quota units. Entries match the reported name exactly: pass `{ server, name }` for an authored tool (it resolves to `mcp__<server>__<tool>`) and a bare string for a built-in. A bare authored name deliberately does **not** match every server's tool of that name — two servers can expose the same name with only one wrapped.
- **`options.sessionId` must be a UUID, and a session id can only be created once.** A non-UUID exits the CLI with `Invalid session ID. Must be a valid UUID.`; passing the same id to a second `query()` exits with `Session ID … is already in use.` Mint one UUID per conversation, then continue it with `options.resume` — which is also what keeps every turn on one Sequence, since `claudeAgentContext` reads the hook's `session_id` first.
- `canUseTool` is not a policy gate (skipped by `allowedTools`, allow rules, `bypassPermissions` / `acceptEdits`), and annotations / sandbox settings are not enforcement. Do not double-wrap with `vercel-ai/v7`.

```typescript
import { randomUUID } from "node:crypto";
import { launchArcjet, detectPromptInjection, tokenBucket } from "@arcjet/guard";
import { guardHooks, guardTool } from "@arcjet/guard/claude-agent-sdk/v0";
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const arcjet = launchArcjet({ key: process.env.ARCJET_KEY! });
const lookupLimit = tokenBucket({ bucket: "lookups", refillRate: 10, intervalSeconds: 60, maxTokens: 10 });

// The authenticated caller this conversation belongs to. Key the budget on the
// actor, not on the object being acted on: an order id is model-supplied, so
// keying on it lets a looping agent get a fresh budget per order and makes two
// unrelated callers share one.
const userId = authenticatedUserId;

const lookupOrder = guardTool(
  arcjet,
  tool("lookup_order", "Look up an order", { orderId: z.string() }, async ({ orderId }) => ({
    content: [{ type: "text", text: `${orderId}: shipped` }],
  })),
  {
    action: "order.looked-up",
    rules: () => [lookupLimit({ key: userId, requested: 1 })],
  },
);

const sessionId = randomUUID(); // per conversation, not per turn

for await (const message of query({
  prompt: userText,
  options: {
    sessionId, // later turns: `resume: sessionId` instead
    mcpServers: { support: createSdkMcpServer({ name: "support", tools: [lookupOrder] }) },
    hooks: guardHooks(arcjet, {
      sessionId,
      exclude: [{ server: "support", name: "lookup_order" }], // guarded by guardTool
      inbound: {
        action: "message.received",
        rules: ({ prompt }) => [detectPromptInjection()(prompt)],
      },
    }),
  },
})) {
  void message;
}
```

### Vercel Eve

Exports: `guardTool`, `guardApproval`, `guardInbound`, `arcjetHooks`, `eveAgentContext`. Import `@arcjet/guard/vercel-eve/v0` — there is no unversioned alias and no `/v1`. Optional peer `eve` `>=0.34.0 <1`. Eve is still 0.x. Node.js ≥ 24. The request/response form is on current docs/`main`, not published 1.10.0.

`guardInbound`, `arcjetHooks`, and `guardTool` are unchanged. `guardApproval` now supports Eve 0.34+ request/response approval:

- **`approval` is one field.** It can be a function (request-time only) or `{ request, response }`. You cannot compose `guardApproval` with Eve's `always()` / `once()` / `never()`.
- Omit `response` and `guardApproval()` returns Eve's `ApprovalPolicy` function. Set `response` and it returns `{ request, response }` (`ApprovalConfiguration`).
- **`onAllow: "user-approval"`** parks the call for a human after the request-time gate.
- Optional `response` is `GuardApprovalResponsePolicy` against Eve's `ApprovalResponseContext`. Use it to authorize who may approve a parked HITL request (e.g. key a limit on `ctx.responder.principalId`). The request-time policy typically keys on `ctx.session.id` — split buckets, don't share one.
- Response-time ALLOW → `{ status: "allowed" }`. If the response policy denies the responder, or Arcjet is unreachable and `onGuardError` is `"deny"` (default), it returns `{ status: "rejected", reason }` and the approval stays pending. A rejection does not deny the tool.
- Request-time denials remain `{ type: "denied", reason }`. HITL clients answer with `cancel`, not `deny`.
- Fail closed by default (`onGuardError: "deny"`).

```typescript
import { launchArcjet, tokenBucket } from "@arcjet/guard";
import { guardApproval } from "@arcjet/guard/vercel-eve/v0";
import { defineOpenAPIConnection } from "eve/connections";

const arcjet = launchArcjet({ key: process.env.ARCJET_KEY! });
const sessionLimit = tokenBucket({
  bucket: "weather-session",
  refillRate: 5,
  intervalSeconds: 60,
  maxTokens: 5,
});
const approverLimit = tokenBucket({
  bucket: "weather-approver",
  refillRate: 5,
  intervalSeconds: 60,
  maxTokens: 5,
});

export default defineOpenAPIConnection({
  description: "Weather API",
  spec: "https://api.example.com/openapi.json",
  approval: guardApproval(arcjet, {
    action: "weather.fetched",
    rules: (ctx) => [sessionLimit({ key: ctx.session.id, requested: 1 })],
    onAllow: "user-approval",
    response: {
      action: "weather.approved",
      rules: (ctx) => [approverLimit({ key: ctx.responder.principalId, requested: 1 })],
    },
  }),
  operations: {
    allow: ["GetForecast"],
  },
});
```

### LangGraph

Exports: `guardTool`, `guardToolNode`, `langgraphAgentContext`. There is no unversioned `@arcjet/guard/langgraph` alias. This is LangGraph Graph API (`StateGraph` + `ToolNode` from `@langchain/langgraph/prebuilt`). It is not LangChain `createAgent` / `wrapToolCall`. Do not build on `createReactAgent` (deprecated in LangGraph JS v1).

- **`guardTool`** wraps a LangChain `tool()` / `StructuredTool` so `func` / `invoke` never runs on `DENY`. The helper does not throw. The model receives a structured `ArcjetDenialResult` (`arcjetDenied: true`). `ToolNode` wraps that object into a real `ToolMessage` whose status is `success` — the denial rides in the payload, not the envelope. Do not fabricate a `ToolMessage` to force status `error`.
- **`guardToolNode`** guards the tools a `ToolNode` executes (MCP / runtime-discovered / unwrapped tools). It guards in place and returns the same node. A frozen tools array throws. The tools-array form returns copies and leaves the input array alone. Already-guarded tools are skipped so Guard is not called twice.
- **`langgraphAgentContext`** reads `configurable.thread_id`, then the run id, then `configurable.checkpoint_ns`. It never mints an id. Do not call `createAgentContext` inside a LangGraph callback.
- There is no `guardInbound` (screen before `graph.invoke` or in the first node). There is no `guardApproval` / `guardInterrupt`: `interrupt()` / `interrupt_before=["tools"]` is human HITL, not a policy gate (same trap as Mastra `requireApproval` and Claude `canUseTool`).
- Fail closed by default (`onGuardError: "deny"`). Do not also wrap with `@arcjet/guard/vercel-ai/v7`.

```typescript
import { launchArcjet, tokenBucket } from "@arcjet/guard";
import { guardTool, guardToolNode } from "@arcjet/guard/langgraph/v1";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

const arcjet = launchArcjet({ key: process.env.ARCJET_KEY! });
const lookupLimit = tokenBucket({
  bucket: "lookups",
  refillRate: 10,
  intervalSeconds: 60,
  maxTokens: 10,
});
// The authenticated caller, so a budget cannot be reset by varying the order id.
const userId = authenticatedUserId;

const mcpLimit = tokenBucket({
  bucket: "mcp-access",
  refillRate: 20,
  intervalSeconds: 60,
  maxTokens: 20,
});

const lookupOrder = guardTool(
  arcjet,
  tool(async ({ orderId, note }) => ({ orderId, note, status: "shipped" }), {
    name: "lookup_order",
    description: "Look up an order by ID",
    schema: z.object({
      orderId: z.string(),
      note: z.string(),
    }),
  }),
  {
    action: "order.looked-up",
    // Keyed on the authenticated caller, not the model-supplied order id.
    rules: () => [lookupLimit({ key: userId, requested: 1 })],
  },
);

const mcpTools = []; // from an MCP client you did not wrap with guardTool
export const tools = guardToolNode(arcjet, new ToolNode([lookupOrder, ...mcpTools]), {
  action: ({ toolName }) => `${toolName}.invoked`,
  rules: ({ toolName }) => [mcpLimit({ key: toolName, requested: 1 })],
});
```

See https://docs.arcjet.com/guards/framework-integrations/, https://docs.arcjet.com/guards/claude-agent-sdk/, https://docs.arcjet.com/guards/vercel-eve/, https://docs.arcjet.com/guards/mastra/, and https://docs.arcjet.com/guards/langgraph/.

## Key Patterns

- Pass `signal` (an `AbortSignal`) on the `.guard()` call when one is available (e.g. from the caller or a timeout) so guard respects cancellation. `timeoutSeconds` is also available for a simple deadline.
- Use `metadata` for analytics/auditing context — nested JSON, not a flat string map. It appears in the Console and does not affect the decision. Do not put secrets or PII in it.
- The `label` string should identify the operation (e.g. `"tools.get-weather"`, `"mcp.query-database"`) — it appears in the Console and helps you understand which operations are being rate limited or blocked.
