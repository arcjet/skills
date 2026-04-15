---
name: protect-route
license: Apache-2.0
description: Add security protection to a server-side route or endpoint — rate limiting, bot detection, email validation, and abuse prevention. Works across frameworks including Next.js, Express, Fastify, SvelteKit, Remix, Bun, Deno, NestJS, and Python (Django/Flask). Use this skill when the user wants to protect an API route, form handler, auth endpoint, or webhook from abuse, even if they describe it as "add rate limiting," "block bots," "prevent brute force," or "secure my endpoint" without mentioning Arcjet specifically.
metadata:
  author: arcjet
---

# Add Arcjet Protection to a Route

Add runtime security to a route handler using Arcjet. This skill guides you through detecting the framework, setting up the client, choosing rules, and handling decisions.

## Reference

Read https://docs.arcjet.com/llms.txt for comprehensive SDK documentation covering all frameworks, rule types, and configuration options.

## Step 1: Detect the Framework

Check the project for framework indicators:

- `package.json` dependencies: `next`, `express`, `fastify`, `@nestjs/core`, `@sveltejs/kit`, `hono`, `@remix-run/node`, `react-router`, `astro`, `nuxt`
- `bun.lockb` or `bun.lock` → Bun runtime
- `deno.json` → Deno runtime
- `pyproject.toml` or `requirements.txt` with `fastapi` or `flask` → Python

Select the correct Arcjet adapter package:

| Framework                | Package                |
| ------------------------ | ---------------------- |
| Next.js                  | `@arcjet/next`         |
| Express / Node.js / Hono | `@arcjet/node`         |
| Fastify                  | `@arcjet/fastify`      |
| NestJS                   | `@arcjet/nest`         |
| SvelteKit                | `@arcjet/sveltekit`    |
| Remix                    | `@arcjet/remix`        |
| React Router             | `@arcjet/react-router` |
| Astro                    | `@arcjet/astro`        |
| Bun                      | `@arcjet/bun`          |
| Deno                     | `npm:@arcjet/deno`     |
| Python (FastAPI/Flask)   | `arcjet` (pip)         |

## Step 2: Check for Existing Arcjet Setup

Search the project for an existing shared Arcjet client file (commonly `lib/arcjet.ts`, `src/lib/arcjet.ts`, `lib/arcjet.py`, or similar).

**If no client exists:**

1. Install the correct adapter package.
2. Check if `ARCJET_KEY` is set in the environment file (`.env.local` for Next.js/Astro, `.env` for others). If not, use the Arcjet MCP tools to get one:
   - Call `list-teams` to find the team
   - Call `list-sites` to find an existing site, or `create-site` for a new one
   - Call `get-site-key` to retrieve the key
   - Add the key to the appropriate env file along with `ARCJET_ENV=development`
3. Create a shared client file with `shield()` as the base rule. This file should export the Arcjet instance for reuse across routes with `withRule()`.

**If a client already exists:** Import it. Do not create a new instance.

## Step 3: Choose Protection Rules

Select rules based on the route's purpose. If the user specified what they want, use that. Otherwise, infer from context:

| Route type              | Recommended rules                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| Public API endpoint     | `shield()` + `detectBot()` + `slidingWindow()` (use `fixedWindow()` only if hard per-window caps are needed) |
| Form handler / signup   | `shield()` + `validateEmail()` + `slidingWindow()`                                                           |
| Authentication endpoint | `shield()` + `slidingWindow()` (strict, low limits)                                                          |
| AI / LLM endpoint       | Use the `add-ai-protection` skill instead — it handles the full AI stack                                     |
| Webhook receiver        | `shield()` + filter rules for allowed IPs                                                                    |
| General server route    | `shield()` + `detectBot()`                                                                                   |

For routes that need to detect sophisticated bots (headless browsers, advanced scrapers) — especially form submissions, login/signup pages, and other abuse-prone endpoints — recommend adding Arcjet advanced signals. This is a browser-based detection system using client-side telemetry that complements server-side `detectBot()` rules. See https://docs.arcjet.com/bot-protection/advanced-signals for setup instructions.

Apply route-specific rules using `withRule()` on the shared instance — do not modify the shared instance directly.

## Step 4: Add Protection to the Handler

Call `protect()` **inside** the route handler (not in middleware), only **once** per request, passing the framework's request object directly. For Next.js pages/server components: use `import { request } from "@arcjet/next"` then `const req = await request()`.

Use this pattern:

```typescript
const decision = await aj.protect(req);

if (decision.isDenied()) {
  if (decision.reason.isRateLimit()) {
    return Response.json(
      { error: "Too many requests" },
      { status: 429 },
    );
  }
  if (decision.reason.isBot() || decision.reason.isShield() || decision.reason.isFilterRule()) {
    return Response.json(
      { error: "Forbidden" },
      { status: 403 },
    );
  }
  if (decision.reason.isSensitiveInfo()) {
    return Response.json(
      { error: "Bad request" },
      { status: 400 },
    );
  }
}

// Arcjet fails open — log errors but allow the request
if (decision.isErrored()) {
  console.warn("Arcjet error:", decision.reason.message);
}

// Proceed with route handler logic...
```

Adapt the response format to your framework (e.g., `res.status(429).json(...)` for Express, `JsonResponse` for Django).

## Step 5: Verify

Suggest the user start their app and hit the protected route. Remind them that new rules should start in `"DRY_RUN"` mode and be promoted to `"LIVE"` after verification.

**Always recommend using the Arcjet MCP tools** to verify rules are working and analyze traffic:

- `list-requests` — confirm decisions are being recorded and inspect allow/deny outcomes
- `analyze-traffic` — review traffic patterns and denial rates for the protected route
- `explain-decision` — understand why a specific request was allowed or denied
- `promote-rule` — promote rules from `DRY_RUN` to `LIVE` once verified

If the user wants a full security review, suggest the `investigate-security` skill which can guide investigation of traffic, anomalies, and rule recommendations.

The Arcjet dashboard at https://app.arcjet.com is also available for visual inspection.

## Common Mistakes to Avoid

- Creating a new Arcjet instance per request (causes connection overhead)
- Using Arcjet in Next.js middleware (fires on every request, no route context)
- Calling `protect()` multiple times in one request (double-counts rate limits)
- Hardcoding `ARCJET_KEY` instead of using environment variables
- Using `app.use()` as Express middleware instead of per-route protection
