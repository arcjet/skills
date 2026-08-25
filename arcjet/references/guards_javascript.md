# JavaScript/TypeScript Guard

## Contents

- [What Guard is](#what-guard-is)
- [Installation](#installation)
- [Architecture: why things go where they do](#architecture-why-things-go-where-they-do)
- [Choose a rate limit strategy](#choose-a-rate-limit-strategy)
- [Content scanning rules](#content-scanning-rules)
- [Decision handling](#decision-handling)
- [Capture and flush](#capture-and-flush)
- [Optional registration](#optional-registration)
- [Framework integrations](#framework-integrations)
- [Key patterns](#key-patterns)

## What Guard is

Guard protects code paths that don't have an HTTP request – tool calls, agent loops, MCP handlers, queue consumers, background jobs. It's a separate SDK (`@arcjet/guard`) from the HTTP request SDKs (`@arcjet/node`, `@arcjet/next`) because there's no request object to inspect. Instead, you pass explicit context (labels, keys, text to scan) at each call site.

## Installation

Install with whichever package manager the project already uses (`npm install`, `pnpm add`, `yarn add`, `bun add`) – don't hand-edit `package.json`:

```bash
npm install @arcjet/guard
```

Requires `@arcjet/guard` ≥ 1.4.0 for basic Guard protection. Features called out as 1.6.0 in the following sections still apply. Capture, registration, Rampart, nested metadata, and threat/billing require **`@arcjet/guard` 1.10.0**. Runtime minimums match the Arcjet JS SDK line:

| Runtime            | Minimum version          |
| ------------------ | ------------------------ |
| Node.js            | `>=22.21.0 <23 \|\| >=24.5.0` |
| Bun                | 1.3.0                    |
| Deno               | `stable` / `lts`         |
| Cloudflare Workers | compat date `2025-09-01` |

The correct transport is picked automatically via conditional exports (HTTP/2 on Node and Bun, fetch-based on Deno and Workers) – import from `@arcjet/guard` either way. If the project is on Node 20/21, Node 23, Node 24 below 24.5.0, or an older Bun/Workers compat date, warn the user and stop until the runtime is bumped.

Read the installed package's types and doc comments for the full API surface.

> _Runtime support last verified against the published `@arcjet/guard` **v1.10.0** on **August 11, 2026**. `moderateContent` (graduated name), `@arcjet/guard/mastra/v1`, `@arcjet/guard/langgraph/v1`, `@arcjet/guard/claude-agent-sdk/v0`, `@arcjet/guard/openai-agents/v0`, `@arcjet/guard/genkit/v1`, and `@arcjet/guard/langchain/v1` (JS `createAgent`) are on docs/`main` or until-published; they are not in 1.10.0 – importing one from 1.10.0 fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`. Shared `ArcjetDenialResult` plus per-framework envelopes are on `main` ([#6240](https://github.com/arcjet/arcjet-js/pull/6240)). Read the installed package's types before using any of them. Minimums tend to creep upward – check the [Runtime support section](https://github.com/arcjet/arcjet-js/tree/main/arcjet-guard#runtime-support) of the README._
>
> Teaching pins (not in npm 1.10.0):
>
> - OpenAI Agents: arcjet-js merge `0099fb76e9229fa0b5922f938f4f1ce2e1033ce1` ([#6233](https://github.com/arcjet/arcjet-js/pull/6233))
> - Genkit: arcjet-js merge `4e416787b5aad709476173f5daf6c30212710c37` ([#6243](https://github.com/arcjet/arcjet-js/pull/6243))
> - LangChain JS `createAgent`: arcjet-js merge `c49abcc1f9afce7d284b6c294d0dcee5916ada86` ([#6248](https://github.com/arcjet/arcjet-js/pull/6248))

## Architecture: why things go where they do

### Client at module scope

```typescript
import { launchArcjet } from "@arcjet/guard";
const arcjet = launchArcjet({ key: process.env.ARCJET_KEY! });
```

The client holds a persistent HTTP/2 connection to the Arcjet decision service. Creating it inside a function means a new connection per call – slow and wasteful.

### Rules at module scope

Rate limit state is tracked server-side by the combination of `bucket` and other configuration properties, so recreating rules per call won't break counting. However, defining rules at module scope is still best practice because:

- It makes the per-rule result accessors (for example `userLimit.deniedResult(decision)`) work – you need a stable reference to call methods on.
- It avoids unnecessary object allocation on every invocation.
- It keeps rule configuration visible and centralized.

```typescript
import { tokenBucket, detectPromptInjection } from "@arcjet/guard";

// WORKS but awkward – no stable reference for result inspection
function handleTool() {
  const limit = tokenBucket({ /* config */ }); // hard to call limit.deniedResult() later
}

// BETTER – declare rules at module scope, dynamically choose which to apply
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

Place `guard()` wherever you already know exactly what operation is happening. That's typically inside the specific tool/task function, but the dispatch arm right before the call works equally well – sometimes it gives cleaner error propagation:

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

The `label` must be a hardcoded string – `"tools.get-weather"`, not `` `tools.${name}` ``. Hardcoded labels stay greppable, and the Console groups by them; interpolation produces a sea of distinct-looking calls instead of one bucket per operation.

**Label naming rules:** labels are validated server-side as slugs – **lowercase letters, digits, dash (`-`), and dot (`.`) only**, must start and end with a letter or digit, max 256 bytes. Underscores, uppercase, and forward slashes are rejected. Metadata *keys* may contain underscores; labels and rate-limit `bucket` names may not. Use `tools.get-weather`, not `tools.get_weather`.

Pass `metadata` whenever you have useful auditing context. It is nested JSON, not a flat string map – `{ user: { id: userId }, requestId }` is valid. It shows up in the Console and does not affect the decision. Do not put secrets or PII in it.

## Choose a rate limit strategy

For a comparison of token bucket vs fixed window vs sliding window, see [Choose protections](choosing_protections.md).

Key Guard-specific notes: all rate limit rules require a `key` parameter at call time (user ID, session ID, API key) – without it, limits are global across all callers. They also need a `bucket` name to avoid collisions between different rules.

**Picking a `key` when there's no user:** Some call sites have no per-user context – for example a stdio MCP server where the client is the only caller, or a single-tenant queue worker. Don't try to fake it by passing an empty string. Use whatever identifier actually matches the scope of the limit:
- single-tenant worker → the deployment name or env (`process.env.HOSTNAME ?? "default"`)
- stdio MCP server → the MCP client/session id if exposed by the SDK, otherwise the process identity
- shared limit across all callers → a stable literal like `"global"`, and add a comment explaining why
The point is to be intentional. A wrong-but-explicit `key` is much easier to fix than a missing one.

## Content scanning rules

### Prompt injection detection

Use `detectPromptInjection()` on any untrusted text before it reaches a model or is used as a tool argument. This catches jailbreaks, role-play escapes, and instruction overrides. Also useful on tool call *results* when the tool fetches content from untrusted sources.

### Sensitive information detection

Use `localDetectSensitiveInfo()` to block PII from entering or leaving the system (for example users sending credit card numbers, or tool outputs leaking email addresses). The scan runs locally – raw text never leaves the SDK. The default backend is WASM; see [On-device Rampart backend](#on-device-rampart-backend) for names and government / financial identifiers.

**The default backend detects exactly four entity types** – `"EMAIL"`, `"PHONE_NUMBER"`, `"IP_ADDRESS"`, `"CREDIT_CARD_NUMBER"` – even though `SensitiveInfoEntityType` names twenty. Listing any of the other sixteen without a `backend` produces a rule that can never match: current `main` rejects it at compile time (`allow` / `deny` narrow to `NativeSensitiveInfoEntityType` when no `backend` is set), and published 1.10.0 throws at module load with a message naming the type. Either way, add `backend: rampart()` or drop the type.

### Content moderation

`moderateContent()` flags unsafe or policy-violating text for Guard call sites (not available on `protect()`). The result is `{ detected, billing? }` – `billing.unit` is `text_units` when present. Published **1.10.0** still exports `experimental_moderateContent` as the public name; current docs and `main` graduate it to `moderateContent` and keep the old name as a deprecated alias. Import whichever the installed types export. `decision.reason` is `"MODERATE_CONTENT"` on deny.

### On-device Rampart backend

`localDetectSensitiveInfo()` defaults to the bundled WASM engine (card, email, phone, IP). For names, addresses, and government / financial identifiers, install `@arcjet/sensitive-info-rampart` and pass `backend: rampart()`. Detection still runs locally. Rampart needs Node/Bun/Deno with filesystem access – not edge.

```typescript
import { localDetectSensitiveInfo } from "@arcjet/guard";
import { rampart } from "@arcjet/sensitive-info-rampart";

const si = localDetectSensitiveInfo({
  deny: ["GIVEN_NAME", "SURNAME", "EMAIL", "SSN"],
  backend: rampart(),
});
```

## Decision handling

`decision.conclusion` is either `"ALLOW"` or `"DENY"`. Always check before proceeding.

For useful error messages, branch on **which rule** denied – not just on `DENY`. Each rule defined at module scope exposes a `.deniedResult(decision)` accessor that returns rule-specific info (for example `resetAtUnixSeconds` for rate limits). Use this to give the caller something actionable:

```typescript
if (decision.conclusion === "DENY") {
  const rateLimited = toolCallLimit.deniedResult(decision);
  if (rateLimited) {
    throw new Error(`rate limited – retry after unix ${rateLimited.resetAtUnixSeconds}`);
  }
  if (decision.reason === "PROMPT_INJECTION") {
    throw new Error("input flagged as prompt injection");
  }
  throw new Error("blocked");
}
```

`decision.reason` is a flat string when `conclusion === "DENY"` – one of `"RATE_LIMIT"`, `"PROMPT_INJECTION"`, `"SENSITIVE_INFO"`, `"MODERATE_CONTENT"`, `"CUSTOM"`, `"ERROR"`, `"NOT_RUN"`, `"UNKNOWN"`. (On ALLOW it's `undefined`.) Prompt-injection and content-moderation results may include optional `billing` (`{ unit, count }` as bigint). Prompt injection uses `tokens`; moderation uses `text_units`. Read the types on the decision object for the full structure.

### Errors vs warnings (failing open)

`guard()` never throws for runtime degradation – a transport failure or a rule that couldn't be processed comes back as a fail-open `"ALLOW"` decision, not an exception. Two distinct signals (available from **`@arcjet/guard` 1.6.0**) tell you what happened:

- `decision.hasFailedOpen()` – `true` when the decision is `"ALLOW"` *only* because a rule or the decision itself could not be processed. This is the **fail-closed gate**: if the operation is sensitive enough that a degraded Arcjet signal must block rather than allow, branch on this and deny. `decision.errorResults()` returns the errored results (each with a `code`/`message`) for logging.
- `decision.warnings` – request-validation diagnostics (for example an invalid metadata key that was stripped). The decision is still valid and trustworthy; warnings never change the conclusion. Log them so the config gets fixed, but don't block on them.

To attribute a failure to a *specific* rule rather than scanning the whole decision, each rule also exposes `.errorResult(decision)` (added in **`@arcjet/guard` 1.6.0**) – the mirror of `.deniedResult(decision)`. It returns that rule's `RuleResultError` (with `code`/`message`) if that rule errored, else `null`. Use it when only one rule failing open is actually unsafe (for example the prompt-injection scan) while others failing open is tolerable.

```typescript
const decision = await arcjet.guard({ label: "tools.get-weather", rules });
if (decision.hasFailedOpen()) {
  // Arcjet couldn't fully evaluate. Allow by default, or deny for a sensitive op.
  console.error("guard failed open", decision.errorResults());
}
for (const w of decision.warnings) console.warn(`${w.code}: ${w.message}`);
```

On `@arcjet/guard` ≤ 1.5.0 the only signal is `decision.hasError()`, which is **deprecated** from 1.6.0 (it conflated request diagnostics with rule errors). Check the installed package's types – if `hasFailedOpen` exists, prefer it over `hasError()`.

### Correlation IDs

Available from **`@arcjet/guard` 1.6.0**: pass `correlationId` to `.guard()` to correlate a guard decision with a request, workflow run, or agent trace. It is a dedicated field, not metadata, and it does not affect the decision.

### Outbound HTTP proxy

Available from **`@arcjet/guard` 1.6.0**: standard `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` environment variables are auto-detected for outbound Arcjet API calls where the runtime supports proxying. Do not log proxy URLs because they may contain credentials.

## Capture and flush

`capture()` records that an action happened. It is not a security decision – it never denies, never throws, and never sets `hasFailedOpen()`.

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

Free `guard()` fail-opens if nothing is registered – `hasFailedOpen()` is true; treat that as "policy did not run." Free `capture()` drops silently. A second `registerArcjet` does not displace the first. `unregisterArcjet()` clears whatever is there – libraries must not call it.

For tests, `registerTestClient()` from `@arcjet/guard/testing` records calls and talks to nothing. Use `using` (or `unregister()` in `finally` on Node 22). Its `guard()` always returns fail-open ALLOW, so fail-closed wrappers (`guardTool`, `guardAction`) will deny against it.

## Framework integrations

Import the versioned path. Unversioned aliases (`@arcjet/guard/vercel-ai`, `/vercel-eve`, `/mastra`, `/langgraph`, `/langchain`, `/claude-agent-sdk`, `/openai-agents`, `/genkit`) do not resolve. Wrappers fail closed by default (`onGuardError: "deny"`).

| Integration | Import | Use when |
| --- | --- | --- |
| Vercel AI SDK v7 | `@arcjet/guard/vercel-ai/v7` | Authored `tool({ execute })`. `guardTool` + `aiToolsContext(createAgentContext(), tools)`. Also exports `guardAction`, `captureAction`, `securityMetadata`. Wrapped tools cannot already declare `contextSchema`. |
| Vercel Eve v0 | `@arcjet/guard/vercel-eve/v0` | Eve agents. Optional peer `eve` `>=0.34.0 <1` (still 0.x). Node ≥ 24. `guardInbound` on channels (only place to decline a turn before it starts) – its verdict carries `outcome` (`"DENY"` \| `"UNAVAILABLE"`, denial vs outage) and the rule category on `verdict.decision?.reason`; `verdict.reason` is a deprecated alias for `outcome`, so do not return it as the category. `guardApproval` on OpenAPI/MCP connections (no local `execute`): `approval` is a function or `{ request, response }`; do not compose with Eve `always()`/`once()`/`never()`. `onAllow: "user-approval"` parks for HITL; optional `response` authorizes the responder. Request/response form is on current docs/`main`, not published 1.10.0. `arcjetHooks` is observe-only. |
| Mastra v1 | `@arcjet/guard/mastra/v1` | On current docs/`main`, not published 1.10.0. Wrapping a `createTool()` result under `exactOptionalPropertyTypes` needs `main` – earlier builds constrained `guardTool` to `ToolAction<any, any>`, which a real Mastra `Tool` cannot satisfy (TS2379). `guardProcessor` for inbound/outbound text (no `guardInbound`). `guardTool` for authored tools. `guardHooks` for unwrapped MCP/workspace tools (`beforeToolCall` can deny). No `guardApproval` – Mastra `requireApproval` is human HITL. Do not also wrap with `vercel-ai/v7`. |
| Claude Agent SDK v0 | `@arcjet/guard/claude-agent-sdk/v0` | On current docs/`main`, not published 1.10.0. `guardTool` for authored `tool()` + `createSdkMcpServer()`. `guardHooks` supplies `UserPromptSubmit` (the only place a turn can be declined before the model reads it) and `PreToolUse` (the only deny for built-ins and unwrapped MCP); `PostToolUse` is capture only. No `guardInbound`. `canUseTool` is **not** a policy gate – it is skipped by `allowedTools`, allow rules and `bypassPermissions`. `claudeAgentContext` reads `session_id` / `options.sessionId`. Optional peer `@anthropic-ai/claude-agent-sdk` `>=0.1.0 <1`. Node.js 22+. |
| LangGraph v1 | `@arcjet/guard/langgraph/v1` | On current docs/`main`, not published 1.10.0. Graph API (`StateGraph` + `ToolNode` from `@langchain/langgraph/prebuilt`), not LangChain `createAgent` / `wrapToolCall` (that is `@arcjet/guard/langchain/v1`, docs `/guards/langchain-js/`). Do not build on `createReactAgent`. `guardTool` for authored `tool()` / `StructuredTool`. `guardToolNode` for MCP / unwrapped tools. `langgraphAgentContext` reads `thread_id`. No `guardInbound` / `guardApproval` / `guardInterrupt` – `interrupt()` is human HITL. Optional peers `@langchain/langgraph` and `@langchain/core` `>=1 <2`. Node.js 22+. Do not also wrap with `vercel-ai/v7`. |
| LangChain JS createAgent v1 | `@arcjet/guard/langchain/v1` | Until-published (not in npm 1.10.0; pin `@arcjet/guard` to git SHA `c49abcc1`, [#6248](https://github.com/arcjet/arcjet-js/pull/6248)). JS `createAgent` + `createMiddleware({ wrapToolCall })`. Not LangGraph `StateGraph`/`ToolNode` (`/guards/langgraph/`). Not Python LangChain (`/guards/langchain/`). `guardTool` + `guardMiddleware` + `langchainContext` only. No unversioned `@arcjet/guard/langchain` alias. Optional peers `langchain` `>=1.2.0 <2` and `@langchain/core` `>=1 <2` — no `@langchain/langgraph` peer. `guardTool` returns a plain `ArcjetDenialResult`; `guardMiddleware` `wrapToolCall` short-circuit returns a real `ToolMessage` (JSON content, default status). Policy on `wrapToolCall` only. `wrapToolCall` only sees `runtime.configurable.thread_id` as of langchain 1.2.34. `humanInTheLoopMiddleware` is HITL. Node.js 22+. Do not also wrap with `langgraph/v1` or `vercel-ai/v7`. Docs https://docs.arcjet.com/guards/langchain-js/. |
| OpenAI Agents v0 | `@arcjet/guard/openai-agents/v0` | On `main` at merge `0099fb76` ([#6233](https://github.com/arcjet/arcjet-js/pull/6233)), not published 1.10.0. Text `Agent` + `run()` / `Runner` + authored `tool()`. Not Realtime, Sandbox, hosted, MCP, `asTool`, computer/shell. `guardTool` + `openaiAgentsContext` only. No `guardInbound` / `guardApproval` / `guardToolNode` / `guardHooks`. `needsApproval` is HITL. Optional peer `@openai/agents` `>=0.17.0 <1`. Node.js 22+. Do not also wrap with `vercel-ai/v7`. |
| Genkit v1 | `@arcjet/guard/genkit/v1` | On `main` at merge `4e416787` ([#6243](https://github.com/arcjet/arcjet-js/pull/6243)), not published 1.10.0. JS `genkit()` + `ai.defineTool` + `ai.generate` – not Go / Python Genkit. `guardTool` + `guardMiddleware` + `genkitContext` only. No `guardInbound` / `guardApproval` / `guardAction` / `createAgentContext` / `aiToolsContext`. `interrupt()` / `defineInterrupt` / `toolApproval` is HITL. `guardMiddleware` needs Genkit >= 1.33 (`tool` hook). Optional peer `genkit` `>=1.0.0 <2`. Node.js 22+. Do not also wrap with `vercel-ai/v7`. |

### Denial responses

Every JS adapter uses one payload – `ArcjetDenialResult` – built by a single shared helper ([arcjet-js#6240](https://github.com/arcjet/arcjet-js/pull/6240)). The fields are identical so a model trained on denial objects sees the same shape regardless of which integration is in use. The envelope is per-framework, because each SDK has a different idiomatic way to report that a tool did not run. Canonical table: the [Denial responses](https://github.com/arcjet/arcjet-js/blob/main/arcjet-guard/README.md) section of the Guard README.

```typescript
const result: ArcjetDenialResult = {
  arcjetDenied: true,
  reason: "RATE_LIMIT",
  message: "Arcjet denied this call (RATE_LIMIT). It may be retried after 30 seconds.",
  retryable: true,
  retryAfterSeconds: 30,
};
```

AI SDK wording is `"Arcjet denied this call …"` (no longer `"tool call"`).

| Adapter | Idiomatic envelope | Why not the others |
| --- | --- | --- |
| AI SDK / Mastra | Return `{ arcjetDenied: true, … }` as the tool result | A throw becomes a generic tool error and drops the fields |
| OpenAI Agents | Return `{ arcjetDenied: true, … }` from `invoke` | A throw hits `errorFunction` or `ToolCallError` and can kill the run |
| Genkit | Return `{ arcjetDenied: true, … }` as completed `toolResponse.output` | A throw drops the fields. `interrupt()` / `ToolInterruptError` is HITL (`finishReason: "interrupted"`), not a denial |
| LangGraph | Return `{ arcjetDenied: true, … }`; `ToolNode` wraps it as a `ToolMessage` with `status: "success"` | Faking a `ToolMessage` to force `status: "error"` crashes the graph reducer |
| LangChain JS createAgent | `guardTool` returns a plain `ArcjetDenialResult` (`createAgent` `baseHandler` wraps it). `guardMiddleware` `wrapToolCall` short-circuit returns a real `ToolMessage` (JSON `content`, default status) | A throw drops the fields. A bare object from `wrapToolCall` crashes the reducer. `humanInTheLoopMiddleware` is HITL, not a denial. Distinct from LangGraph Graph API (`ToolNode` wraps a plain object) |
| Claude Agent SDK | MCP `CallToolResult` with `isError: true` and the payload on `structuredContent` | A throw is a raw exception; omitting `isError` looks like success |
| Vercel Eve | Throw `ArcjetDeniedError`. Opt in to a returned payload with `onDeny: "result"` | Eve projects a throw as a failed `action.result`. A silent return can violate `outputSchema` |

`guardTool` and `guardAction` remain different handlers. A model-facing `onDeny` must return an envelope the model can inspect; `guardAction` throws `ArcjetDeniedError` so application code can `catch`. Sharing one callback would either leak a throw into the tool loop or swallow a policy denial as a successful action.

### Claude Agent SDK

Exports: `guardTool`, `guardHooks`, `claudeAgentContext`, plus the shared
`guardAction` / `captureAction` / `securityMetadata`. There is no unversioned
`@arcjet/guard/claude-agent-sdk` alias.

- **`guardTool`** wraps an authored `tool()` definition (the ones you pass to `createSdkMcpServer`) so the handler never runs on DENY. Delivery is the shared `ArcjetDenialResult` in a MCP `CallToolResult` with `isError: true` (payload on `structuredContent`). A throw is a raw exception; omitting `isError` looks like success.
- **`guardHooks`** returns hooks for `query({ options.hooks })`. `inbound` screens `UserPromptSubmit` – the only place a turn can be declined before the model reads the prompt, so prompt-injection rules go here. Inbound deny is Claude's hook shape `{ decision: "block" }`, not `ArcjetDenialResult`. `PreToolUse` denies with `permissionDecision: "deny"` and is the only gate for built-ins (Bash, Write) and unwrapped MCP tools. `PostToolUse` is observe-only.
- **`exclude`** on `guardHooks` lists tools that already guard themselves via `guardTool`. `PreToolUse` fires for every tool and the hook input carries only a name, so without it a wrapped tool is guarded twice per invocation – two round trips, two quota units. Entries match the reported name exactly: pass `{ server, name }` for an authored tool (it resolves to `mcp__<server>__<tool>`) and a bare string for a built-in. A bare authored name deliberately does **not** match every server's tool of that name – two servers can expose the same name with only one wrapped.
- **`options.sessionId` must be a UUID, and a session id can only be created once.** A non-UUID exits the CLI with `Invalid session ID. Must be a valid UUID.`; passing the same id to a second `query()` exits with `Session ID … is already in use.` Mint one UUID per conversation, then continue it with `options.resume` – which is also what keeps every turn on one Sequence, since `claudeAgentContext` reads the hook's `session_id` first.
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

Exports: `guardTool`, `guardApproval`, `guardInbound`, `arcjetHooks`, `eveAgentContext`. Import `@arcjet/guard/vercel-eve/v0` – there is no unversioned alias and no `/v1`. Optional peer `eve` `>=0.34.0 <1`. Eve is still 0.x. Node.js ≥ 24. The request/response form is on current docs/`main`, not published 1.10.0.

`guardInbound` and `arcjetHooks` are unchanged. `guardTool` still throws `ArcjetDeniedError` (Eve projects that as a failed `action.result`). Opt in to a returned `ArcjetDenialResult` with `onDeny: "result"` so an `outputSchema` is not silently violated. `defineDynamic` / OpenAPI / MCP connections have no local `execute` – use `guardApproval`, not `guardTool`. `guardApproval` never throws; it returns Eve approval objects (`denied` / `rejected` / `allowed`). Eve 0.34+ request/response approval:

- **`approval` is one field.** It can be a function (request-time only) or `{ request, response }`. You cannot compose `guardApproval` with Eve's `always()` / `once()` / `never()`.
- Omit `response` and `guardApproval()` returns Eve's `ApprovalPolicy` function. Set `response` and it returns `{ request, response }` (`ApprovalConfiguration`).
- **`onAllow: "user-approval"`** parks the call for a human after the request-time gate.
- Optional `response` is `GuardApprovalResponsePolicy` against Eve's `ApprovalResponseContext`. Use it to authorize who may approve a parked HITL request (for example key a limit on `ctx.responder.principalId`). The request-time policy typically keys on `ctx.session.id` – split buckets, don't share one.
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

Exports: `guardTool`, `guardToolNode`, `langgraphAgentContext`. There is no unversioned `@arcjet/guard/langgraph` alias. This is LangGraph Graph API (`StateGraph` + `ToolNode` from `@langchain/langgraph/prebuilt`). It is not LangChain `createAgent` / `wrapToolCall` — that is `@arcjet/guard/langchain/v1` (docs https://docs.arcjet.com/guards/langchain-js/). It is not Python LangChain (docs https://docs.arcjet.com/guards/langchain/). Do not build on `createReactAgent` (deprecated in LangGraph JS v1).

- **`guardTool`** wraps a LangChain `tool()` / `StructuredTool` so `func` / `invoke` never runs on `DENY`. Return the shared `ArcjetDenialResult` – do not throw (that drops the fields). `ToolNode` wraps that object into a real `ToolMessage` whose `status` is `success`. Do not fabricate a `ToolMessage` to force `status: "error"` (crashes the reducer).
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

### LangChain JS createAgent

Exports: `guardTool`, `guardMiddleware`, `langchainContext`. There is no unversioned `@arcjet/guard/langchain` alias. This is JS `createAgent` + `createMiddleware({ wrapToolCall })` from the `langchain` package. It is not LangGraph Graph API (`StateGraph` + `ToolNode` — `@arcjet/guard/langgraph/v1`, docs https://docs.arcjet.com/guards/langgraph/). It is not Python LangChain (`arcjet.guard.langchain`, docs https://docs.arcjet.com/guards/langchain/). Until-published: published `@arcjet/guard@1.10.0` does not export `./langchain/v1` (`ERR_PACKAGE_PATH_NOT_EXPORTED`). Pin `@arcjet/guard` to git SHA `c49abcc1f9afce7d284b6c294d0dcee5916ada86` ([#6248](https://github.com/arcjet/arcjet-js/pull/6248)). Optional peers `langchain` `>=1.2.0 <2` and `@langchain/core` `>=1 <2`. No `@langchain/langgraph` peer.

Three gotchas first:

1. **Screen inbound before `agent.invoke`.** There is no `guardInbound`. Call `arcjet.guard()` in the application and **act on the decision**. Core `guard()` fails open: `ALLOW` is not proof the rules ran. Gate on `decision.hasFailedOpen()` if this call site must fail closed; `guardTool` / `guardMiddleware` already default to that. `wrapModelCall` / `beforeModel` / `afterModel` intercept the model call, not user text — they are not this policy gate.
2. **`humanInTheLoopMiddleware` is not a policy gate.** `humanInTheLoopMiddleware` / `interruptOn` / `interrupt()` is human-in-the-loop. Same trap as Mastra `requireApproval`, Claude `canUseTool`, LangGraph `interrupt()`, OpenAI Agents `needsApproval`, and Genkit `interrupt()`. There is no `guardApproval`.
3. **Deny inside `guardTool` and `guardMiddleware`'s `wrapToolCall`.** Policy sits on `wrapToolCall` only — do not deny in `afterModel`. `createAgent` runs authored tools through the tool object and everything else through middleware `createMiddleware({ wrapToolCall })`. MCP / runtime-discovered / unwrapped tools skip `guardTool`. `guardMiddleware` is the agent-wide gate for those. Do not also wrap with `@arcjet/guard/langgraph/v1` (`guardToolNode` is Graph API). Do not build on `createReactAgent`. Server-side provider tools and headless `.implement()` tools are out of scope.

- **`guardTool`** wraps a LangChain `tool()` / `StructuredTool` so `func` / `invoke` never runs on `DENY`. Denial is a plain `ArcjetDenialResult` — this helper does not throw and does not fabricate a `ToolMessage`. `createAgent`'s `baseHandler` wraps a non-ToolMessage in a success `ToolMessage`. Distinct from LangGraph Graph API, where `ToolNode` wraps the same plain object (`status: "success"`); do not fabricate `status: "error"` there, and do not use that adapter here.
- **`guardMiddleware`** is `createMiddleware({ wrapToolCall })` for `createAgent({ middleware })`. A `wrapToolCall` short-circuit returns a real `ToolMessage` (`content` = JSON of the payload, default status) without calling the inner handler. A bare object from `wrapToolCall` is the reducer-crash case. Do not throw (that drops the fields) and do not set `status: "error"`. Already-branded (`guardTool`) tools skip the middleware guard so Guard is not called twice.
- **`langchainContext`** preference: `configurable.thread_id` (what `wrapToolCall` sees on `runtime.configurable` as of langchain 1.2.34), then caller-owned `sessionId` / `conversationId`. It never mints an id. It never reads `traceId`. A resumed run keeps its `thread_id` because `humanInTheLoopMiddleware` resumes with `agent.invoke(new Command({ resume }), config)` — same config, same Sequence. The interrupt and its resume value are not correlation sources; do not derive an id from that payload. Do not call `createAgentContext` inside a `createAgent` callback.
- Fail closed by default (`onGuardError: "deny"`). Node.js 22+. Do not also wrap with `@arcjet/guard/vercel-ai/v7`. Use `guardTool` / `guardMiddleware` / `langchainContext` only — not `guardInbound`, `guardApproval`, `guardToolNode`, `guardHooks`, `createAgentContext`, or `aiToolsContext`. Docs: https://docs.arcjet.com/guards/langchain-js/.

```typescript
import { launchArcjet, detectPromptInjection, tokenBucket } from "@arcjet/guard";
import { guardTool, guardMiddleware, langchainContext } from "@arcjet/guard/langchain/v1";
import { createAgent } from "langchain";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

const arcjet = launchArcjet({ key: process.env.ARCJET_KEY! });
const lookupLimit = tokenBucket({
  bucket: "lookups",
  refillRate: 10,
  intervalSeconds: 60,
  maxTokens: 10,
});
const mcpLimit = tokenBucket({
  bucket: "mcp-access",
  refillRate: 20,
  intervalSeconds: 60,
  maxTokens: 20,
});
// The authenticated caller, so a budget cannot be reset by varying the order id.
const userId = authenticatedUserId;

const lookupOrder = guardTool(
  arcjet,
  tool(async ({ orderId }) => ({ orderId, status: "shipped" }), {
    name: "lookup_order",
    description: "Look up an order by ID",
    schema: z.object({
      orderId: z.string(),
    }),
  }),
  {
    action: "order.looked-up",
    // Keyed on the authenticated caller, not the model-supplied order id.
    rules: () => [lookupLimit({ key: userId, requested: 1 })],
  },
);

const inbound = detectPromptInjection();
const decision = await arcjet.guard({
  label: "message.received",
  rules: [inbound(userText)],
  ...langchainContext({ configurable: { thread_id: conversationId } }),
});
if (decision.conclusion === "DENY") {
  throw new Error("message blocked");
}
// `guard()` fails open, so an ALLOW is not proof the rules ran. Gate
// on `hasFailedOpen()` when this inbound site must fail closed. Omitting
// that gate is legitimate if an outage must not stop the agent.
if (decision.hasFailedOpen()) {
  throw new Error("inbound guard unavailable");
}

const mcpTools = []; // from an MCP client you did not wrap with guardTool
const agent = createAgent({
  model: "openai:gpt-4o",
  tools: [lookupOrder, ...mcpTools],
  // The createAgent-wide gate for the tools above that guardTool did not wrap.
  // Already-branded tools are skipped, so Guard is not called twice.
  // wrapToolCall short-circuit returns a real ToolMessage — not a bare object.
  middleware: [
    guardMiddleware(arcjet, {
      action: ({ toolName }) => `${toolName}.invoked`,
      rules: ({ toolName }) => [mcpLimit({ key: toolName, requested: 1 })],
      sessionId: conversationId,
    }),
  ],
});

await agent.invoke(
  { messages: [{ role: "user", content: userText }] },
  { configurable: { thread_id: conversationId } },
);
```

### OpenAI Agents

Exports: `guardTool`, `openaiAgentsContext`. There is no unversioned `@arcjet/guard/openai-agents` alias. This is text `Agent` + `run()` / `Runner` + authored `tool({ execute })`. Not Realtime, not Sandbox, not hosted tools, not computer / shell / apply_patch, not MCP, not `agent.asTool()`. Pinned to arcjet-js merge `0099fb76` ([#6233](https://github.com/arcjet/arcjet-js/pull/6233)).

Three gotchas first:

1. **Screen inbound before `run()`.** There is no `guardInbound`. SDK `inputGuardrails` / `outputGuardrails` / `defineToolInputGuardrail` / `defineToolOutputGuardrail` are the SDK's own tripwires, not Arcjet. Call `arcjet.guard()` in the application and **act on the decision**. Core `guard()` fails open: `ALLOW` is not proof the rules ran. Gate on `decision.hasFailedOpen()` if this call site must fail closed; `guardTool` already defaults to that.
2. **`needsApproval` is not a policy gate.** `needsApproval` / `requireApproval` / `onApproval` is human-in-the-loop (`result.state.approve` / `reject`). Same trap as Mastra `requireApproval`, Claude `canUseTool`, and LangGraph `interrupt()`. There is no `guardApproval`.
3. **Deny is inside `tool({ execute })`.** After `tool()` the object is a `FunctionTool`; the runner calls `invoke`. Hosted tools, handoffs, computer / shell / apply_patch, and MCP (`mcpServers` → `mcpToFunctionTool`) skip that authored-`execute` path. `agent_tool_start` / `agent_tool_end` are void observe-only hooks. There is no `guardHooks` and no `guardToolNode`.

- **`guardTool`** wraps `FunctionTool.invoke` so the closed-over `execute` never runs on `DENY`. Return the shared `ArcjetDenialResult` (`{ arcjetDenied: true, … }`) on a `function_call_result` with `status: "completed"`. A throw hits `errorFunction` or `ToolCallError` and drops the fields. `timeoutMs` races the guard round trip as well as `execute`, so leave headroom; `outputGuardrails` / `customDataExtractor` receive the denial object and must not assume the tool's own shape. `guardTool` warns if `invoke` is handed neither a string nor an object (rules would silently see `{}`).
- **`openaiAgentsContext`** preference: `context.correlationId` → `sessionId` → `conversationId` → `groupId`, then envelope copies (`conversationId`, `groupId`, already-resolved `sessionId`). It never mints an id. It never reads `traceId` (the SDK mints one when omitted). It never calls `session.getSessionId()` (`MemorySession` mints a UUID when constructed without `sessionId`). Do not call `createAgentContext` inside a run callback.
- Fail closed by default (`onGuardError: "deny"`). Optional peer `@openai/agents` `>=0.17.0 <1`. Zod is their peer, not ours. Node.js 22+. Do not also wrap with `@arcjet/guard/vercel-ai/v7`.

```typescript
import { launchArcjet, detectPromptInjection, tokenBucket } from "@arcjet/guard";
import { guardTool, openaiAgentsContext } from "@arcjet/guard/openai-agents/v0";
import { Agent, run, tool } from "@openai/agents";
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

const lookupOrder = guardTool(
  arcjet,
  tool({
    name: "lookup_order",
    description: "Look up an order by number",
    parameters: z.object({ orderNumber: z.string() }),
    execute: async ({ orderNumber }) => ({ orderNumber, status: "shipped" }),
  }),
  {
    action: "order.looked-up",
    rules: () => [lookupLimit({ key: userId, requested: 1 })],
  },
);

const agent = new Agent({
  name: "support-agent",
  instructions: "Help the user.",
  tools: [lookupOrder],
});

const appContext = { sessionId: conversationId };
const inbound = detectPromptInjection();
const decision = await arcjet.guard({
  label: "message.received",
  rules: [inbound(userText)],
  ...openaiAgentsContext({ context: appContext, conversationId }),
});
if (decision.conclusion === "DENY") {
  throw new Error("message blocked");
}
// `guard()` fails open, so an ALLOW is not proof the rules ran. Gate
// on `hasFailedOpen()` when this inbound site must fail closed. Omitting
// that gate is legitimate if an outage must not stop the agent.
if (decision.hasFailedOpen()) {
  throw new Error("inbound guard unavailable");
}

await run(agent, userText, { context: appContext });
```

### Genkit

Exports: `guardTool`, `guardMiddleware`, `genkitContext`. There is no unversioned `@arcjet/guard/genkit` alias. This is JS `genkit()` + `ai.defineTool` + `ai.generate`. Not Go / Python Genkit. Pinned to arcjet-js merge `4e416787` ([#6243](https://github.com/arcjet/arcjet-js/pull/6243)). Published `@arcjet/guard@1.10.0` does not export `./genkit/v1` (`ERR_PACKAGE_PATH_NOT_EXPORTED`). Once it ships, the packaged skill is `node_modules/@arcjet/guard/skills/integrate-arcjet-guard-genkit`.

Three gotchas first:

1. **Screen inbound before `generate()` / `chat.send()`.** There is no `guardInbound`. The middleware `model` hook intercepts the model call, not user text — it is not this policy gate. Call `arcjet.guard()` in the application and **act on the decision**. Core `guard()` fails open: `ALLOW` is not proof the rules ran. Gate on `decision.hasFailedOpen()` if this call site must fail closed; `guardTool` / `guardMiddleware` already default to that.
2. **`interrupt()` is not a policy gate.** `interrupt()` / `defineInterrupt` / `@genkit-ai/middleware` `toolApproval` / `restartTool` / `finishReason === "interrupted"` is human-in-the-loop (`restartTool` / `respond`). Same trap as Mastra `requireApproval`, Claude `canUseTool`, LangGraph `interrupt()`, and OpenAI Agents `needsApproval`. There is no `guardApproval`.
3. **Deny inside `defineTool` and `guardMiddleware`'s `tool` hook.** After `defineTool` the object is a `ToolAction`; `generate()` calls it as a function. Filesystem middleware tools, MCP tools, and anything not wrapped with `guardTool` skip that handler. `guardMiddleware` is the generate()-wide gate for those. `returnToolRequests: true` means the app calls the tool itself — `guardTool` still gates that; `guardMiddleware` does not run if they never `generate()` the tool.

- **`guardTool`** wraps the `ToolAction` from `ai.defineTool` so the closed-over handler never runs on `DENY`. Return the shared `ArcjetDenialResult` as completed `toolResponse.output`. Do not throw. Do not call `interrupt()`. Do not throw `ToolInterruptError`. Wrap the returned `ToolAction` (the callable `generate()` invokes), not the inner handler — wrapping outside `action()` keeps a denial off `outputSchema` validation. `generate()` discards the action objects and re-resolves by name, so `guardTool` also replaces the registry entries. It throws if it cannot replace one (a frozen store would otherwise run the unguarded original with no signal).
- **`guardMiddleware`** is a `generate({ use })` middleware whose `tool` hook denies by returning a completed `ToolResponsePart` without calling `next()`. Already-branded (`guardTool`) actions skip the middleware guard when they can be looked up. Pass a **plain object `{ name, instantiate }`** — a raw function becomes a *model* hook only. Names get a random suffix so two instances do not collide (`normalizeMiddleware` keeps the first registration under a given name). Requires the `generateMiddleware` `tool` hook (Genkit >= 1.33).
- **`genkitContext`** preference: `context.correlationId` → `sessionId` → `conversationId` → a caller-owned `flowId` / `runId`, then envelope copies. It never mints an id. It never reads `traceId`. It never treats `interrupt` / `resumed` as correlation. Do not call `createAgentContext` inside a generate / tool callback. Do not read `Session.sessionId` from a Session constructed without an id (that class mints a UUID). Put the same id on `generate({ context })` *and* on `guardMiddleware({ sessionId })` — the tool hook from `toRunOptions` is only `{ metadata, resumed }` (no ALS context).
- Fail closed by default (`onGuardError: "deny"`). Optional peer `genkit` `>=1.0.0 <2`. Zod is theirs, not ours. Node.js 22+. Do not also wrap with `@arcjet/guard/vercel-ai/v7`. Use `guardTool` / `guardMiddleware` / `genkitContext` only — not `guardInbound`, `guardApproval`, `guardAction`, `createAgentContext`, or `aiToolsContext`.

```typescript
import { launchArcjet, detectPromptInjection, tokenBucket } from "@arcjet/guard";
import { guardTool, guardMiddleware, genkitContext } from "@arcjet/guard/genkit/v1";
import { genkit, z } from "genkit";

const ai = genkit({ /* plugins, default model */ });
const arcjet = launchArcjet({ key: process.env.ARCJET_KEY! });
const lookupLimit = tokenBucket({
  bucket: "lookups",
  refillRate: 10,
  intervalSeconds: 60,
  maxTokens: 10,
});
const mcpLimit = tokenBucket({
  bucket: "mcp-access",
  refillRate: 20,
  intervalSeconds: 60,
  maxTokens: 20,
});
// The authenticated caller, so a budget cannot be reset by varying the order id.
const userId = authenticatedUserId; // from your auth layer

const lookupOrder = guardTool(
  arcjet,
  ai.defineTool(
    {
      name: "lookup_order",
      description: "Look up an order by number",
      inputSchema: z.object({ orderNumber: z.string() }),
    },
    async ({ orderNumber }) => ({ orderNumber, status: "shipped" }),
  ),
  {
    action: "order.looked-up",
    // Keyed on the authenticated caller, not the model-supplied order id.
    rules: () => [lookupLimit({ key: userId, requested: 1 })],
  },
);

const appContext = { sessionId: conversationId };
const inbound = detectPromptInjection();
const decision = await arcjet.guard({
  label: "message.received",
  rules: [inbound(userText)],
  ...genkitContext({ context: appContext }),
});
if (decision.conclusion === "DENY") {
  throw new Error("message blocked");
}
// `guard()` fails open, so an ALLOW is not proof the rules ran. Gate
// on `hasFailedOpen()` when this inbound site must fail closed. Omitting
// that gate is legitimate if an outage must not stop the agent.
if (decision.hasFailedOpen()) {
  throw new Error("inbound guard unavailable");
}

const mcpTools = []; // from an MCP client you did not wrap with guardTool
await ai.generate({
  prompt: userText,
  tools: [lookupOrder, ...mcpTools],
  use: [
    guardMiddleware(arcjet, {
      action: ({ toolName }) => `${toolName}.invoked`,
      rules: ({ toolName }) => [mcpLimit({ key: toolName, requested: 1 })],
      sessionId: conversationId,
    }),
  ],
  context: appContext,
});
```

See https://docs.arcjet.com/guards/framework-integrations/, https://docs.arcjet.com/guards/claude-agent-sdk/, https://docs.arcjet.com/guards/vercel-eve/, https://docs.arcjet.com/guards/mastra/, https://docs.arcjet.com/guards/langgraph/, https://docs.arcjet.com/guards/langchain-js/, https://docs.arcjet.com/guards/langchain/, and https://docs.arcjet.com/guards/genkit/.

## Key patterns

- An empty `rules` array still calls `guard()` / the Decide API. `rules: []` is a real decision, not a no-op skip.
- Pass `signal` (an `AbortSignal`) on the `.guard()` call when one is available (from the caller or a timeout) so Guard respects cancellation. `timeoutSeconds` is also available for a deadline.
- Use `metadata` for analytics/auditing context – nested JSON, not a flat string map. It appears in the Console and does not affect the decision. Do not put secrets or PII in it.
- The `label` string must identify the operation (`"tools.get-weather"`, `"mcp.query-database"`) – it appears in the Console and groups which operations are being rate limited or blocked.
- AI SDK: pass `toolsContext: aiToolsContext(ctx, tools)` so tool decisions correlate with the turn. Omitting it leaves correlation empty.
