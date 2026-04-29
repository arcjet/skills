---
name: add-request-protection
license: Apache-2.0
description: Add security protection to a server-side route or endpoint — rate limiting, bot detection, email validation, and abuse prevention. Works across frameworks including Next.js, Express, Fastify, SvelteKit, Remix, Bun, Deno, NestJS, and Python (Django/Flask). Use this skill when the user wants to protect an API route, form handler, auth endpoint, or webhook from abuse, even if they describe it as "add rate limiting," "block bots," "prevent brute force," or "secure my endpoint" without mentioning Arcjet specifically. Uses the Arcjet CLI (`npx @arcjet/cli` or `brew install arcjet`) for authentication, site/key setup, remote rule management, and traffic verification.
metadata:
  author: arcjet
---

# Add Arcjet Protection to a Route

Add runtime security to a route handler using Arcjet. This skill guides you through setting up the CLI, detecting the framework, configuring rules, and verifying protection.

## Reference

Read https://docs.arcjet.com/llms.txt for comprehensive SDK documentation covering all frameworks, rule types, and configuration options.

## Step 0: Set Up the Arcjet CLI

The Arcjet CLI is the primary tool for authenticating, managing sites, configuring remote rules, and verifying protection. Install it if not already available:

```bash
# Via npx (no install required)
npx @arcjet/cli --help

# Or install globally via npm
npm install -g @arcjet/cli

# Or via Homebrew
brew install arcjet
```

### Authenticate

```bash
arcjet auth login
```

Opens the browser for authentication. Check status with `arcjet auth status`.

### Site & Key Setup

```bash
# List your teams
arcjet teams list

# List sites for a team
arcjet sites list --team-id <team-id>

# Create a new site
arcjet sites create --team-id <team-id> --name "My App" --confirm

# Get the SDK key for a site
arcjet sites get-key --site-id <site-id>
```

Add the key to your environment file (`.env.local` for Next.js/Astro, `.env` for others) as `ARCJET_KEY`.

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
2. Check if `ARCJET_KEY` is set in the environment file (`.env.local` for Next.js/Astro, `.env` for others). If not, obtain the key in this priority order:
   1. **CLI (preferred):** Run `arcjet sites get-key --site-id <site-id>` (requires `arcjet auth login` first — see Step 0)
   2. **MCP:** If the Arcjet MCP server is connected, use `list-teams` → `list-sites` → `get-site-key`
   3. **Manual (last resort):** Add a placeholder and tell the user to get a key from https://app.arcjet.com
   - Also add `ARCJET_ENV=development` to the env file
3. Create a shared client file with `shield()` as the base rule. This file should export the Arcjet instance for reuse across routes with `withRule()`.

**If a client already exists:** Import it. Do not create a new instance.

## Step 3: Choose Protection Rules

Select rules based on the route's purpose. If the user specified what they want, use that. Otherwise, infer from context:

| Route type              | Recommended rules                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| Public API endpoint     | `shield()` + `detectBot()` + `slidingWindow()` (use `fixedWindow()` only if hard per-window caps are needed) |
| Form handler / signup   | `shield()` + `validateEmail()` + `slidingWindow()`                                                           |
| Authentication endpoint | `shield()` + `slidingWindow()` (strict, low limits)                                                         |
| AI / LLM endpoint       | `shield()` + `detectBot()` + `tokenBucket()` + content filtering                                            |
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

## Step 5: Verify with the CLI

After adding protection, use the CLI to verify decisions are firing correctly. This creates a feedback loop: start the app, hit the route, inspect decisions, adjust if needed.

### 1. Start Watching

In a separate terminal, stream live request decisions:

```bash
arcjet watch --site-id <site-id>
```

This polls for new decisions and prints them as they arrive. Use `--conclusion DENY` to filter to denials only, or `--interval 2` for faster polling.

### 2. Hit the Protected Route

Start the app and send requests to the protected route. Each request should produce a decision visible in the watch output.

### 3. Inspect Decisions

If a decision doesn't match expectations:

```bash
# List recent requests (filter to denials)
arcjet requests list --site-id <site-id> --conclusion DENY --limit 10

# Get full details for a specific request
arcjet requests details --site-id <site-id> --request-id <request-id>

# Plain-English explanation of why a request was allowed/denied
arcjet requests explain --site-id <site-id> --request-id <request-id>
```

### 4. Adjust and Repeat

If rules aren't firing as expected, adjust the code and re-test. Use `arcjet watch` to confirm each change produces the expected decisions.

The Arcjet dashboard at https://app.arcjet.com is also available for visual inspection.

## Step 6: Manage Remote Rules via CLI (Optional)

Remote rules apply globally to all requests for a site and can be managed without code changes or redeployment. Supported types: `rate_limit`, `bot`, `shield`, `filter`.

```bash
# Create a rule (always starts in DRY_RUN)
arcjet rules create --site-id <site-id> --type rate_limit --max 100 --window 60 --confirm
arcjet rules create --site-id <site-id> --type shield --confirm
arcjet rules create --site-id <site-id> --type bot --deny CATEGORY:SEARCH_ENGINE --confirm

# Check what a dry-run rule would block
arcjet analyze dry-run-impact --site-id <site-id>

# Promote to LIVE once verified
arcjet rules promote --site-id <site-id> --rule-id <rule-id> --confirm

# List / update / delete rules
arcjet rules list --site-id <site-id>
arcjet rules update --site-id <site-id> --rule-id <rule-id> --max 200 --confirm
arcjet rules delete --site-id <site-id> --rule-id <rule-id> --confirm
```

## Step 7: Traffic Analysis

Use the CLI to monitor traffic patterns and investigate issues:

```bash
# Full security briefing (traffic, denials, quota, active rules)
arcjet briefing --site-id <site-id>

# Traffic analysis over 14 days
arcjet analyze traffic --site-id <site-id> --days 14

# Detect anomalies (spikes, geographic shifts, new threats)
arcjet analyze anomalies --site-id <site-id>

# Investigate a specific IP
arcjet analyze ip --site-id <site-id> --ip 1.2.3.4
```

## Common Mistakes to Avoid

- Creating a new Arcjet instance per request (causes connection overhead)
- Using Arcjet in Next.js middleware (fires on every request, no route context)
- Calling `protect()` multiple times in one request (double-counts rate limits)
- Hardcoding `ARCJET_KEY` instead of using environment variables
- Using `app.use()` as Express middleware instead of per-route protection

## CLI Quick Reference

| Task | Command |
| ---- | ------- |
| Install/run CLI | `npx @arcjet/cli` or `brew install arcjet` |
| Authenticate | `arcjet auth login` |
| Check auth status | `arcjet auth status` |
| List teams | `arcjet teams list` |
| List sites | `arcjet sites list --team-id <id>` |
| Create site | `arcjet sites create --team-id <id> --name "Name" --confirm` |
| Get SDK key | `arcjet sites get-key --site-id <id>` |
| Watch live requests | `arcjet watch --site-id <id>` |
| List requests | `arcjet requests list --site-id <id>` |
| Explain a decision | `arcjet requests explain --site-id <id> --request-id <id>` |
| Create rule (DRY_RUN) | `arcjet rules create --site-id <id> --type <type> ...` |
| List rules | `arcjet rules list --site-id <id>` |
| Promote to LIVE | `arcjet rules promote --site-id <id> --rule-id <id> --confirm` |
| Security briefing | `arcjet briefing --site-id <id>` |
| Analyze traffic | `arcjet analyze traffic --site-id <id>` |

### Global Flags

All commands support:
- `--output text|json` — output format (default: text on TTY, json otherwise)
- `--fields <list>` — comma-separated fields to include in JSON output
- `--no-color` — disable ANSI colors (also honors `NO_COLOR` env var)
- `--timeout <duration>` — max execution time (e.g. `30s`, `5m`; 0 disables)

### Exit Codes

| Code | Meaning |
| ---- | ------- |
| 0 | Success |
| 1 | General error (unknown command, API failure, network error) |
| 2 | Authentication error (not logged in, token expired) |
| 3 | Input validation error (invalid ID, value out of range) |
| 4 | Confirmation required (mutation needs `--confirm`) |
