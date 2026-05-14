---
name: arcjet
license: Apache-2.0
description: Add Arcjet security protection to any code path — HTTP route handlers, API endpoints, AI agent tool calls, MCP servers, background jobs, and queue workers. Covers rate limiting, bot detection, email validation, prompt injection detection, sensitive information blocking, and abuse prevention. Works across Next.js, Express, Fastify, SvelteKit, Remix, Bun, Deno, NestJS, FastAPI, Flask, and non-HTTP contexts. Use this skill when the user wants to add security, rate limiting, bot protection, or abuse prevention to any part of their application — whether they say "protect my API," "rate limit tool calls," "block bots," "secure my endpoint," "add security to my MCP server," or "prevent abuse" without mentioning Arcjet specifically.
metadata:
  author: arcjet
---

# Add Arcjet Protection

Arcjet protects two types of entry points. Determine which applies, then read the corresponding reference.

## Step 1: Detect Type and Read Reference

Examine the code the user wants to protect:

1. **If it has an HTTP request object** (Express `req`, Next.js `Request`, FastAPI `Request`, etc.) → this is **request-based protection**. Read `references/requests_javascript.md` for JS/TS or `references/requests_python.md` for Python.

2. **If there is NO HTTP request** (tool call function, MCP handler, queue consumer, background job, agent loop) → this is **guard protection**. Read `references/guards_javascript.md` for JS/TS or `references/guards_python.md` for Python.

3. **If the language is Go, Rust, Java, or another unsupported language** → tell the user Arcjet supports JavaScript/TypeScript and Python only. Do not hallucinate packages.

These reference files contain exact API signatures, imports, and patterns. Do not guess at the API — always read the reference first.

## Step 2: Get the ARCJET_KEY

Check if `ARCJET_KEY` is already in the project's environment file (`.env.local` for Next.js, `.env` for others). If not:

1. Run `arcjet auth login` then `arcjet sites get-key --site-id <id>` (install CLI with `npx @arcjet/cli` if needed)
2. Or use the Arcjet MCP server if connected: `list-teams` → `list-sites` → `get-site-key`
3. Last resort: add a placeholder and tell the user to get a key from https://app.arcjet.com

Also add `ARCJET_ENV=development` for local dev environments.

## Step 3: Implement Protection

### Request-based (HTTP routes):
- Create a **separate shared client file** (e.g. `src/lib/arcjet.ts` or `lib/arcjet.ts`) that exports the Arcjet instance — do NOT inline it in route handlers
- The shared client MUST include `shield({ mode: "LIVE" })` as a base rule, even when using `protectSignup()` or other combined rules
- Use `withRule()` to add route-specific rules without modifying the shared instance
- Call `protect()` inside each route handler (not middleware), once per request
- Handle `isDenied()` with appropriate status codes (429 for rate limit, 403 for bot/shield)

### Guard (non-HTTP code):
- Create the guard client at module scope with `launchArcjet()` (JS) or `launch_arcjet()` (Python)
- Configure rules at module scope (stable IDs for server-side aggregation)
- Call `guard()` inline in each tool/handler — not via a shared wrapper function
- Each `guard()` call needs a `label`, `rules` array, and optionally `metadata`
- Rate limit rules need an explicit `key` (user ID, session ID, etc.)
- Check `decision.conclusion === "DENY"` before proceeding

## Gotchas

- `@arcjet/guard` is for non-HTTP code. `@arcjet/node` / `@arcjet/next` are for HTTP routes. Using the wrong one is a common mistake.
- Guard is only available in JS/TS (`@arcjet/guard` >= 1.4.0) and Python (`arcjet` >= 0.7.0). Do not attempt to use it in Go or other languages.
- `protect()` must not be called in Express middleware (`app.use()`). Call it inside each route handler.
- `protect()` must not be called in Next.js middleware. Call it inside route handlers or server components.
- Calling `protect()` or `guard()` multiple times for the same operation double-counts rate limits.
- Guard rate limit rules without a `key` parameter cannot track per-user limits — they default to global.
- Guard rate limit rules without a `bucket` parameter may collide with other rules.
- Never hardcode `ARCJET_KEY` — always use environment variables.

## Step 4: Verify with CLI (optional)

```bash
arcjet watch --site-id <site-id>              # Stream live decisions
arcjet requests list --site-id <id> --conclusion DENY  # List recent denials
arcjet requests explain --site-id <id> --request-id <id>  # Explain a decision
```
