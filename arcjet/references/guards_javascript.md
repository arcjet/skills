# JavaScript/TypeScript Guard

## What Guard Is

Guard protects code paths that don't have an HTTP request — tool calls, agent loops, MCP handlers, queue consumers, background jobs. It's a separate SDK (`@arcjet/guard`) from the HTTP request SDKs (`@arcjet/node`, `@arcjet/next`, etc.) because there's no request object to inspect. Instead, you pass explicit context (labels, keys, text to scan) at each call site.

## Installation

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

### guard() inline at each call site

Don't wrap `guard()` in a shared helper function. Each call site should be visible with its own `label` and `rules` array so you can see exactly what protection applies where. A helper like `checkGuard(rules)` obscures which rules apply to which operation and makes the dashboard less useful.

```typescript
// Each call site calls guard() directly with its own label
const decision = await arcjet.guard({ label: "tools.search", rules: toolRules(userId, role, query) });
```

## Choosing a Rate Limit Strategy

See the "Rate Limiting Strategies" section in the main skill for a comparison of token bucket vs fixed window vs sliding window.

Key guard-specific notes: all rate limit rules require a `key` parameter at call time (user ID, session ID, API key) — without it, limits are global across all callers. They also need a `bucket` name to avoid collisions between different rules.

## Content Scanning Rules

### Prompt injection detection

Use `detectPromptInjection()` on any untrusted text before it reaches a model or is used as a tool argument. This catches jailbreaks, role-play escapes, and instruction overrides. Also useful on tool call *results* when the tool fetches content from untrusted sources.

### Sensitive information detection

Use `localDetectSensitiveInfo()` to block PII from entering or leaving the system (e.g. users sending credit card numbers, or tool outputs leaking email addresses). The scan runs locally via WASM — raw text never leaves the SDK, which matters for compliance.

## Decision Handling

`decision.conclusion` is either `"ALLOW"` or `"DENY"`. Always check before proceeding.

For specific error messages, use the per-rule result accessors (e.g. `userLimit.deniedResult(decision)` gives you `resetInSeconds` for rate limits, `decision.reason` tells you if it was prompt injection). Read the types on the decision object for the full structure.

`decision.hasError()` means something went wrong during rule evaluation (service unreachable, rule execution failure, etc.) but the SDK failed open. Log it but don't block the user.

## Key Patterns

- Pass `abortSignal` when one is available (e.g. from the caller or a timeout) so guard respects cancellation.
- Use `metadata` for analytics/auditing context (user ID, session, etc.) — this appears in the dashboard.
- The `label` string should identify the operation (e.g. `"tools.get_weather"`, `"mcp.query_database"`) — it appears in the dashboard and helps you understand which operations are being rate limited or blocked.
