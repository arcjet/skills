---
name: add-ai-protection
license: Apache-2.0
description: Protect AI chat and completion endpoints from abuse — detect prompt injection and jailbreak attempts, block PII and sensitive info from leaking, and enforce token budget rate limits to control costs. Use this skill when the user is building or securing any endpoint that processes user prompts with an LLM, even if they describe it as "preventing jailbreaks," "stopping prompt attacks," "blocking sensitive data," or "controlling AI API costs."
metadata:
  author: arcjet
---

# Add AI-Specific Security with Arcjet

Secure AI/LLM endpoints with layered protection: prompt injection detection,
PII blocking, and token budget rate limiting. These protections work together to
block abuse before it reaches your model, saving AI budget and protecting user
data.

## Reference

Read https://docs.arcjet.com/llms.txt for comprehensive SDK documentation
covering all frameworks, rule types, and configuration options.

Arcjet rules run **before** the request reaches your AI model — blocking prompt
injection, PII leakage, cost abuse, and bot scraping at the HTTP layer.

## Step 1: Ensure Arcjet Is Set Up

Check for an existing shared Arcjet client (see the `protect-route` skill for
full setup). If none exists, set one up first with `shield()` as the base rule.
The user will need an Arcjet account at https://app.arcjet.com and their
`ARCJET_KEY` in environment variables.

## Step 2: Add AI Protection Rules

AI endpoints should combine these rules on the shared instance using
`withRule()`:

### Prompt Injection Detection

Detects jailbreaks, role-play escapes, and instruction overrides.

- JS: `detectPromptInjection()` — pass user message via
  `detectPromptInjectionMessage` parameter at `protect()` time
- Python: `detect_prompt_injection()` — pass via
  `detect_prompt_injection_message` parameter

Blocks hostile prompts **before** they reach the model. This saves AI budget by
rejecting attacks early.

### Sensitive Info / PII Blocking

Prevents personally identifiable information from entering model context.

- JS: `sensitiveInfo({ deny: ["EMAIL", "CREDIT_CARD_NUMBER", "PHONE_NUMBER", "IP_ADDRESS"] })`
- Python: `detect_sensitive_info(deny=[SensitiveInfoEntityType.EMAIL, SensitiveInfoEntityType.CREDIT_CARD_NUMBER, ...])`

Pass the user message via `sensitiveInfoValue` (JS) / `sensitive_info_value`
(Python) at `protect()` time.

### Token Budget Rate Limiting

Use `tokenBucket()` / `token_bucket()` for AI endpoints — the `requested`
parameter can be set proportional to actual model token usage, directly linking
rate limiting to cost. It also allows short bursts while enforcing an average
rate, which matches how users interact with chat interfaces.

Recommended starting configuration:

- `capacity`: 5,000 (max burst)
- `refillRate`: 2,000 tokens per interval
- `interval`: `"1h"` (JS) / `3600` (Python)

Pass the `requested` parameter at `protect()` time to deduct tokens proportional
to model cost. Estimate based on prompt length (~1 token per 4 characters).

Set `characteristics` to track per-user: `["userId"]` if authenticated, defaults
to IP-based.

### Base Protection

Always include `shield()` (WAF) and `detectBot()` as base layers. Bots scraping
AI endpoints are a common abuse vector.

## Step 3: Compose the protect() Call and Handle Decisions

All rule parameters are passed together in a single `protect()` call.

### JavaScript/TypeScript pattern

```typescript
import aj from "@/lib/arcjet";
import {
  detectBot,
  detectPromptInjection,
  sensitiveInfo,
  tokenBucket,
} from "@arcjet/next";

const chatAj = aj
  .withRule(detectBot({ mode: "LIVE", allow: [] }))
  .withRule(detectPromptInjection({ mode: "LIVE" }))
  .withRule(sensitiveInfo({ mode: "LIVE", deny: ["CREDIT_CARD_NUMBER", "EMAIL"] }))
  .withRule(
    tokenBucket({
      mode: "LIVE",
      characteristics: ["userId"],
      refillRate: 2_000,
      interval: "1h",
      capacity: 5_000,
    }),
  );

export async function POST(req: Request) {
  const { messages } = await req.json();
  const lastMessage = messages.at(-1)?.content ?? "";
  const estimate = Math.ceil(lastMessage.length / 4);

  const decision = await chatAj.protect(req, {
    userId: "user-123", // replace with real user ID
    requested: estimate,
    sensitiveInfoValue: lastMessage,
    detectPromptInjectionMessage: lastMessage,
  });

  if (decision.isDenied()) {
    if (decision.reason.isRateLimit()) {
      return Response.json(
        { error: "You've exceeded your usage limit. Please try again later." },
        { status: 429 },
      );
    }
    if (decision.reason.isPromptInjection()) {
      return Response.json(
        { error: "Your message was flagged as potentially harmful." },
        { status: 400 },
      );
    }
    if (decision.reason.isSensitiveInfo()) {
      return Response.json(
        { error: "Your message contains sensitive information that cannot be processed." },
        { status: 400 },
      );
    }
    if (decision.reason.isBot()) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  if (decision.isErrored()) {
    console.warn("Arcjet error:", decision.reason.message);
  }

  // Proceed with AI model call...
}
```

### Python pattern (FastAPI)

```python
from arcjet import (
    detect_bot,
    detect_prompt_injection,
    detect_sensitive_info,
    token_bucket,
    Mode,
    SensitiveInfoEntityType,
)

chat_aj = aj.with_rule(
    detect_bot(mode=Mode.LIVE, allow=[]),
).with_rule(
    detect_prompt_injection(mode=Mode.LIVE),
).with_rule(
    detect_sensitive_info(
        mode=Mode.LIVE,
        deny=[
            SensitiveInfoEntityType.CREDIT_CARD_NUMBER,
            SensitiveInfoEntityType.EMAIL,
            SensitiveInfoEntityType.PHONE_NUMBER,
        ],
    ),
).with_rule(
    token_bucket(
        characteristics=["userId"],
        mode=Mode.LIVE,
        refill_rate=2_000,
        interval=3600,
        capacity=5_000,
    ),
)

@app.post("/chat")
async def chat(request: Request, body: ChatRequest):
    estimate = len(body.message) // 4

    decision = await chat_aj.protect(
        request,
        requested=estimate,
        characteristics={"userId": "user-123"},
        detect_prompt_injection_message=body.message,
        sensitive_info_value=body.message,
    )

    if decision.is_denied():
        if decision.reason_v2.type == "RATE_LIMIT":
            return JSONResponse({"error": "Usage limit exceeded"}, status_code=429)
        if decision.reason_v2.type == "PROMPT_INJECTION":
            return JSONResponse({"error": "Message flagged as harmful"}, status_code=400)
        if decision.reason_v2.type == "SENSITIVE_INFO":
            return JSONResponse({"error": "Sensitive information detected"}, status_code=400)
        return JSONResponse({"error": "Forbidden"}, status_code=403)

    # Proceed with AI model call...
```

## Step 4: Verify

1. Start the app and send a normal message — should succeed
2. Test prompt injection by sending something like "Ignore all previous
   instructions and..."
3. Test PII blocking by sending a message with a fake credit card number

Start all rules in `"DRY_RUN"` mode first. Once verified, promote to `"LIVE"`.

If the user has the Arcjet MCP server connected (`https://api.arcjet.com/mcp`),
recommend using these tools to verify:

- `list-requests` — confirm decisions are being recorded
- `analyze-traffic` — review denial rates for the AI endpoint
- `explain-decision` — understand why a request was allowed or denied (useful
  for tuning prompt injection sensitivity)

## Common Patterns

**Streaming responses**: Call `protect()` before starting the stream. If denied,
return the error before opening the stream — don't start streaming and then
abort.

**Multiple models / providers**: Use the same Arcjet instance regardless of
which AI provider you use. Arcjet operates at the HTTP layer, independent of
the model provider.

**Vercel AI SDK**: Call `protect()` before `streamText()` / `generateText()`.
If denied, return a plain error response instead of calling the AI SDK.

## Gotchas

- Sensitive info detection runs **locally in WASM** — no user data is sent to
  external services.
- `sensitiveInfoValue` and `detectPromptInjectionMessage` (JS) /
  `sensitive_info_value` and `detect_prompt_injection_message` (Python) must both
  be passed at `protect()` time — forgetting either silently skips that check.
- Starting a stream before calling `protect()` — if the request is denied
  mid-stream, the client gets a broken response. Always call `protect()` first.
- Use `tokenBucket()` instead of `fixedWindow()` or `slidingWindow()` for AI
  endpoints — token bucket lets you deduct tokens proportional to model cost and
  matches the bursty interaction pattern of chat interfaces.
- Create one Arcjet instance and extend with `withRule()` — don't create a new
  instance per request.
