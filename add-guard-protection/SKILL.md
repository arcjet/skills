---
name: add-guard-protection
license: Apache-2.0
description: Add Arcjet Guard protection to AI agent tool calls, background jobs, and other non-HTTP contexts. Guard provides rate limiting, prompt injection detection, sensitive info detection, and custom rules without requiring an HTTP request object. Use this skill when the user is building AI agent tools, MCP servers, background workers, or any code that needs Arcjet protection but doesn't have an HTTP request — even if they describe it as "rate limit my agent," "protect tool calls," or "add security to my MCP tool."
metadata:
  author: arcjet
---

# Add Arcjet Guard Protection

Add security to AI agent tool calls, background jobs, and other non-HTTP
contexts using Arcjet Guard. Guard provides the same protection as the HTTP
SDKs — rate limiting, prompt injection detection, sensitive info detection — but
designed for code that doesn't have an HTTP request object.

## When to Use Guard vs. the HTTP SDK

| Context                          | Use                |
| -------------------------------- | ------------------ |
| Route handler, API endpoint      | HTTP SDK (`protect()`) — see the `protect-route` skill |
| AI chat/completion endpoint      | HTTP SDK (`protect()`) — see the `add-ai-protection` skill |
| AI agent tool call               | **Guard** (`guard()`) |
| MCP server tool                  | **Guard** (`guard()`) |
| Background job / worker          | **Guard** (`guard()`) |
| Queue consumer                   | **Guard** (`guard()`) |

Guard uses explicit `key` strings for rate limiting instead of extracting IPs
from HTTP requests. Rules are configured once and called with input per
invocation.

## Step 1: Install and Set Up

### JavaScript/TypeScript

```bash
npm install @arcjet/guard
```

```typescript
import { launchArcjet } from "@arcjet/guard";

// Create once at module scope — reuse across all guard calls
const arcjet = launchArcjet({ key: process.env.ARCJET_KEY! });
```

The `@arcjet/guard` package works on Node.js, Bun, Deno, and Cloudflare
Workers. The correct transport is selected automatically.

### Python

Guard is included in the `arcjet` package — no extra install:

```bash
pip install arcjet
# or: uv add arcjet
```

```python
import os
from arcjet.guard import launch_arcjet  # async
# Use launch_arcjet_sync for Flask, Django, or other sync frameworks

arcjet_key = os.getenv("ARCJET_KEY")
if not arcjet_key:
    raise RuntimeError("ARCJET_KEY is required. Get one at https://app.arcjet.com")

aj = launch_arcjet(key=arcjet_key)
```

## Step 2: Configure Rules

Configure rules once at module scope. Call them with input per invocation.

### Rate Limiting

**Token bucket** — best for AI tool calls with variable cost:

```typescript
// JS
import { tokenBucket } from "@arcjet/guard";
const limitRule = tokenBucket({
  refillRate: 2_000,
  intervalSeconds: 3600,
  maxTokens: 5_000,
});
```

```python
# Python
from arcjet.guard import TokenBucket
user_limit = TokenBucket(
    refill_rate=2_000,
    interval_seconds=3600,
    max_tokens=5_000,
)
```

**Fixed window** — hard cap per time period:

```typescript
// JS
import { fixedWindow } from "@arcjet/guard";
const limitRule = fixedWindow({ maxRequests: 1000, windowSeconds: 3600 });
```

```python
# Python
from arcjet.guard import FixedWindow
team_limit = FixedWindow(max_requests=1000, window_seconds=3600)
```

**Sliding window** — smooth rate limiting without burst-at-boundary issues:

```typescript
// JS
import { slidingWindow } from "@arcjet/guard";
const limitRule = slidingWindow({ maxRequests: 500, intervalSeconds: 60 });
```

```python
# Python
from arcjet.guard import SlidingWindow
api_limit = SlidingWindow(max_requests=500, interval_seconds=60)
```

### Prompt Injection Detection

Scan user messages and tool call results for injection attacks:

```typescript
// JS
import { detectPromptInjection } from "@arcjet/guard";
const piRule = detectPromptInjection();
```

```python
# Python
from arcjet.guard import DetectPromptInjection
prompt_scan = DetectPromptInjection()
```

### Sensitive Information Detection

Detect PII locally via WASM — no data leaves the SDK:

```typescript
// JS
import { localDetectSensitiveInfo } from "@arcjet/guard";
const siRule = localDetectSensitiveInfo({
  deny: ["CREDIT_CARD_NUMBER", "EMAIL", "PHONE_NUMBER"],
});
```

```python
# Python
from arcjet.guard import LocalDetectSensitiveInfo
sensitive = LocalDetectSensitiveInfo(deny=["CREDIT_CARD_NUMBER", "EMAIL"])
```

Built-in entity types: `CREDIT_CARD_NUMBER`, `EMAIL`, `PHONE_NUMBER`,
`IP_ADDRESS`.

## Step 3: Add guard() Calls

Bind input to rules and call `guard()` at each protection point.

### JavaScript/TypeScript

```typescript
async function handleToolCall(userId: string, message: string, tokenCount: number) {
  const rl = limitRule({ key: userId, requested: tokenCount });

  const decision = await arcjet.guard({
    label: "tools.weather",  // identifies this call in the dashboard
    rules: [rl, piRule(message), siRule(message)],
  });

  if (decision.conclusion === "DENY") {
    if (decision.reason === "RATE_LIMIT") {
      throw new Error("Rate limit exceeded — try again later");
    }
    if (decision.reason === "PROMPT_INJECTION") {
      throw new Error("Prompt injection detected — please rephrase");
    }
    if (decision.reason === "SENSITIVE_INFO") {
      throw new Error("Sensitive information detected");
    }
    throw new Error("Request denied");
  }

  if (decision.hasError()) {
    console.warn("Guard error — proceeding with caution");
  }

  // Safe to proceed with tool call...
}
```

### Python

```python
async def handle_tool_call(user_id: str, message: str, token_count: int):
    decision = await aj.guard(
        label="tools.weather",
        rules=[
            user_limit(key=user_id, requested=token_count),
            prompt_scan(message),
            sensitive(message),
        ],
    )

    if decision.conclusion == "DENY":
        raise RuntimeError(f"Blocked: {decision.reason}")

    # Safe to proceed with tool call...
```

For sync frameworks (Flask, Django), use `launch_arcjet_sync` and call
`aj.guard(...)` without `await`.

## Step 4: Inspect Results

### Per-rule results

```typescript
// JS — from the bound input (matches this specific submission)
const r = rl.result(decision);
if (r) {
  console.log(r.remainingTokens, r.maxTokens);
}

// From the configured rule (matches all submissions of this rule)
const denied = limitRule.deniedResult(decision);
if (denied) {
  console.log(`Resets at ${denied.resetAtUnixSeconds}`);
}
```

```python
# Python
r = rl.result(decision)
if r:
    print(r.remaining_tokens, r.max_tokens)

denied = user_limit.denied_result(decision)
if denied:
    print(f"Resets at {denied.reset_at_unix_seconds}")
```

### Decision API

```typescript
decision.conclusion;   // "ALLOW" or "DENY"
decision.reason;       // "RATE_LIMIT", "PROMPT_INJECTION", "SENSITIVE_INFO", etc.
decision.hasError();   // true if any rule errored (fail-open)
```

## Step 5: Verify

Start rules in `"DRY_RUN"` mode to observe behavior before switching to
`"LIVE"`:

```typescript
// JS
const limitRule = tokenBucket({ mode: "DRY_RUN", refillRate: 10, intervalSeconds: 60, maxTokens: 100 });
```

```python
# Python
user_limit = TokenBucket(mode="DRY_RUN", refill_rate=10, interval_seconds=60, max_tokens=100)
```

Use labels to identify guard calls in the Arcjet dashboard at
https://app.arcjet.com.

## Custom Rules

Define your own local evaluation logic for domain-specific checks:

### JavaScript/TypeScript

```typescript
import { defineCustomRule } from "@arcjet/guard";

const topicBlock = defineCustomRule<
  { blockedTopic: string },
  { topic: string },
  { matched: string }
>({
  evaluate: (config, input) => {
    if (input.topic === config.blockedTopic) {
      return { conclusion: "DENY", data: { matched: input.topic } };
    }
    return { conclusion: "ALLOW" };
  },
});

const rule = topicBlock({ data: { blockedTopic: "politics" } });
const decision = await arcjet.guard({
  label: "content-filter",
  rules: [rule({ data: { topic: userTopic } })],
});
```

### Python

```python
from arcjet.guard import LocalCustomRule, CustomEvaluateResult
from typing import TypedDict

class TopicConfig(TypedDict):
    blocked_topic: str

class TopicInput(TypedDict):
    topic: str

class TopicData(TypedDict):
    matched: str

class TopicBlockRule(LocalCustomRule[TopicConfig, TopicInput, TopicData]):
    def evaluate(self, config: TopicConfig, input: TopicInput) -> CustomEvaluateResult:
        if input["topic"] == config["blocked_topic"]:
            return CustomEvaluateResult(conclusion="DENY", data={"matched": input["topic"]})
        return CustomEvaluateResult(conclusion="ALLOW")

rule = TopicBlockRule(config={"blocked_topic": "weapons"})
decision = await aj.guard(
    label="content-filter",
    rules=[rule(data={"topic": user_topic})],
)
```

## Gotchas

- **Single instance**: Create `launchArcjet()` / `launch_arcjet()` once at
  module scope. It holds a persistent connection — creating per-call wastes
  resources.
- **Rule configs at module scope too**: Configure rules (e.g. `tokenBucket(...)`)
  once. They carry stable IDs for server-side aggregation. Only bind input
  (`.call({ key, requested })`) per invocation.
- **Labels matter**: Use descriptive labels like `"tools.weather"` or
  `"jobs.email-send"`. They appear in the Arcjet dashboard and help correlate
  decisions.
- **Fail-open**: Guard fails open — if a rule errors, it does not cause a
  denial. Check `decision.hasError()` if you need to handle errors explicitly.
- **Key hashing**: Rate limit keys are SHA-256 hashed before being sent to
  Arcjet. You can safely pass user IDs or emails as keys.
- **Not yet in MCP/API/CLI**: Guard is a new SDK feature. MCP tools, API, and
  CLI support are coming soon.
