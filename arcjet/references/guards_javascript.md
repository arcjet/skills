# JavaScript/TypeScript Guard

## Contents

- [What Guard is](#what-guard-is)
- [Installation](#installation)
- [Architecture: why things go where they do](#architecture-why-things-go-where-they-do)
- [Choose a rate limit strategy](#choose-a-rate-limit-strategy)
- [Content scanning rules](#content-scanning-rules)
- [Common mistakes](#common-mistakes)
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

Requires `@arcjet/guard` ≥ 1.4.0 for basic Guard protection. Features called out as 1.6.0 still apply. Capture, registration, Rampart, nested metadata, and threat/billing require **`@arcjet/guard` 1.10.0**. Adapters listed as shipped in 1.11.0 remain available from 1.11.0 onward. Google ADK, TanStack AI, and Claude Managed Agents require **1.12.0**. Uppercase labels need **1.14.1**. Claude Agent SDK result screening and an importable `validateGuardLabel` / `ArcjetInvalidLabelError` need **1.15.0** (in 1.13.0–1.14.1 both are `undefined` at runtime on Node, Deno, and Bun). Runtime minimums match the Arcjet JS SDK line:

| Runtime            | Minimum version          |
| ------------------ | ------------------------ |
| Node.js            | `>=22.21.0 <23 \|\| >=24.5.0` |
| Bun                | 1.3.0                    |
| Deno               | `stable` / `lts`         |
| Cloudflare Workers | compat date `2025-09-01` |

The correct transport is picked automatically via conditional exports (HTTP/2 on Node and Bun, fetch-based on Deno and Workers) – import from `@arcjet/guard` either way. If the project is on Node 20/21, Node 23, Node 24 below 24.5.0, or an older Bun/Workers compat date, warn the user and stop until the runtime is bumped.

Read the installed package's types and doc comments for the full API surface.

> _Runtime support last verified against the published `@arcjet/guard` **v1.15.0** on **November 11, 2026**. The twelve adapters are `vercel-ai/v7`, `vercel-eve/v0`, `mastra/v1`, `langgraph/v1`, `langchain/v1`, `claude-agent-sdk/v0`, `claude-managed-agents/v0`, `openai-agents/v0`, `genkit/v1`, `strands-agents/v1`, `google-adk/v2`, and `tanstack-ai/v0`; every one takes `actor` / `inputs`. Prompt-injection `threshold` / `score` are **removed**. Decide timeout defaults to 2000 ms. `cloudflare-think/v0` installs from published `@arcjet/guard` plus peer `@cloudflare/think` — load [integrate-arcjet-guard-cloudflare-think](../../integrate-arcjet-guard-cloudflare-think/SKILL.md). Do not pin a git SHA. Read the installed package's types. Minimums tend to creep upward – check the [Runtime support section](https://github.com/arcjet/arcjet-js/tree/main/arcjet-guard#runtime-support) of the README._

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

**Label naming rules:** labels are validated as slugs – **ASCII letters of either case, digits, dash (`-`), dot (`.`), and underscore (`_`)**, must start and end with a letter or digit, max 256 bytes. A label is matched case-sensitively, so `Order.looked-up` and `order.looked-up` are different labels. Uppercase letters need **`@arcjet/guard` 1.14.1**; earlier versions reject them. Forward slashes and spaces are rejected. Prefer dash/dot in new labels. Check a label you build yourself with `validateGuardLabel` (import it on 1.15.0+ only) — a slug the service will not match reads as `ALLOW` with `hasFailedOpen()` false.

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

Use `detectPromptInjection()` on any untrusted text before it reaches a model or is used as a tool argument. This catches jailbreaks, role-play escapes, and instruction overrides. Also useful on tool call *results* when the tool fetches content from untrusted sources. Max **128 KiB** per call: larger text is a LIVE DENY (`AJ1131`); split it. Empty text is an error (`AJ1130`).

### Sensitive information detection

Use `localDetectSensitiveInfo()` to block PII from entering or leaving the system (for example users sending credit card numbers, or tool outputs leaking email addresses). Always pass `backend: rampart()` – see [On-device Rampart backend](#on-device-rampart-backend). The scan runs on-device; the SDK reports each finding's entity type and position plus a SHA-256 hash of the text, never the matched text.

Without a backend only `"EMAIL"`, `"PHONE_NUMBER"`, `"IP_ADDRESS"`, `"CREDIT_CARD_NUMBER"` are detectable; `allow` / `deny` narrow to `NativeSensitiveInfoEntityType` so other types fail to compile.

The rule does **not** inherit the client's `sensitiveInfoBackend`. Pass `backend` on the rule. The client option only feeds the SDK-local sensitive-info detector in a remote policy – set it (sharing one Rampart instance) when a policy uses that kind. Guard has no `sensitiveInfo` export – that is the HTTP `protect()` rule.

PHI types (medical record number, health plan beneficiary number, VIN, licence plate, device identifier) are detected only by the **server-side** sensitive-info detector in a remote policy, which sends the raw value to Arcjet. A value over 2 KB can take up to 3 s there, so raise `timeoutSeconds` above 3 (default 2) or the call fails open first.

JavaScript `localDetectSensitiveInfo()` works with no arguments, but always pass an explicit `allow` or `deny` so the check matches Python and is greppable. There is no `guard({ sensitiveInfo })`.

### Content moderation

`moderateContent()` flags unsafe or policy-violating text for Guard call sites (not available on `protect()`). The result is `{ detected, billing? }` – `billing.unit` is `text_units` when present. Graduated in **1.11.0**; `experimental_moderateContent` remains a deprecated alias. `decision.reason` is `"MODERATE_CONTENT"` on deny. Only the first **60 KB** is evaluated (warning `AJ1142`); over 128 KiB is a LIVE DENY (`AJ1141`). Use separate labels for input and output (`chat.input` / `chat.output`). Don't copy the checked text into `metadata`.

For moderation and prompt injection, gate on `decision.conclusion === "DENY" || decision.hasFailedOpen()`. Don't gate on `reason === "MODERATE_CONTENT"` alone – a timeout or overload (`AJ1995` / `AJ1996`) then lets unchecked text through.

### Common mistakes

These produce code that runs without error and enforces nothing. Full list: https://docs.arcjet.com/llms.txt.

- Pass `allow` or `deny` and `backend` on every local sensitive-info rule.
- Remote policy inputs: import `policyInput` from `@arcjet/guard` (not an adapter path) and pass `policyInput.server` / `policyInput.local` on core `guard()` and every wrapper. Generate the call from the policy in the Console so names match. A missing **required** input (`AJP1003`) or actor (`AJP1002`) makes `policyEvaluation.status` `"INCOMPLETE"`: wrappers deny, core `guard()` returns ALLOW with `hasFailedOpen()` true. An input the policy doesn't declare is dropped with warning `AJ1060`. Take `actor` from authenticated server context, never from a model-produced tool argument.
- Limits: 64 inputs per call; about 100 KB per server string; 256 items and about 100 KB per list (quotes, backslashes, newlines count extra). Over any limit, every live rule fails closed (`AJP1003`). At most 50 rules per `guard()`; the rest are `NOT_RUN` (`AJ1003`). Empty text to a detector is allowed unscreened (`AJ1062`).
- Wrapper callbacks `rules`, `metadata`, `action`, `sessionId` must be **synchronous**; a Promise counts as a failure. `actor` / `inputs` may be async. A callback that throws or returns an unusable value does not skip Guard: it is called without that value (no local rules, default label such as `tool.invoked`), a remote DENY stands, and otherwise `onGuardError` decides (`"deny"` default blocks).
- Warnings (`AJ1060`, `AJ1062`, `AJ1142`, `AJ1003`) reach only the SDK – the Console doesn't show them. Log `decision.warnings`.
- On Genkit, OpenAI Agents, and Strands Agents, `guardTool` cannot infer `TInput` – annotate `rules: (input: { … }) => …`.
- A missing decision is not a denial. Verify in Console/CLI.
- Adapter-specific isolation / session / correlation traps live in that adapter file. Do not copy them from a sibling.

### On-device Rampart backend

Install `@arcjet/sensitive-info-rampart` and pass `backend: rampart()`. `rampartEntities` is the full type list. Custom patterns: `rampart({ recognizers: [...defaultRecognizers, fn] })`. Rampart's bundled loader needs Node/Bun/Deno with filesystem access – on Workers pass your own `rampart({ classify })`. Next.js: add `@arcjet/sensitive-info-rampart`, `@huggingface/transformers`, `onnxruntime-node` to `serverExternalPackages`. `rampart({ maxInputChars })` defaults to 100,000 UTF-16 code units and must be a positive safe integer. Over the limit, the rule returns DENY with no detected entities, without scanning – a `LOCAL` policy input is denied the same way; in `DRY_RUN` the denial is recorded, not enforced. For longer text or PHI, send a `SERVER` input to the server-side detector (~100 KB per value, at most two values over 2 KB per call – split longer text across calls).

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

`decision.reason` is a flat string when `conclusion === "DENY"` – one of `"RATE_LIMIT"`, `"PROMPT_INJECTION"`, `"SENSITIVE_INFO"`, `"MODERATE_CONTENT"`, `"INPUT_CONSTRAINT"`, `"IP_THREAT"`, `"CUSTOM"`, `"ERROR"`, `"NOT_RUN"`, `"UNKNOWN"`. (On ALLOW it's `undefined`.) Remote policy outcomes are on `decision.policyResults` (per policy rule) and `decision.policyEvaluation.status` (`"NOT_CONFIGURED"` = no published policy for the label, `"APPLIED"`, `"INCOMPLETE"`, `"UNAVAILABLE"`, `"UNKNOWN"`). Prompt-injection and content-moderation results may include optional `billing` (`{ unit, count }` as bigint). Prompt injection uses `tokens`; moderation uses `text_units`. Read the types on the decision object for the full structure.

### Errors vs warnings (failing open)

`guard()` never throws for runtime degradation – a transport failure or a rule that couldn't be processed comes back as a fail-open `"ALLOW"` decision, not an exception. Two distinct signals (available from **`@arcjet/guard` 1.6.0**) tell you what happened:

- `decision.hasFailedOpen()` – `true` when the decision is `"ALLOW"` *only* because a rule or the decision itself could not be processed. This is the **fail-closed gate**: if the operation is sensitive enough that a degraded Arcjet signal must block rather than allow, branch on this and deny. `decision.errorResults()` returns the errored results (each with a `code`/`message`) for logging.
- `decision.warnings` – request-validation diagnostics (for example an invalid metadata key that was stripped). The decision is still valid and trustworthy; warnings never change the conclusion. Log them so the config gets fixed, but don't block on them.

To attribute a failure to a *specific* rule rather than scanning the whole decision, each rule also exposes `.errorResult(decision)` (added in **`@arcjet/guard` 1.6.0**) – the mirror of `.deniedResult(decision)`. It returns that rule's `RuleResultError` (with `code`/`message`) if that rule errored, else `null`. Use it when only one rule failing open is actually unsafe (for example the prompt-injection scan) while others failing open is tolerable.

```typescript
const decision = await arcjet.guard({ label: "tools.get-weather", rules });
if (decision.hasFailedOpen()) {
  // Arcjet couldn't fully evaluate. Deny when a content scan protects the op.
  console.error("guard failed open", decision.errorResults());
  throw new Error("Service unavailable");
}
for (const w of decision.warnings) console.warn(`${w.code}: ${w.message}`);
```

On `@arcjet/guard` ≤ 1.5.0 the only signal is `decision.hasError()`, which is **deprecated** from 1.6.0 (it conflated request diagnostics with rule errors). Check the installed package's types – if `hasFailedOpen` exists, prefer it over `hasError()`.

### Correlation IDs

Available from **`@arcjet/guard` 1.6.0**: pass `correlationId` to `.guard()` to correlate a guard decision with a request, workflow run, or agent trace. It is a dedicated field, not metadata, and it does not affect the decision. A Console Sequence is built from **capture events** sharing a correlation ID; decisions alone don't form one.

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

Import the **versioned** path. Unversioned aliases (`@arcjet/guard/vercel-ai`, `/mastra`, `/cloudflare-think`, …) do not resolve. Wrappers fail closed by default (`onGuardError: "deny"`). Core `guard()` fails open.

Load **fundamentals here, then exactly one adapter**. Do not open sibling adapters. Adapters in `guards_js_*.md` are one file each; Cloudflare Think is a dedicated skill. This table is the source of truth — `SKILL.md` links here instead of copying it.

| Adapter | Import | Load |
| --- | --- | --- |
| Vercel AI SDK v7 | `@arcjet/guard/vercel-ai/v7` | [guards_js_vercel_ai.md](guards_js_vercel_ai.md) |
| Vercel Eve v0 | `@arcjet/guard/vercel-eve/v0` | [guards_js_vercel_eve.md](guards_js_vercel_eve.md) |
| Mastra v1 | `@arcjet/guard/mastra/v1` | [guards_js_mastra.md](guards_js_mastra.md) |
| LangChain `createAgent` v1 | `@arcjet/guard/langchain/v1` | [guards_js_langchain.md](guards_js_langchain.md) |
| LangGraph v1 | `@arcjet/guard/langgraph/v1` | [guards_js_langgraph.md](guards_js_langgraph.md) |
| OpenAI Agents v0 | `@arcjet/guard/openai-agents/v0` | [guards_js_openai_agents.md](guards_js_openai_agents.md) |
| Genkit v1 | `@arcjet/guard/genkit/v1` | [guards_js_genkit.md](guards_js_genkit.md) |
| Claude Agent SDK v0 | `@arcjet/guard/claude-agent-sdk/v0` | [guards_js_claude_agent_sdk.md](guards_js_claude_agent_sdk.md) |
| Strands Agents v1 | `@arcjet/guard/strands-agents/v1` | [guards_js_strands_agents.md](guards_js_strands_agents.md) |
| Google ADK v2 | `@arcjet/guard/google-adk/v2` | [guards_js_google_adk.md](guards_js_google_adk.md) |
| TanStack AI v0 | `@arcjet/guard/tanstack-ai/v0` | [guards_js_tanstack_ai.md](guards_js_tanstack_ai.md) |
| Claude Managed Agents v0 | `@arcjet/guard/claude-managed-agents/v0` | [guards_js_claude_managed_agents.md](guards_js_claude_managed_agents.md) |
| Cloudflare Think v0 | `@arcjet/guard/cloudflare-think/v0` | Published `@arcjet/guard` (`npm install` / `pnpm add`) plus peer `@cloudflare/think` `>=0.3.0 <1`. Docs https://docs.arcjet.com/guards/cloudflare-think/. Load [integrate-arcjet-guard-cloudflare-think](../../integrate-arcjet-guard-cloudflare-think/SKILL.md) for the peer, deny envelope, fail-closed, no ID minting, HITL, and `actor` / `inputs` + `policyInput`. |

Docs are the merged pages at https://docs.arcjet.com/guards/<adapter>/. Language-specific `*-js` / `*-py` URLs redirect there. JS adapters also ship `integrate-arcjet-guard-*` skills under `node_modules/@arcjet/guard/skills/` — this repo does not duplicate those. Cloudflare Think is a dedicated skill here instead of a `guards_js_*.md` file.

### Denial responses

Every JS adapter uses one payload — `ArcjetDenialResult` (`{ arcjetDenied, reason, message, retryable, retryAfterSeconds? }`). The **envelope** is per-framework. Read the adapter file before inventing a status or throwing. Canonical table: the [Denial responses](https://github.com/arcjet/arcjet-js/blob/main/arcjet-guard/README.md) section of the Guard README.


`guardTool` and `guardAction` are different handlers. A model-facing `onDeny` must return an envelope the model can inspect; `guardAction` throws `ArcjetDeniedError` so application code can `catch`. Sharing one callback would either leak a throw into the tool loop or swallow a policy denial as a successful action.

## Key patterns

- An empty `rules` array still calls `guard()` / the Decide API. `rules: []` is a real decision, not a no-op skip.
- Pass `signal` (an `AbortSignal`) on the `.guard()` call when one is available (from the caller or a timeout) so Guard respects cancellation. `timeoutSeconds` is also available for a deadline.
- Use `metadata` for analytics/auditing context – nested JSON, not a flat string map. It appears in the Console and does not affect the decision. Do not put secrets or PII in it.
- The `label` string must identify the operation (`"tools.get-weather"`, `"mcp.query-database"`) – it appears in the Console and groups which operations are being rate limited or blocked.
