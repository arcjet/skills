---
name: arcjet
license: Apache-2.0
description: Add Arcjet security protection to any code path — HTTP route handlers, API endpoints, AI agent tool calls, MCP servers, background jobs, and queue workers. Covers rate limiting, bot detection, email validation, prompt injection detection, sensitive information blocking, and abuse prevention. Works across Next.js, Express, Fastify, SvelteKit, Remix, Bun, Deno, NestJS, FastAPI, Flask, and non-HTTP contexts. Use this skill when the user wants to add security, rate limiting, bot protection, or abuse prevention to any part of their application — whether they say "protect my API," "rate limit tool calls," "block bots," "secure my endpoint," "add security to my MCP server," or "prevent abuse" without mentioning Arcjet specifically.
metadata:
  author: arcjet
---

# Add Arcjet Protection

Arcjet is a runtime security platform. It protects two types of entry points:

1. **Request-based** — HTTP route handlers, API endpoints, form handlers. Uses `protect()` with a framework-specific SDK.
2. **Guards** — AI agent tool calls, MCP tool handlers, background jobs, queue workers, and any code without an HTTP request. Uses `guard()` with `@arcjet/guard` (JS/TS) or `arcjet.guard` (Python).

## Step 1: Determine Protection Type

Examine the code to protect:

- **Has an HTTP request object** (Express `req`, Next.js `Request`, FastAPI `Request`, Flask `request`, etc.) → **Request-based protection**
- **No HTTP request** (tool call function, queue consumer, background job, agent loop, MCP tool handler) → **Guard protection**
- **Go, Rust, Java, or other unsupported languages** → Tell the user Arcjet currently supports JavaScript/TypeScript and Python only. Do not hallucinate packages.

## Step 2: Read the Appropriate Reference

Based on the protection type and language detected in Step 1, read the correct reference files. These contain exact API signatures — do not guess at the API.

### Request-based protection:
- **JavaScript/TypeScript**: Read `references/requests_javascript.md`
- **Python**: Read `references/requests_python.md`
- For the full skill workflow (CLI setup, verification, remote rules): Read `references/requests.md`

### Guard protection (no HTTP request):
- **JavaScript/TypeScript**: Read `references/guards_javascript.md`
- **Python**: Read `references/guards_python.md`
- For the full skill workflow (CLI setup, verification): Read `references/guards.md`

## Step 3: Set Up Arcjet CLI & Key

The Arcjet CLI handles authentication and key management. Install if needed:

```bash
npx @arcjet/cli --help   # via npx (no install)
npm install -g @arcjet/cli  # or install globally
brew install arcjet         # or Homebrew
```

### Authenticate and get a key

```bash
arcjet auth login
arcjet teams list
arcjet sites list --team-id <team-id>
arcjet sites get-key --site-id <site-id>
```

Add `ARCJET_KEY` to the environment file (`.env.local` for Next.js, `.env` for others). Also add `ARCJET_ENV=development` for local dev.

Key retrieval priority:
1. **CLI** (preferred): `arcjet sites get-key --site-id <id>`
2. **MCP**: If connected, use `list-teams` → `list-sites` → `get-site-key`
3. **Manual** (last resort): Placeholder + link to https://app.arcjet.com

## Step 4: Implement Protection

Follow the patterns in the reference file from Step 2. Key principles:

### For request-based protection:
- **Always create a SEPARATE shared client file** (e.g. `src/lib/arcjet.ts`, `lib/arcjet.ts`, or `lib/arcjet.py`) that exports the Arcjet instance. Import it in route files. Do NOT define the client inline in route handlers.
- The shared client MUST include `shield({ mode: "LIVE" })` as a base rule — this is required even when using `protectSignup()` or other combined rules
- Use `withRule()` to add route-specific rules (don't modify the shared instance)
- Call `protect()` inside each route handler (not middleware), once per request
- Handle `isDenied()` with appropriate HTTP status codes (429 for rate limit, 403 for bot/shield)
- Never hardcode `ARCJET_KEY`

### For guard protection:
- Create the guard client at module scope with `launchArcjet()` (JS) or `launch_arcjet()` (Python)
- Configure rules at module scope (stable IDs for server-side aggregation)
- Call `guard()` inline in each tool/handler — not via a shared wrapper function
- Each `guard()` call needs a `label`, `rules`, and optionally `metadata`
- Rate limit rules need an explicit `key` (user ID, session ID, etc.)
- Check `decision.conclusion === "DENY"` before proceeding
- Never use the HTTP SDK (`@arcjet/node`, `@arcjet/next`, `arcjet()`) for non-HTTP code

## Step 5: Verify with CLI

After adding protection, verify decisions are correct:

```bash
# Watch live decisions
arcjet watch --site-id <site-id>

# List recent requests/decisions
arcjet requests list --site-id <site-id> --conclusion DENY --limit 10

# Explain why a request was allowed/denied
arcjet requests explain --site-id <site-id> --request-id <id>
```

## Common Mistakes to Avoid

- Creating a new client per request/call (defeats connection reuse)
- Using HTTP SDK (`@arcjet/node`) for non-HTTP code (use `@arcjet/guard` instead)
- Using Guard SDK for HTTP routes (use framework-specific SDK instead)
- Calling `protect()` in middleware instead of route handlers
- Calling `protect()` or `guard()` multiple times per request/operation
- Hardcoding `ARCJET_KEY`
- Wrapping `guard()` in a shared helper function (hides which rules apply)
- Forgetting `key` parameter on guard rate limit rules

## CLI Quick Reference

| Task | Command |
| ---- | ------- |
| Authenticate | `arcjet auth login` |
| List teams | `arcjet teams list` |
| List sites | `arcjet sites list --team-id <id>` |
| Create site | `arcjet sites create --team-id <id> --name "Name" --confirm` |
| Get SDK key | `arcjet sites get-key --site-id <id>` |
| Watch decisions | `arcjet watch --site-id <id>` |
| List requests | `arcjet requests list --site-id <id>` |
| Explain decision | `arcjet requests explain --site-id <id> --request-id <id>` |
| Create rule | `arcjet rules create --site-id <id> --type <type> ...` |
| Promote rule | `arcjet rules promote --site-id <id> --rule-id <id> --confirm` |
| Security briefing | `arcjet briefing --site-id <id>` |
