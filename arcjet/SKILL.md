---
name: arcjet
license: Apache-2.0
description: Add Arcjet security protection to any code path — HTTP route handlers, API endpoints, AI agent tool calls, MCP servers, background jobs, and queue workers. Covers rate limiting, bot detection, email validation, prompt injection detection, sensitive information blocking, and abuse prevention. Works across Next.js, Express, Fastify, SvelteKit, Remix, Bun, Deno, NestJS, FastAPI, Flask, and non-HTTP contexts. Use this skill when the user wants to add security, rate limiting, bot protection, or abuse prevention to any part of their application — whether they say "protect my API," "rate limit tool calls," "block bots," "secure my endpoint," "add security to my MCP server," or "prevent abuse" without mentioning Arcjet specifically.
metadata:
  author: arcjet
---

# Arcjet

## Add Arcjet Protection to Your App

### Checklist

- [ ] Verify language support (JS/TS or Python only — stop if unsupported)
- [ ] Connect to Arcjet platform (CLI → MCP → manual dashboard)
- [ ] Detect protection type and read the appropriate reference file
- [ ] Implement protection (separate client file, correct SDK, correct patterns)
- [ ] Verify decisions are firing correctly (CLI, MCP, or dashboard)

### Step 0: Check Language Support

If the project's server-side code is not JavaScript, TypeScript, or Python → tell the user Arcjet does not support their language yet. Do not hallucinate packages. Stop here.

### Step 1: Connect to the Arcjet Platform

Before writing any code, establish a connection to the Arcjet platform so the project has a valid `ARCJET_KEY`.

**In order of preference:**

1. **Arcjet CLI** (preferred): `npx -y @arcjet/cli@latest auth login` — see [references/cli.md](references/cli.md) for more install options.
2. **Arcjet MCP server** (endpoint: `https://api.arcjet.com/mcp`): See [references/mcp.md](references/mcp.md) for detailed setup.
3. **Manual** (last resort): Tell the user to get a key from https://app.arcjet.com

Add the key to the environment file such as `.env` or follow the pattern used by the project

```init
ARCJET_KEY=ajkey_...
```

### Step 2: Detect Protection Type and Read Reference

Determine which protection type applies:

| | **Request-based** | **Guard** |
|---|---|---|
| **When to use** | Code has an HTTP request object (Express `req`, Next.js `Request`, FastAPI `Request`, etc.) | No HTTP request (tool calls, MCP handlers, queue workers, background jobs, agent loops) |
| **JS/TS SDK** | `@arcjet/next`, `@arcjet/node`, `@arcjet/fastify`, etc. | `@arcjet/guard` (>= 1.4.0) |
| **Python SDK** | `arcjet` (with `arcjet()` / `arcjet_sync()`) | `arcjet` (with `launch_arcjet()` / `launch_arcjet_sync()`) |
| **Entry point** | `protect(request)` | `guard(label, rules)` |

A single project can use both — e.g. request-based on API routes and guard on agent tool calls.

Read the appropriate reference:

- **Request-based JS/TS**: [references/requests_javascript.md](references/requests_javascript.md)
- **Request-based Python**: [references/requests_python.md](references/requests_python.md)
- **Guard JS/TS**: [references/guards_javascript.md](references/guards_javascript.md)
- **Guard Python**: [references/guards_python.md](references/guards_python.md)

These references explain architectural decisions and patterns that can't be inferred from the source code alone. For exact API signatures, read the installed package's types and doc comments.

### Step 3: Implement Protection

Follow the patterns in the reference file from Step 2. Key principles:

#### Request-based (HTTP routes):
- Separate shared client file with `shield()` as a base rule
- `withRule()` for route-specific rules
- `protect()` inside each route handler (not middleware), once per request
- Map `isDenied()` reasons to appropriate HTTP status codes

#### Guard (non-HTTP code):
- Client at module scope with `launchArcjet()` (JS) or `launch_arcjet()` (Python)
- Rules declared at module scope, dynamically selected at call time
- `guard()` inline at each call site with its own `label`
- Check `decision.conclusion === "DENY"` before proceeding

### Step 4: Verify Decisions

Confirm protection is working by checking that decisions fire correctly:

1. **Arcjet CLI**: `arcjet requests list --site-id <id>` or `arcjet guards list --site-id <id>`
2. **Arcjet MCP** (if connected): `list-requests` or `list-guards`
3. **Dashboard**: https://app.arcjet.com

For deeper investigation: `arcjet requests explain --site-id <id> --request-id <id>` or `arcjet guards explain --site-id <id> --guard-id <id>`

### Gotchas

- **Wrong SDK**: `@arcjet/guard` is for non-HTTP code. `@arcjet/node` / `@arcjet/next` / etc. are for HTTP routes. Using the wrong one is the most common mistake.
- **Wrong placement**: `protect()` must not be called in Express middleware or Next.js middleware. Call it inside each route handler.
- **Double-counting**: Calling `protect()` or `guard()` multiple times for the same operation counts against rate limits multiple times.
- **Never hardcode `ARCJET_KEY`** — always use environment variables.

## Choosing Protections

Map the user's problem to the right Arcjet rules:

### Automated traffic and bot abuse

Automated clients — scrapers, data harvesters, and script-based attackers — treat AI features as free compute. Without bot protection, every request from a bot reaches your AI provider and inflates your costs.

Arcjet bot detection runs inside the application, before the AI call, so denied requests never reach your provider. It classifies 600+ known bots across 25 categories, verifies legitimate bots (search engines, monitors), and detects emerging threats in real time.

You configure bot rules in application code — not at the CDN layer — so you can apply different strategies per route and make decisions based on full application context (identity, subscription level, session state).

**Rules:** `detectBot` (request-based only). Use `allow` for a safelist or `deny` to block specific categories — they're mutually exclusive. Combine with rate limiting for full traffic control.

Bot rules can also be configured as remote rules via the CLI or MCP server — applied site-wide with no code changes or redeployment. Useful for blocking a newly-spotted bot category during an incident.

### Cost explosion and budget control

Automated traffic, user abuse, and prompt attacks inflate token and tool spend. Rate limiting enforces per-user token quotas to prevent cost explosions.

**Rules:** `tokenBucket`, `fixedWindow`, `slidingWindow` (request-based and guard).

Use token bucket for AI workloads where operations have variable cost — set `requested` per call to consume proportional tokens (1 for a lookup, 10 for an expensive generation). Fixed window gives a hard cap that resets at period boundaries. Sliding window provides smooth rate limiting without boundary bursts.

For request-based protection, rate limits default to keying by IP. Use `characteristics: ["userId"]` to key by something else. For guard protection, you must always pass an explicit `key` (user ID, session ID, etc.) and a `bucket` name to avoid collisions.

### Prompt injection attacks

Jailbreaks, role-play escapes, and instruction overrides allow attackers to manipulate AI behavior. Arcjet scores incoming messages for injection patterns before they reach the model.

**Rules:** `detectPromptInjection` (request-based and guard). Use on any untrusted text before it reaches a model or tool argument — and on tool call *results* when the tool fetches content from untrusted sources.

### Data loss prevention

Sensitive data leaks into AI model context, logs, third-party tool calls, or model memory through unguarded inputs and outputs. Arcjet detects card numbers, email addresses, phone numbers, and custom patterns — entirely locally via WASM, with no data leaving your infrastructure.

**Rules:** `sensitiveInfo` / `localDetectSensitiveInfo` (request-based and guard). Use to block PII from entering the system (users sending credit card numbers) or leaving it (tool outputs leaking email addresses).

### Unauthorized tool invocation

Agents invoke tools in ways they shouldn't — issuing refunds, accessing data, escalating privileges. The prompt can be benign; the tool call is catastrophic.

**Rules:** Guard protection with per-tool rate limits and labels. Each tool call site gets its own `label` and rules, so you can enforce different budgets and detect abuse per operation. Combine with prompt injection detection on tool inputs.

### Common web attacks

SQLi, XSS, and other injection attacks targeting web endpoints.

**Rules:** `shield` (request-based only). Always include — zero config, no cost. Should be in every shared Arcjet client file as a base rule.

### Signup abuse

Credential stuffing, spam registrations, and disposable email abuse on signup/login forms.

**Rules:** `validateEmail` + `protectSignup` (request-based only). Rejects disposable, no-MX, and invalid addresses. `protectSignup` combines bot detection + email validation + rate limiting in one rule.

### IP-based filtering

Block traffic by IP metadata — VPN, Tor, country, or specific IP ranges.

**Rules:** `filter` (request-based only). Can also be configured as remote rules via CLI/MCP for immediate response to active attacks without redeployment.
