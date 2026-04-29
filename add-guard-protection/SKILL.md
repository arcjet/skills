---
name: add-guard-protection
license: Apache-2.0
description: Add Arcjet Guard protection to AI agent tool calls, background jobs, queue workers, and other code paths where there is no HTTP request. Covers rate limiting, prompt injection detection, sensitive information blocking, and custom rules using `@arcjet/guard` (JS/TS) and `arcjet.guard` (Python). Use this skill whenever the user wants to protect tool calls, agent loops, MCP tool handlers, background workers, or any non-HTTP code from abuse — even if they describe it as "rate limit my tool calls," "block prompt injection in my agent," "add security to my MCP server," or "protect my queue worker" without mentioning Arcjet or Guard specifically. Uses the Arcjet CLI (`npx @arcjet/cli` or `brew install arcjet`) for authentication and site/key setup.
metadata:
  author: arcjet
---

# Add Arcjet Guard Protection

Arcjet Guard provides rate limiting, prompt injection detection, sensitive information blocking, and custom rules for code paths that don't have an HTTP request — AI agent tool calls, MCP tool handlers, background job processors, queue workers, and similar.

## Step 0: Set Up the Arcjet CLI

The Arcjet CLI is the primary tool for authenticating, managing sites, configuring remote rules, and monitoring traffic. Install it if not already available:

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
arcjet sites create --team-id <team-id> --name "My Guard App" --confirm

# Get the SDK key for a site
arcjet sites get-key --site-id <site-id>
```

Add the key to your environment file (`.env`, `.env.local`, etc.) as `ARCJET_KEY`.

## Step 1: Detect the Language and Install

Check the project for language indicators:

- `package.json` → JavaScript/TypeScript → `npm install @arcjet/guard` (requires `@arcjet/guard` >= 1.4.0)
- `requirements.txt` / `pyproject.toml` → Python → `pip install arcjet` (requires `arcjet` >= 0.7.0; Guard is included)
- `go.mod`, `Cargo.toml`, `pom.xml`, or other languages → **Guard is not available**. Tell the user that Arcjet Guard currently only supports JavaScript/TypeScript and Python. Do not create a hand-rolled imitation or hallucinate a package that doesn't exist. Suggest they reach out to Arcjet with their use case.

## Step 2: Read the Language Reference

**You must read the reference file for the detected language before writing any code.** The references contain the exact imports, constructor signatures, rule configuration syntax, and guard() call patterns for that language.

- JavaScript/TypeScript: [references/javascript.md](references/javascript.md)
- Python: [references/python.md](references/python.md)

Do not guess at the API. The reference files are the source of truth for all code patterns.

## Step 3: Create the Guard Client (Once, at Module Scope)

The client holds a persistent connection. Create it once at module scope and reuse it — never inside a function or per-call. Name the variable `arcjet`.

Check if `ARCJET_KEY` is set in the environment file (`.env`, `.env.local`, etc.). If not, obtain the key in this priority order:
1. **CLI (preferred):** Run `arcjet sites get-key --site-id <site-id>` (requires `arcjet auth login` first — see Step 0)
2. **MCP:** If the Arcjet MCP server is connected, use it to list sites and retrieve the key
3. **Manual (last resort):** Add a placeholder and tell the user to get a key from https://app.arcjet.com

## Step 4: Configure Rules at Module Scope

Rules are configured once as reusable factories, then called with per-invocation input. This two-phase pattern matters — the rule config carries a stable ID used for server-side aggregation, while the per-call input varies.

When configuring rate limit rules, set `bucket` to a descriptive name (e.g. `"tool-calls"`, `"session-api"`) for semantic clarity and fewer collisions.

### Choosing Rules by Use Case

| Use case | Recommended rules |
| -------- | ----------------- |
| AI agent tool calls | `tokenBucket` + `detectPromptInjection` |
| MCP tool handlers | `slidingWindow` or `tokenBucket` + `detectPromptInjection` |
| Background AI task processor | `tokenBucket` + `localDetectSensitiveInfo` |
| Queue worker with user input | `tokenBucket` + `detectPromptInjection` + `localDetectSensitiveInfo` |
| Scanning tool results for injection | `detectPromptInjection` (scan the returned content) |

## Step 5: Call guard() Inline Before Each Operation

Call `guard()` directly where each operation happens — inline in each tool handler, task processor, or function that needs protection. Do not wrap guard in a shared helper function.

Each `guard()` call takes:
- **label**: descriptive string for the dashboard (e.g. `"tools.search_web"`, `"tasks.generate"`)
- **rules**: array of bound rule invocations
- **metadata** (optional): key-value pairs for analytics/auditing (e.g. `{ userId }`)

Rate limit rules take an explicit **key** string — use a user ID, session ID, API key, or any stable identifier.

You MUST modify the existing source files — adding the dependency to package.json/requirements.txt alone is not enough. The guard() calls must be integrated into the actual code.

## Step 6: Handle Decisions

Always check `decision.conclusion`:
- `"DENY"` → block the operation. Use per-rule result accessors (see reference) for specific error messages like retry-after times.
- `"ALLOW"` → safe to proceed

See the language reference for the exact decision-checking pattern and per-rule result accessors.

## Common Mistakes to Avoid

- **Wrapping guard in a shared helper function** — calling `guard()` through a `guardToolCall()` or `protectCall()` wrapper hides which rules apply to each operation. Call `guard()` inline where each operation happens.
- **Creating the client per call** — the client holds a persistent connection. Create it once at module scope.
- **Configuring rules inside a function** — rule configs carry stable IDs. Creating them per call breaks dashboard tracking and rate limit state.
- **Forgetting the `key` parameter on rate limit rules** — without a key, Guard can't track per-user limits.
- **Forgetting `bucket` on rate limit rules** — without a named bucket, different rules may collide.
- **Using the HTTP SDK when there's no request** — use `@arcjet/guard` / `arcjet.guard` for non-HTTP code, not `@arcjet/node`, `@arcjet/next`, or `arcjet()`.
- **Not checking `decision.conclusion`** — always check before proceeding.
- **Generic DENY messages** — use per-rule result accessors to give users specific feedback like retry-after times.

## Step 7: Verify Guard Decisions with the CLI (Coming Soon)

> **Note:** The `arcjet guards` CLI subcommand is not yet released. Once available, use this feedback loop to verify guard decisions are firing correctly.

After adding guard code, use the CLI to verify decisions are firing correctly. This creates a feedback loop: run the app, trigger a guard, inspect the decision, adjust if needed.

### 1. Start Watching

In a separate terminal, start streaming guard decisions:

```bash
arcjet guards watch --site-id <site-id>
```

This polls for new guard decisions and prints them as they arrive. Use `--conclusion DENY` to filter to denials only, or `--interval 2` for faster polling.

### 2. Trigger the Guard

Run the application and exercise the code paths that call `guard()`. Each call should produce a decision visible in the watch output.

### 3. Inspect Decisions

If a decision doesn't match expectations, inspect it:

```bash
# List recent guard decisions
arcjet guards list --site-id <site-id>

# Get per-rule breakdown for a specific decision
arcjet guards details --site-id <site-id> --decision-id <decision-id>
```

The details view shows each rule execution, its mode (live/dry-run), conclusion, reason, and whether it was skipped — use this to diagnose why a guard allowed or denied unexpectedly.

### 4. Adjust and Repeat

If rules aren't firing as expected:
- Check the `label` matches what appears in the decision
- Verify the `key` is correct for rate limit rules (wrong key = wrong bucket)
- Confirm the `bucket` name is unique per rule
- Check rule ordering — rules execute in array order and a DENY from an earlier rule short-circuits later ones

Then re-run and watch again until decisions match expectations.

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
| Watch guard decisions | `arcjet guards watch --site-id <id>` |
| List guard decisions | `arcjet guards list --site-id <id>` |
| Guard decision details | `arcjet guards details --site-id <id> --decision-id <id>` |

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
