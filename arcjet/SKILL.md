---
name: arcjet
license: Apache-2.0
description: Add Arcjet security protection to any code path – HTTP route handlers, API endpoints, AI agent tool calls, MCP servers, background jobs, and queue workers. Covers rate limiting, bot detection, email validation, prompt injection detection, sensitive information blocking (including Rampart NER), content moderation, capture/flush, and abuse prevention. Works with JavaScript/TypeScript, Python, and Go across Next.js, Express, Fastify, SvelteKit, Remix, Bun, Deno, NestJS, FastAPI, Flask, net/http, Vercel AI SDK, Vercel Eve, Mastra, LangChain (Python and JS createAgent), LangGraph, CrewAI, OpenAI Agents, Genkit, and other non-HTTP contexts. Use this skill when the user wants to add security, rate limiting, bot protection, or abuse prevention to any part of their application – whether they say "protect my API," "rate limit tool calls," "block bots," "secure my endpoint," "add security to my MCP server," "guard this Mastra/Eve/LangGraph/LangChain createAgent/CrewAI/OpenAI Agents/Genkit/AI SDK agent," or "prevent abuse" without mentioning Arcjet specifically.
metadata:
  author: arcjet
---

# Arcjet

## Contents

- [Add Arcjet protection to your app](#add-arcjet-protection-to-your-app)
- [Choose protections](#choose-protections)
- [Resources](#resources)

## Add Arcjet protection to your app

### Checklist

- [ ] **Step 1:** Verify language support (JS/TS, Python, or Go only – stop if unsupported)
- [ ] **Step 2:** Connect to Arcjet platform (CLI → MCP → manual Console setup)
- [ ] **Step 3:** Detect protection type and read the appropriate reference file
- [ ] **Step 4:** Implement protection (separate client file, correct SDK, correct patterns)
- [ ] **Step 5:** Verify decisions are firing correctly (trigger a real call, then check CLI / MCP / Console)

### Step 1: Check language support

If the project's server-side code is not JavaScript, TypeScript, Python, or Go → tell the user in chat that Arcjet doesn't support their language yet. Don't modify the project, don't write a `NOTES.md`, don't invent a package. Just say it and stop.

### Step 2: Get an `ARCJET_KEY` into the project's env file

Before writing any code, the project needs a real `ARCJET_KEY` in its env file. Don't write Arcjet code first and "leave the key as a TODO" – that just produces dead code. Get the key first, then wire it up.

**In order of preference:**

1. **Arcjet CLI** (preferred). Check whether you're already signed in, then retrieve a key.
2. **Arcjet MCP server** (endpoint: `https://api.arcjet.com/mcp`) – for clients with built-in MCP. See [references/mcp.md](references/mcp.md).
3. **Manual** (last resort): tell the user to grab a key from https://console.arcjet.com.

#### CLI bootstrap (the normal path)

```bash
npx -y @arcjet/cli@latest auth status        # is the user already signed in?
# if not signed in:
npx -y @arcjet/cli@latest auth login         # browser device flow, see references/cli.md

npx -y @arcjet/cli@latest teams list --output json --fields id,name
npx -y @arcjet/cli@latest sites list --team-id <team_id> --output json --fields id,name
# if no suitable site exists:
npx -y @arcjet/cli@latest sites create --team-id <team_id> --name "<project>"

npx -y @arcjet/cli@latest sites get-key --site-id <site_id> --output json --fields key
```

Write the `key` value to the project's env file as `ARCJET_KEY=ajkey_...`. Match whatever the project already does – filename, `.env.example` companion, `.gitignore` entry. If the project doesn't have a convention yet, default to whatever the framework expects and add the env file to `.gitignore`. Never hardcode the key in source.

See [references/cli.md](references/cli.md) for install options beyond `npx`, agent-mode flags, and the full command reference.

#### Install the SDK with the project's package manager

Once you know which SDK you need (see Step 3), install it with the package manager the project already uses: `npm install`, `pnpm add`, `yarn add`, `bun add`, `pip install`, `uv add`, `poetry add`, or `go get`. Don't hand-edit `package.json` / `requirements.txt` / `go.mod` and guess a version: typed versions tend to be wrong (`arcjet>=1.0.0` doesn't exist for the Python SDK; `^1.0.0` is stale for `@arcjet/next`; Go must use the module tag, not a copied pseudo-version), and the lockfile/module metadata won't get updated. Let the package manager pick the real version and pin it.

### Step 3: Detect protection type and read the reference

Determine which protection type applies:

| | **Request-based** | **Guard** |
|---|---|---|
| **When to use** | Code has an HTTP request object (Express `req`, Next.js `Request`, FastAPI `Request`) | No HTTP request (tool calls, MCP handlers, queue workers, background jobs, agent loops) |
| **JS/TS SDK** | Framework adapters such as `@arcjet/next`, `@arcjet/node`, `@arcjet/fastify` | `@arcjet/guard` |
| **Python SDK** | `arcjet` (with `arcjet()` / `arcjet_sync()`) | `arcjet` (with `launch_arcjet()` / `launch_arcjet_sync()`) |
| **Go SDK** | `github.com/arcjet/arcjet-go` (with `NewClient`) | `github.com/arcjet/arcjet-go` (with `NewGuardClient`) |
| **Entry point** | `protect(request)` / `Protect(ctx, r)` | `guard(label, rules)` / `Guard(ctx, request)` |

A single project can use both – for example, request-based on API routes and Guard on agent tool calls. If the project already uses Vercel AI SDK, Vercel Eve, Mastra, LangChain, LangGraph, CrewAI, OpenAI Agents, or Genkit, prefer the versioned Guard wrappers in the language reference over hand-wrapping every tool. In Python, that is `guard_action` / `guard_tool` / `ArcjetMiddleware` / `arcjet.guard.crewai` (see the Python Guard reference) – not a raw `guard()` around every callable. JS LangChain `createAgent` is `@arcjet/guard/langchain/v1`, not the LangGraph Graph API adapter.

**Common misclassifications to watch for:**

- **MCP servers**: the word "server" is misleading. MCP tools don't receive HTTP requests – they're invoked by an MCP client over stdio or SSE. Use **Guard**, not request-based.
- **Background jobs / queue consumers**: no HTTP request at the protection site. Use **Guard**.
- **Server actions / RPC over HTTP** (Next.js server actions, tRPC): there *is* an HTTP request underneath. Use **request-based**.
- **Agent tool calls inside a request handler**: if you want to limit per-user-per-route, request-based is fine. If you want per-tool budgets independent of any HTTP boundary, use Guard at the tool call site.

Read the appropriate reference:

- **Request-based JS/TS**: [references/requests_javascript.md](references/requests_javascript.md)
- **Request-based Python**: [references/requests_python.md](references/requests_python.md)
- **Request-based Go**: [references/requests_go.md](references/requests_go.md)
- **Guard JS/TS**: [references/guards_javascript.md](references/guards_javascript.md)
- **Guard Python**: [references/guards_python.md](references/guards_python.md)
- **Guard Go**: [references/guards_go.md](references/guards_go.md)

These references explain architectural decisions and patterns that can't be inferred from the source code alone. For exact API signatures, read the installed package's types and doc comments.

### Step 4: Implement protection

Follow the patterns in the reference file from Step 3. Key principles:

#### Request-based (HTTP routes):
- Create shared clients outside handlers and include Shield as a base rule. Use the exact constructor and rule names from the language reference. JS HTTP rules omitted `mode` default to `DRY_RUN` – pass `mode: "LIVE"` to enforce. Python HTTP factories require `mode=` (`TypeError` if omitted). Go HTTP Protect rules also default to dry run – set `Mode: arcjet.ModeLive` to enforce.
- In JavaScript/TypeScript, create one `arcjet()` client and use `withRule()` for route-specific extras so clones share the decision cache. Check `decision.isDenied()`. Sibling `arcjet()` constructors do not share cache. `detectBot` requires exactly one of `allow` or `deny` (neither or both throws).
- In Python, create one `arcjet()` / `arcjet_sync()` client and use `with_rule()` for route-specific extras so clones share `DecisionCache`. Check `decision.is_denied()`. Sibling constructors do not share cache.
- In Go, create one `NewClient` at package scope. `WithRule()` derives route-specific clients that share the parent cache, and returns `(*Client, error)`, so handle initialization errors. Check `decision.IsDenied()`. Separate `NewClient` calls do not share cache.
- Call `protect()` / `Protect()` inside each route handler (not in app-level middleware), once per request.
- Map denial reasons to HTTP responses. Only branch on reasons that produce a *different* response – there is no point in a Shield-specific arm that returns the same status as the default 403.
- Put the language's `userId` characteristic selector on the specific rule that needs it, then pass a **trusted, authenticated** user ID at protection time. Never rate limit by a client-controlled header unless a trusted proxy strips and rewrites it.
- If the application already has a trusted client IP, pass it explicitly: `ipSrc` (JS), `ip_src` (Python – also set `disable_automatic_ip_detection=True`), `WithIPSrc` (Go). The SDK trusts the value; do not pass a client-controlled header.
- `protect()` accepts nested-JSON `metadata` (same shape as Guard). It does not affect fingerprinting. Do not put secrets or PII in it. When present, request decisions also expose optional IP threat intelligence (`decision.ip.threat` / `ip_details.threat` / `IP.Threat`).

#### Guard (non-HTTP code):
- Client at module scope with `launchArcjet()` (JS) or `launch_arcjet()` / `launch_arcjet_sync()` (Python – pick async vs sync to match the function you're protecting).
- In Go, create one `NewGuardClient` at package scope.
- Rules declared at module scope. Give each rule a meaningful `label` so they show up usefully in the Console.
- **One `guard()` call per specific operation, with a hardcoded `label`** like `"tools.get-weather"` or `"queue.summarize"`. Put it wherever you already know exactly what's happening – that can be inside the tool/task function itself, or right before calling it from a dispatch arm. Both work; pick whichever makes error propagation cleaner. What to avoid is the generic-dispatcher pattern (`handleToolCall(name, args)` calling `guard(label=f"tools.{name}")`) – interpolated labels break grep and produce messy Console groupings.
- **Label naming rules**: labels are validated server-side as slugs – **lowercase letters, digits, dash (`-`), and dot (`.`) only**, must start and end with a letter or digit, max 256 bytes. Underscores, uppercase, and slashes are rejected. Use `tools.get-weather`, not `tools.get_weather` or `Tools.GetWeather`.
- **Pass `metadata` on the `guard()` call** when you have useful auditing context. It is nested JSON – objects, arrays, numbers, booleans – not a flat string map (`metadata={ user: { id: userId }, requestId }`). It appears in the Console and does not affect the decision. Do not put secrets or PII in it.
- **`capture()` records what happened** after an action (refund issued, tool completed). It is visibility data, never a security decision – it does not deny and never sets `hasFailedOpen()`. Call `flush()` on shutdown so the last batch is not lost. On serverless, pass a platform `waitUntil` (JS) or flush at the end of the invocation. On Python `guard_action` / `guard_tool` / `ArcjetMiddleware`, `success` is not "the action ran" – see the Python Guard reference.
- **Optional registration (JS/Python only):** `registerArcjet` / `register_arcjet` is a separate call from launch. It enables free `guard()` / `capture()` / `flush()` when you cannot thread a client. Free `guard()` fail-opens if nothing is registered – check `hasFailedOpen()` / `has_failed_open()`; do not treat that ALLOW as a pass. Go has no registration API; pass the client. Prefer an explicit client everywhere you can.
- **JS framework wrappers** (`@arcjet/guard/vercel-ai/v7`, `@arcjet/guard/vercel-eve/v0`, `@arcjet/guard/mastra/v1`, `@arcjet/guard/langgraph/v1`, `@arcjet/guard/langchain/v1`, `@arcjet/guard/claude-agent-sdk/v0`, `@arcjet/guard/openai-agents/v0`, `@arcjet/guard/genkit/v1`) fail closed by default when Guard is unavailable. Import the versioned path – unversioned aliases do not resolve. JS `createAgent` (`@arcjet/guard/langchain/v1`) is not Python LangChain and not LangGraph JS.
- **Python framework wrappers** (`guard_action` / `guard_tool` / `ArcjetMiddleware` / `ArcjetCaptureHandler` / `arcjet.guard.crewai`) fail closed by default when Guard is unavailable. Pick the helper that matches what you hold – any callable → `guard_action` / `guard_action_sync` (core `arcjet.guard`); a LangChain `BaseTool` you call → `guard_tool` (`arcjet[langchain]`, `langchain-core>=1.2.5,<2`); `create_agent` → `ArcjetMiddleware` + `ToolPolicy` (`arcjet[langchain-agents]`, `langchain>=1.3` / `langgraph>=1.2`); observe a chain → `ArcjetCaptureHandler` (`arcjet[langchain]` – cannot deny); official CrewAI crew / LiteAgent / MCP → `register_arcjet_hooks` + `ToolPolicy`; a CrewAI `BaseTool` you call yourself → `guard_tool` (`arcjet.guard.crewai`). There is no `arcjet[crewai]` extra (CrewAI pulls `chromadb`, CVE-2026-45829) — install `crewai>=1.15.3,<2` yourself. Importing `arcjet.guard.langchain` does not load LangGraph. Importing `arcjet.guard.crewai` does not load LangChain.
- **Eve `guardApproval`:** `approval` is one field – a function (request-time only) or `{ request, response }`. Optional peer `eve` `>=0.34.0 <1` (still 0.x); Node.js ≥ 24 still applies. Do not compose with Eve `always()` / `once()` / `never()`. Request/response + HITL details are in the JS Guard reference.
- **OpenAI Agents:** import `@arcjet/guard/openai-agents/v0` (`guardTool` + `openaiAgentsContext` only). Text `Agent` + `run()` + authored `tool()` – not Realtime, Sandbox, hosted, MCP, or `asTool`. Screen inbound before `run()` and act on that `guard()` decision: core `guard()` fails open, so ALLOW is not proof the rules ran. Details in the JS Guard reference.
- **Genkit:** import `@arcjet/guard/genkit/v1` (`guardTool` + `guardMiddleware` + `genkitContext` only). JS `genkit()` + `ai.defineTool` + `ai.generate` – not Go / Python Genkit. Authored tools via `guardTool`; filesystem / MCP / unwrapped via `guardMiddleware` on `generate({ use })` (needs Genkit >= 1.33). Screen inbound before `generate()` / `chat.send()` and act on that `guard()` decision: core `guard()` fails open, so ALLOW is not proof the rules ran. Details in the JS Guard reference.
- **LangChain JS `createAgent`:** import `@arcjet/guard/langchain/v1` (`guardTool` + `guardMiddleware` + `langchainContext` only). JS `createAgent` + `createMiddleware({ wrapToolCall })` – not LangGraph `StateGraph`/`ToolNode`, not Python LangChain (`/guards/langchain/`). Optional peers `langchain` `>=1.2.0 <2` and `@langchain/core` `>=1 <2`; no `@langchain/langgraph` peer; no unversioned alias. Authored tools via `guardTool` (plain `ArcjetDenialResult`); unwrapped / MCP via `guardMiddleware` (`wrapToolCall` short-circuit returns a real `ToolMessage`, JSON content, default status). Policy on `wrapToolCall` only. `wrapToolCall` only sees `runtime.configurable.thread_id` as of langchain 1.2.34. `humanInTheLoopMiddleware` is HITL, not a policy gate. A resumed run keeps its `thread_id` (`agent.invoke(new Command({ resume }), config)` — same config, same Sequence); do not mint an id or derive one from the interrupt / resume payload. Until-published — pin `@arcjet/guard` to git SHA `c49abcc1f9afce7d284b6c294d0dcee5916ada86` ([#6248](https://github.com/arcjet/arcjet-js/pull/6248)); not in npm 1.10.0. Details in the JS Guard reference; docs https://docs.arcjet.com/guards/langchain-js/.
- **CrewAI:** import `arcjet.guard.crewai`. There is no `arcjet[crewai]` extra (CrewAI pulls `chromadb`, CVE-2026-45829) — install `crewai>=1.15.3,<2` yourself. Official `crewai` only. Once-per-process `register_arcjet_hooks` / `unregister_arcjet_hooks` / `ArcjetCrewAIHooks` on `PRE_TOOL_CALL` only (POST is never registered; sync; `launch_arcjet_sync`). DENY + fail-closed unavailable raise `HookAborted(reason=..., source="arcjet")`. Agent always sees `Tool execution blocked by hook. Tool: {name}`. Optional `guard_tool` for a standalone `BaseTool` you call yourself (only path that raises `ArcjetDeniedError` / `ArcjetUnavailableError`). `ToolPolicy` / `sanitize_tool_name` / `free_text_arguments`. No `guard_crew`. No inbound/approval helper — screen with core `guard` / `guard_sync` before `crew.kickoff`. `human_input` is HITL. Until-published — pin `arcjet` to git SHA `b1253640ce676b948594beed5fe62450d0e1c77d` ([#224](https://github.com/arcjet/arcjet-py/pull/224)); not in PyPI 0.9.0. Details in the Python Guard reference; docs https://docs.arcjet.com/guards/crewai/.
- **Branch on which rule denied**, not just on `DENY`. Use the per-rule accessors (for example `userLimit.deniedResult(decision)` for retry-after info) or the flat reason string (`decision.reason === "PROMPT_INJECTION"` in JS, `decision.reason == "PROMPT_INJECTION"` in Python) so the error you surface to the caller tells them *why* – "rate limited, retry in 12s" vs "input flagged as prompt injection" – instead of a generic "blocked." Note: guard's `decision.reason` is a flat string literal, unlike the request-based SDK's tagged-helper API. It is `undefined` on ALLOW – typed `Reason | undefined` in JS – so read it after checking the conclusion, or a `strict` build rejects assigning it to a `string`.
- **A denial by one rule still spends the others' budget.** Rules in a single
  `guard()` call are all evaluated, so a request that trips
  `localDetectSensitiveInfo` also consumes a token from a `tokenBucket` in the
  same `rules` array – visible as `TOKEN_BUCKET` ALLOW with a decremented
  `remaining` on a decision whose conclusion is DENY. Fine for the usual case
  (a caller sending PII is a caller you are happy to slow down); split the
  rules across two `guard()` calls if a PII false positive must not drain a
  legitimate user's budget.
- Every rate-limit rule needs a `key` and a `bucket`:
  - **Per-user context** (agent tool calls inside a logged-in session, queue jobs with a `user_id`): use the user/session id as the key.
  - **No user context** (stdio MCP server, single-tenant worker): use a stable identifier you control – instance id, deployment name, or a literal like `"default"`. Just be explicit.
- Check `decision.conclusion === "DENY"` (JS), `decision.conclusion == "DENY"` (Python), or `decision.IsDenied()` / `decision.Conclusion == arcjet.ConclusionDeny` (Go) before proceeding.

#### Conventions outside the Arcjet flow

For everything that *isn't* an Arcjet-specific decision – dev scripts, file/module layout, named-vs-default exports, comment style, env-file naming, type hints, error class patterns – match the project's existing conventions. If the project has no convention yet, default to modern best practice for the language. This skill is opinionated about *where Arcjet goes* and *how its API is used*; it must not reach further than that.

### Step 5: Verify decisions

After wiring up protection, confirm it's actually firing. Three steps:

**1. Type-check / build first.** Run `tsc`, `next build`, `python -m py_compile`, or whatever check command the project uses. Catches wrong imports, wrong rule names, and stale type signatures before the user does.

**2. Trigger a real call so a decision exists to check.** Without one, the Console and CLI are empty and you can't tell whether protection is actually wired up.

- **Request-based**: start the dev server (`npm run dev`, `uvicorn main:app --reload`) and `curl` the protected route. To trip a rate limit, loop the call: `for i in {1..50}; do curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/your-route; done` – expect a mix of `200` and `429` once the limit is hit.
- **Guard**: invoke the protected function directly. A small script that imports the tool or task function and calls it twice (once to allow, once to exceed the limit) is a direct check: `node -e "import('./src/tools.js').then(m => m.getWeather('SF', 'user_123'))"` or `python -c "from worker import process_job; process_job({'user_id': 'user_123'})"`. For MCP servers, send a tool call via the MCP client or inspector. For queue workers, enqueue a real job. Don't try to test Guard by `curl`ing anything – there's no HTTP surface.

**3. Confirm the decision in the Arcjet platform.**

- **CLI**: `npx -y @arcjet/cli@latest requests list --site-id <id>` (request-based) or `... guards list --site-id <id>` (Guard)
- **MCP**: `list-requests` / `list-guards`
- **Console**: https://console.arcjet.com

For deeper investigation: `arcjet requests explain --site-id <id> --request-id <id>` or `arcjet guards explain --site-id <id> --guard-id <id>`.

If you can't run the app in the current environment, tell the user exactly what to do (which command to run, what to look for in the output) instead of silently skipping verification.

### Gotchas

- **Wrong SDK/client**: `@arcjet/guard`, `arcjet.guard`, and Go's `NewGuardClient` are for non-HTTP code. `@arcjet/node` / `@arcjet/next` / Python `arcjet()` / Go `NewClient` are for HTTP routes. Using the wrong one is the most common mistake.
- **Wrong placement**: `protect()` must not be called in Express middleware or Next.js middleware. Call it inside each route handler.
- **Wrong layer for `guard()`**: don't put `guard()` in a `handleToolCall(name, args)` dispatcher – put it inside each specific tool / task function so the `label` and metadata can be hardcoded. In Python LangChain / `create_agent`, use the helper from the Python Guard reference instead of hand-wrapping. JS `createAgent` uses `@arcjet/guard/langchain/v1`, not `@arcjet/guard/langgraph/v1`. Official CrewAI uses `register_arcjet_hooks` (crew-executed tools) or `arcjet.guard.crewai.guard_tool` (a `BaseTool` you call yourself) – not a raw `guard()` in every tool, and not `guard_crew`.
- **Python capture handlers never block**: `ArcjetCaptureHandler` only records. Policy lives in `guard_action` / `guard_tool` / `ArcjetMiddleware`. CrewAI never registers `POST_TOOL_CALL`; the gate is `PRE_TOOL_CALL` + `HookAborted(reason=..., source="arcjet")`.
- **Python helper `success` is not "the action ran"**: `guard_action` / `guard_tool` / `ArcjetMiddleware` write `metadata.outcome`. `success` means the action ran and policy judged all of it. When `on_guard_error="allow"` lets an action run without a full judgement, that event is `degraded` (`degraded` + `decision_id` = judged in part; without an id = judged not at all). `error` wins over `degraded` – do not count a throwing action in a degraded tally. Default `"deny"` still blocks those cases and records `unavailable`. Filter `degraded` and `unavailable` for post-incident review. This is not a Decision field, conclusion, or new `on_guard_error` value. Do not teach CrewAI `register_arcjet_hooks` as recording `degraded` — a proceed there is still `success`. Details in the Python Guard reference.
- **Hand-edited dependency manifests**: don't append `"arcjet": "^1.0.0"` to `package.json` or `arcjet>=1.0.0` to `requirements.txt`. Run the project's package manager so the version is real and the lockfile updates.
- **Double-counting**: Calling `protect()` or `guard()` multiple times for the same operation counts against rate limits multiple times.
- **JS denial envelopes:** one shared `ArcjetDenialResult` payload (`{ arcjetDenied: true, … }`, wording `"Arcjet denied this call …"`). Delivery is per-framework – AI SDK / Mastra / OpenAI Agents return the object (a throw drops the fields); Genkit returns it as completed `toolResponse.output` (a throw drops the fields; `interrupt()` is HITL, not a denial); Claude wraps it in a MCP `CallToolResult` with `isError: true` (a throw is a raw exception; omitting `isError` looks like success); LangGraph Graph API returns the object so `ToolMessage.status` is `success` (do not fabricate `status: "error"`); LangChain JS `createAgent` `guardTool` returns a plain `ArcjetDenialResult` and `guardMiddleware` `wrapToolCall` short-circuit returns a real `ToolMessage` (JSON content, default status; a throw drops the fields; `humanInTheLoopMiddleware` is HITL); Eve `guardTool` still throws `ArcjetDeniedError` (opt in to a returned payload with `onDeny: "result"`). `guardTool` and `guardAction` are different handlers – envelope vs throw. Details in the JS Guard reference.
- **Never hardcode `ARCJET_KEY`** – always use environment variables.

## Choose protections

When you need to pick which rules address the user's concern – bot abuse, rate limits, prompt injection, signup spam, PII, or IP filtering – load [references/choosing_protections.md](references/choosing_protections.md). It maps common problems to Arcjet rules and explains the tradeoffs between strategies (for example token bucket vs sliding window). The mapping doesn't need to be in your context for the rest of the workflow.

## Resources

For exact API signatures, parameter names, and the full set of rules and helpers, read the installed SDK's source – types and docstrings are the source of truth:

- **Python SDK**: https://github.com/arcjet/arcjet-py – `arcjet` package (request protection) and `arcjet.guard` subpackage (non-HTTP guard).
- **JavaScript / TypeScript SDK**: https://github.com/arcjet/arcjet-js – monorepo with framework-specific packages (`@arcjet/next`, `@arcjet/node`, `@arcjet/fastify`, `@arcjet/sveltekit`, `@arcjet/guard`).
- **Go SDK**: https://github.com/arcjet/arcjet-go – `github.com/arcjet/arcjet-go` module with request and guard clients. The published tag is `v0.1.0`; APIs described in the Go references live on the default branch.
- **Docs**: https://docs.arcjet.com – narrative guides, blueprints, and product reference.
- **Console**: https://console.arcjet.com – sites, keys, and decision history.
