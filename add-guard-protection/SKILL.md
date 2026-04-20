---
name: add-guard-protection
license: Apache-2.0
description: Add Arcjet Guard protection to AI agent tool calls, background jobs, queue workers, and other code paths where there is no HTTP request. Covers rate limiting, prompt injection detection, sensitive information blocking, and custom rules using `@arcjet/guard` (JS/TS) and `arcjet.guard` (Python). Use this skill whenever the user wants to protect tool calls, agent loops, MCP tool handlers, background workers, or any non-HTTP code from abuse — even if they describe it as "rate limit my tool calls," "block prompt injection in my agent," "add security to my MCP server," or "protect my queue worker" without mentioning Arcjet or Guard specifically.
metadata:
  author: arcjet
---

# Add Arcjet Guard Protection

Arcjet Guard provides rate limiting, prompt injection detection, sensitive information blocking, and custom rules for code paths that don't have an HTTP request — AI agent tool calls, MCP tool handlers, background job processors, queue workers, and similar.

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

Check if `ARCJET_KEY` is set in the environment file (`.env`, `.env.local`, etc.). If not, add a placeholder and remind the user to get a key from https://app.arcjet.com.

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
