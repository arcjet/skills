# JavaScript/TypeScript Guard

## What Guard Is

Guard protects code paths that don't have an HTTP request — tool calls, agent loops, MCP handlers, queue consumers, background jobs. It's a separate SDK (`@arcjet/guard`) from the HTTP request SDKs (`@arcjet/node`, `@arcjet/next`, etc.) because there's no request object to inspect. Instead, you pass explicit context (labels, keys, text to scan) at each call site.

## Installation

Install with whichever package manager the project already uses (`npm install`, `pnpm add`, `yarn add`, `bun add`) — don't hand-edit `package.json`:

```bash
npm install @arcjet/guard
```

Requires `@arcjet/guard` >= 1.4.0. Read the installed package's types and doc comments for the full API surface.

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
// WORKS but awkward — no stable reference for result inspection
function handleTool() {
  const limit = tokenBucket({ ... }); // hard to call limit.deniedResult() later
}

// BETTER — declare rules at module scope, dynamically choose which to apply
const adminLimit = tokenBucket({ label: "admin.tool_calls", bucket: "admin-tools", maxTokens: 1000, ... });
const memberLimit = tokenBucket({ label: "member.tool_calls", bucket: "member-tools", maxTokens: 100, ... });

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
    label: "tools.get_weather",
    rules: [toolCallLimit({ key: userId, requested: 1 })],
    metadata: { userId },
  });
  if (decision.conclusion === "DENY") throw fromDecision(decision);
  // ...do the work
}

// Option B: guard at the dispatch site, right before calling the tool
switch (toolName) {
  case "get_weather": {
    const decision = await arcjet.guard({
      label: "tools.get_weather",
      rules: [toolCallLimit({ key: userId, requested: 1 })],
      metadata: { userId },
    });
    if (decision.conclusion === "DENY") throw fromDecision(decision);
    return getWeather(args.city);
  }
  // ...
}

// Avoid: generic dispatcher with interpolated label
async function handleToolCall(name: string, args: Record<string, unknown>, userId: string) {
  const decision = await arcjet.guard({ label: `tools.${name}`, rules: [...] }); // 👎
}
```

The `label` should be a hardcoded string — `"tools.get_weather"`, not `` `tools.${name}` ``. Hardcoded labels stay greppable, and the dashboard groups by them; interpolation produces a sea of distinct-looking calls instead of one bucket per operation.

Pass `metadata` whenever you have useful auditing context (`{ userId, requestId }`) — it shows up in the dashboard alongside the decision and makes debugging much easier later.

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

Use `localDetectSensitiveInfo()` to block PII from entering or leaving the system (e.g. users sending credit card numbers, or tool outputs leaking email addresses). The scan runs locally via WASM — raw text never leaves the SDK, which matters for compliance.

## Decision Handling

`decision.conclusion` is either `"ALLOW"` or `"DENY"`. Always check before proceeding.

For useful error messages, branch on **which rule** denied — not just on `DENY`. Each rule defined at module scope exposes a `.deniedResult(decision)` accessor that returns rule-specific info (e.g. `resetInSeconds` for rate limits). Use this to give the caller something actionable:

```typescript
if (decision.conclusion === "DENY") {
  const rateLimited = toolCallLimit.deniedResult(decision);
  if (rateLimited) {
    throw new ToolBlocked(`rate limited — retry in ${rateLimited.resetInSeconds}s`);
  }
  if (decision.reason.isPromptInjection()) {
    throw new ToolBlocked("input flagged as prompt injection");
  }
  throw new ToolBlocked("blocked");
}
```

Read the types on the decision object for the full structure.

`decision.hasError()` means something went wrong during rule evaluation (service unreachable, rule execution failure, etc.) but the SDK failed open. Log it but don't block the user.

## Key Patterns

- Pass `abortSignal` when one is available (e.g. from the caller or a timeout) so guard respects cancellation.
- Use `metadata` for analytics/auditing context (user ID, session, etc.) — this appears in the dashboard.
- The `label` string should identify the operation (e.g. `"tools.get_weather"`, `"mcp.query_database"`) — it appears in the dashboard and helps you understand which operations are being rate limited or blocked.
