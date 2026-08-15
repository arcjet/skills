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

> _Runtime support last verified against the published `@arcjet/guard` **v1.10.0** on **2026-08-11**. `moderateContent` (graduated name) and `@arcjet/guard/mastra/v1` are on current docs and `main`; they are not in 1.10.0 (the next release line is unpublished). Read the installed package's types before using either. Minimums tend to creep upward — check the [Runtime support section](https://github.com/arcjet/arcjet-js/tree/main/arcjet-guard#runtime-support) of the current README._

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

Import the versioned path. Unversioned aliases (`@arcjet/guard/vercel-ai`, `/vercel-eve`, `/mastra`) do not resolve. Wrappers fail closed by default (`onGuardError: "deny"`).

| Integration | Import | Use when |
| --- | --- | --- |
| Vercel AI SDK v7 | `@arcjet/guard/vercel-ai/v7` | Authored `tool({ execute })`. `guardTool` + `aiToolsContext(createAgentContext(), tools)`. Also exports `guardAction`, `captureAction`, `securityMetadata`. Wrapped tools cannot already declare `contextSchema`. |
| Vercel Eve v0 | `@arcjet/guard/vercel-eve/v0` | Eve agents. `guardInbound` on channels (only place to decline a turn before it starts). `guardApproval` on OpenAPI/MCP connections (no local `execute`). `arcjetHooks` is observe-only. Eve needs Node ≥ 24. |
| Mastra v1 | `@arcjet/guard/mastra/v1` | On current docs/`main`, not published 1.10.0. `guardProcessor` for inbound/outbound text (no `guardInbound`). `guardTool` for authored tools. `guardHooks` for unwrapped MCP/workspace tools (`beforeToolCall` can deny). No `guardApproval` — Mastra `requireApproval` is human HITL. Do not also wrap with `vercel-ai/v7`. |

See https://docs.arcjet.com/guards/framework-integrations/, https://docs.arcjet.com/guards/vercel-eve/, and https://docs.arcjet.com/guards/mastra/.

## Key Patterns

- Pass `signal` (an `AbortSignal`) on the `.guard()` call when one is available (e.g. from the caller or a timeout) so guard respects cancellation. `timeoutSeconds` is also available for a simple deadline.
- Use `metadata` for analytics/auditing context — nested JSON, not a flat string map. It appears in the Console and does not affect the decision. Do not put secrets or PII in it.
- The `label` string should identify the operation (e.g. `"tools.get-weather"`, `"mcp.query-database"`) — it appears in the Console and helps you understand which operations are being rate limited or blocked.
