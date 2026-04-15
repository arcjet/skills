---
name: protect-route
license: Apache-2.0
description: Add security protection to a server-side route or endpoint — rate limiting, bot detection, email validation, and abuse prevention. Works across frameworks including Next.js, Express, Fastify, SvelteKit, Remix, Bun, Deno, NestJS, and Python (FastAPI/Flask). Use this skill when the user wants to protect an API route, form handler, auth endpoint, or webhook from abuse, even if they describe it as "add rate limiting," "block bots," "prevent brute force," or "secure my endpoint" without mentioning Arcjet specifically.
metadata:
  author: arcjet
---

# Add Arcjet Protection to a Route

Add runtime security to a route handler using Arcjet. This skill guides you
through detecting the framework, setting up the client, choosing rules, and
handling decisions.

## Reference

Read https://docs.arcjet.com/llms.txt for comprehensive SDK documentation
covering all frameworks, rule types, and configuration options.

## Step 1: Detect the Framework

Check the project for framework indicators:

- `package.json` dependencies: `next`, `express`, `fastify`, `@nestjs/core`,
  `@sveltejs/kit`, `hono`, `@remix-run/node`, `react-router`, `astro`, `nuxt`
- `bun.lockb` or `bun.lock` → Bun runtime
- `deno.json` → Deno runtime
- `pyproject.toml` or `requirements.txt` with `fastapi` or `flask` → Python

Select the correct Arcjet adapter package:

| Framework                 | Package                |
| ------------------------- | ---------------------- |
| Next.js                   | `@arcjet/next`         |
| Express / Node.js / Hono  | `@arcjet/node`         |
| Fastify                   | `@arcjet/fastify`      |
| NestJS                    | `@arcjet/nest`         |
| SvelteKit                 | `@arcjet/sveltekit`    |
| Remix                     | `@arcjet/remix`        |
| React Router              | `@arcjet/react-router` |
| Astro                     | `@arcjet/astro`        |
| Nuxt                      | `@arcjet/nuxt`         |
| Bun                       | `@arcjet/bun`          |
| Deno                      | `npm:@arcjet/deno`     |
| Python (FastAPI/Flask)    | `arcjet` (pip/uv)      |

## Step 2: Check for Existing Arcjet Setup

Search the project for an existing shared Arcjet client file (commonly
`lib/arcjet.ts`, `src/lib/arcjet.ts`, `lib/arcjet.py`, or similar).

**If no client exists:**

1. Install the correct adapter package.
2. Check if `ARCJET_KEY` is set in the environment file (`.env.local` for
   Next.js/Astro, `.env` for others). If not, the user needs to sign up at
   https://app.arcjet.com and add their key along with `ARCJET_ENV=development`.
3. Create a shared client file with `shield()` as the base rule. This file
   should export the Arcjet instance for reuse across routes with `withRule()`.

**If a client already exists:** Import it. Do not create a new instance.

### JavaScript/TypeScript client example

```typescript
// lib/arcjet.ts
import arcjet, { shield } from "@arcjet/next";
// Replace @arcjet/next with the correct adapter for your framework

export default arcjet({
  key: process.env.ARCJET_KEY!,
  rules: [
    shield({ mode: "LIVE" }),
  ],
});
```

### Python client example

```python
# lib/arcjet_client.py
import os
from arcjet import arcjet, shield, Mode

arcjet_key = os.getenv("ARCJET_KEY")
if not arcjet_key:
    raise RuntimeError("ARCJET_KEY is required. Get one at https://app.arcjet.com")

aj = arcjet(
    key=arcjet_key,
    rules=[
        shield(mode=Mode.LIVE),
    ],
)
```

## Step 3: Choose Protection Rules

Select rules based on the route's purpose. If the user specified what they want,
use that. Otherwise, infer from context:

| Route type              | Recommended rules                                                |
| ----------------------- | ---------------------------------------------------------------- |
| Public API endpoint     | `shield()` + `detectBot()` + `slidingWindow()`                  |
| Form handler / signup   | `shield()` + `validateEmail()` + `slidingWindow()`              |
| Authentication endpoint | `shield()` + `slidingWindow()` (strict, low limits)             |
| AI / LLM endpoint       | Use the `add-ai-protection` skill instead                       |
| Webhook receiver        | `shield()` + filter rules for allowed IPs                       |
| General server route    | `shield()` + `detectBot()`                                      |

Apply route-specific rules using `withRule()` on the shared instance — do not
modify the shared instance directly.

## Step 4: Add Protection to the Handler

Call `protect()` **inside** the route handler (not in middleware), only **once**
per request, passing the framework's request object directly. For Next.js
pages/server components: use `import { request } from "@arcjet/next"` then
`const req = await request()`.

### JavaScript/TypeScript pattern

```typescript
import aj from "@/lib/arcjet";
import { detectBot, slidingWindow } from "@arcjet/next";

const routeAj = aj
  .withRule(detectBot({ mode: "LIVE", allow: [] }))
  .withRule(slidingWindow({ mode: "LIVE", interval: "1m", max: 100 }));

export async function POST(req: Request) {
  const decision = await routeAj.protect(req);

  if (decision.isDenied()) {
    if (decision.reason.isRateLimit()) {
      return Response.json({ error: "Too many requests" }, { status: 429 });
    }
    if (decision.reason.isBot() || decision.reason.isShield()) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // Arcjet fails open — log errors but allow the request
  if (decision.isErrored()) {
    console.warn("Arcjet error:", decision.reason.message);
  }

  // Proceed with route handler logic...
}
```

### Python pattern (FastAPI)

```python
from arcjet import detect_bot, sliding_window, Mode, BotCategory

# Use with_rule() to extend the shared instance
route_aj = aj.with_rule(
    detect_bot(mode=Mode.LIVE, allow=[BotCategory.SEARCH_ENGINE]),
).with_rule(
    sliding_window(mode=Mode.LIVE, interval=60, max=100),
)

@app.post("/api/data")
async def handle_data(request: Request):
    decision = await route_aj.protect(request)

    if decision.is_denied():
        if decision.reason_v2.type == "RATE_LIMIT":
            return JSONResponse({"error": "Too many requests"}, status_code=429)
        return JSONResponse({"error": "Forbidden"}, status_code=403)

    # Proceed with handler logic...
```

Adapt the response format to your framework (e.g., `res.status(429).json(...)`
for Express, `jsonify()` for Flask).

## Step 5: Verify

Suggest the user start their app and hit the protected route. Remind them that
new rules should start in `"DRY_RUN"` mode and be promoted to `"LIVE"` after
verification.

If the user has the Arcjet MCP server connected (`https://api.arcjet.com/mcp`),
recommend using these tools to verify:

- `list-requests` — confirm decisions are being recorded
- `analyze-traffic` — review traffic patterns and denial rates
- `explain-decision` — understand why a specific request was allowed or denied

The Arcjet dashboard at https://app.arcjet.com is also available for visual
inspection.

## Gotchas

- **Single instance**: Create one Arcjet client and reuse it. Creating a new
  instance per request wastes connections and caching.
- **No middleware**: Call `protect()` in route handlers, not middleware.
  Middleware lacks route context, making it hard to apply route-specific rules.
- **Once per request**: Call `protect()` once per request. Calling it in both
  middleware and a handler double-counts rate limits.
- **No hardcoded keys**: Use environment variables for `ARCJET_KEY`, never
  hardcode it.
- **No `app.use()`**: In Express, don't use Arcjet as `app.use()` middleware.
  Call it per-route.
- **Proxy config**: If behind a load balancer or reverse proxy, configure
  `proxies` so Arcjet resolves the real client IP.
