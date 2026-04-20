# JavaScript/TypeScript Guard Reference

## Installation

Requires `@arcjet/guard` >= 1.4.0.

```bash
npm install @arcjet/guard
```

Requires `@arcjet/guard` >= 1.4.0.

## Create the Guard Client

```typescript
import { launchArcjet } from "@arcjet/guard";

const arcjet = launchArcjet({ key: process.env.ARCJET_KEY! });
```

Create once at module scope. The client holds a persistent HTTP/2 connection — creating it inside a function defeats connection reuse.

## Rules

Configure rules at module scope. Each rule config carries a stable ID for server-side aggregation, so creating them per call would break dashboard tracking and rate limit state.

### Token Bucket

Best for AI workloads with variable cost per call. Configure a `bucket` name for semantic clarity and to avoid collisions between different rate limit rules.

```typescript
import { tokenBucket } from "@arcjet/guard";

const userLimit = tokenBucket({
  label: "user.tool_call_bucket",  // rule label for dashboard tracking
  bucket: "tool-calls",            // named bucket for this limit
  refillRate: 100,
  intervalSeconds: 60,
  maxTokens: 500,
});
```

### Fixed Window

Hard cap per time period, counter resets at end of window:

```typescript
import { fixedWindow } from "@arcjet/guard";

const callLimit = fixedWindow({
  label: "user.hourly_calls",
  bucket: "hourly-calls",
  maxRequests: 100,
  windowSeconds: 3600,
});
```

### Sliding Window

Smooth rate limiting without burst-at-boundary issues:

```typescript
import { slidingWindow } from "@arcjet/guard";

const sessionLimit = slidingWindow({
  label: "session.api_calls",
  bucket: "session-api",
  maxRequests: 500,
  intervalSeconds: 60,
});
```

### Prompt Injection Detection

Detects jailbreaks, role-play escapes, and instruction overrides. Useful both for user input before it reaches a model AND for tool call results containing untrusted content.

```typescript
import { detectPromptInjection } from "@arcjet/guard";

const piRule = detectPromptInjection();
```

### Sensitive Information Detection

Detects PII locally via WASM — raw text never leaves the SDK.

```typescript
import { localDetectSensitiveInfo } from "@arcjet/guard";

const siRule = localDetectSensitiveInfo({
  deny: ["CREDIT_CARD_NUMBER", "EMAIL", "PHONE_NUMBER"],
});
```

## Calling guard()

Call `guard()` inline where each operation happens. Pass a `label` (appears in the dashboard), `rules`, and optionally `metadata` for analytics/auditing.

When an `AbortSignal` is available (e.g. from the caller or a timeout), pass it as `abortSignal` so guard respects cancellation.

```typescript
async function getWeather(city: string, userId: string, signal?: AbortSignal) {
  const decision = await arcjet.guard({
    label: "tools.get_weather",
    metadata: { userId },
    rules: [
      userLimit({ key: userId, requested: 1 }),
    ],
    ...(signal && { abortSignal: signal }),
  });

  if (decision.conclusion === "DENY") {
    throw new Error("Rate limited — try again later");
  }

  return fetchWeather(city);
}

async function searchWeb(query: string, userId: string) {
  const decision = await arcjet.guard({
    label: "tools.search_web",
    metadata: { userId },
    rules: [
      userLimit({ key: userId, requested: 1 }),
      piRule(query),
    ],
  });

  if (decision.conclusion === "DENY") {
    // Use per-rule results for specific error messages
    const rateLimitDenied = userLimit.deniedResult(decision);
    if (rateLimitDenied) {
      throw new Error(`Rate limited — try again in ${rateLimitDenied.resetInSeconds}s`);
    }
    if (decision.reason === "PROMPT_INJECTION") {
      throw new Error("Prompt injection detected in query");
    }
    throw new Error("Request denied");
  }

  if (decision.hasError()) {
    console.warn("Arcjet guard error — proceeding with caution");
  }

  return doSearch(query);
}
```

## Inspecting Per-Rule Results

Both the configured rule and the bound input provide typed result accessors:

```typescript
const rl = userLimit({ key: userId, requested: 5 });
const decision = await arcjet.guard({
  label: "tools.chat",
  rules: [rl, piRule(message)],
});

// From a bound input — this specific invocation's result
const r = rl.result(decision);
if (r) {
  console.log(r.remainingTokens, r.maxTokens, r.resetInSeconds);
}

// From the configured rule — first denied result across all submissions
const denied = userLimit.deniedResult(decision);
if (denied) {
  console.log(`Retry after ${denied.resetInSeconds}s`);
}
```
