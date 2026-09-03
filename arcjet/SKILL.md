---
name: arcjet
license: Apache-2.0
description: Add Arcjet security protection to HTTP routes, AI agent tool calls, MCP servers, background jobs, and queue workers. Covers rate limiting, bot detection, email validation, prompt injection, sensitive information blocking (including Rampart NER), content moderation, capture/flush, and abuse prevention. Works in JavaScript/TypeScript, Python, and Go across Next.js, Express, Fastify, SvelteKit, Remix, Bun, Deno, NestJS, FastAPI, Flask, net/http, Vercel AI SDK, Eve, Mastra, LangChain, LangGraph, OpenAI Agents, Genkit, Google ADK, Strands Agents, TanStack AI, Claude Agent SDK, Claude Managed Agents, Cloudflare Think, and other non-HTTP contexts. Official Python adapters (including Google ADK) and Cloudflare Think have dedicated integrate-arcjet-guard skills. Use when the user wants security, rate limiting, bot protection, or abuse prevention – "protect my API," "rate limit tool calls," "block bots," "secure my endpoint," or "prevent abuse" – even without naming Arcjet.
metadata:
  author: arcjet
---

# Arcjet

## Contents

- [Add Arcjet protection to your app](#add-arcjet-protection-to-your-app)
- [Choose protections](#choose-protections)
- [Resources](#resources)

Python Guard adapters for LangChain, CrewAI, OpenAI Agents, Claude Agent SDK, Claude Managed Agents, Strands Agents, and Google ADK are dedicated skills (see Step 3). Cloudflare Think is a dedicated JS skill. Shared Guard fundamentals stay in the language references.

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

A single project can use both – for example, request-based on API routes and Guard on agent tool calls. If the project already uses Vercel AI SDK, Vercel Eve, Mastra, LangChain, LangGraph, CrewAI, OpenAI Agents, Genkit, Google ADK, Python Strands Agents, JS Strands Agents, TanStack AI, the Claude Agent SDK, Claude Managed Agents, or Cloudflare Think, prefer the versioned Guard wrappers over hand-wrapping every tool. In Python, load the dedicated skill for that adapter (table below) — not a raw `guard()` around every callable, and not the JS `@arcjet/guard/...` path. JS LangChain `createAgent` is `@arcjet/guard/langchain/v1`, not the LangGraph Graph API adapter. JS Google ADK is `@arcjet/guard/google-adk/v2` (docs `/guards/google-adk/`). Python Google ADK is `arcjet.guard.google_adk` — load [integrate-arcjet-guard-google-adk-py](../integrate-arcjet-guard-google-adk-py/SKILL.md). JS Strands Agents is `@arcjet/guard/strands-agents/v1` (docs `/guards/strands-agents/`). TanStack AI is `@arcjet/guard/tanstack-ai/v0` (`guardMiddleware` + `tanstackAiContext` only), not Vercel AI SDK and not TanStack Start HTTP `protect()`. JS Claude Agent SDK is `@arcjet/guard/claude-agent-sdk/v0` (docs `/guards/claude-agent-sdk/`). JS OpenAI Agents is `@arcjet/guard/openai-agents/v0` (docs `/guards/openai-agents/`). JS Claude Managed Agents is `@arcjet/guard/claude-managed-agents/v0` (hosted `@anthropic-ai/sdk` sessions), not `@arcjet/guard/claude-agent-sdk/v0` (local `query()`). Cloudflare Think is `@arcjet/guard/cloudflare-think/v0` — load [integrate-arcjet-guard-cloudflare-think](../integrate-arcjet-guard-cloudflare-think/SKILL.md); not Vercel AI SDK and not HTTP `protect()`.

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

When the project already uses an official Python agent framework, load the dedicated skill instead of the long adapter sections that used to live in the Python Guard reference:

| Python framework | Import | Skill |
| --- | --- | --- |
| LangChain (`BaseTool` / `create_agent`) | `arcjet.guard.langchain` | [integrate-arcjet-guard-langchain-py](../integrate-arcjet-guard-langchain-py/SKILL.md) |
| CrewAI | `arcjet.guard.crewai` | [integrate-arcjet-guard-crewai](../integrate-arcjet-guard-crewai/SKILL.md) |
| OpenAI Agents | `arcjet.guard.openai_agents` | [integrate-arcjet-guard-openai-agents-py](../integrate-arcjet-guard-openai-agents-py/SKILL.md) |
| Claude Agent SDK | `arcjet.guard.claude_agent_sdk` | [integrate-arcjet-guard-claude-agent-sdk-py](../integrate-arcjet-guard-claude-agent-sdk-py/SKILL.md) |
| Claude Managed Agents | `arcjet.guard.claude_managed_agents` | [integrate-arcjet-guard-claude-managed-agents-py](../integrate-arcjet-guard-claude-managed-agents-py/SKILL.md) |
| Strands Agents | `arcjet.guard.strands_agents` | [integrate-arcjet-guard-strands-agents-py](../integrate-arcjet-guard-strands-agents-py/SKILL.md) |
| Google ADK | `arcjet.guard.google_adk` | [integrate-arcjet-guard-google-adk-py](../integrate-arcjet-guard-google-adk-py/SKILL.md) |

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
- Treat client-IP provenance as security configuration. JavaScript, Python, and Go may fall back to common forwarding headers when no usable public address is available and produce one `client_ip_provenance="unverified-header"` warning for the lifetime of each SDK client instance. Configure every trusted proxy and verify the application is reachable only through infrastructure that overwrites or safely appends forwarding headers. Never silence the warning by copying a client-controlled header into a manual override.
- If the application already has an independently trusted client IP, pass it explicitly: `ipSrc` (JS), `ip_src` (Python; also set `disable_automatic_ip_detection=True` when constructing the client), or `WithIPSrc` (Go). The SDKs reject malformed values, although JS treats an empty `ipSrc` as omitted. Syntax validation does not prove provenance. Before shipping, inspect representative requests with JS `clientIpDetails()` / `findIpDetails()`, Python `client_ip_details()`, or Go `ClientIPDetails()`.
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
- **JS framework wrappers** (`@arcjet/guard/vercel-ai/v7`, `@arcjet/guard/vercel-eve/v0`, `@arcjet/guard/mastra/v1`, `@arcjet/guard/langgraph/v1`, `@arcjet/guard/langchain/v1`, `@arcjet/guard/claude-agent-sdk/v0`, `@arcjet/guard/claude-managed-agents/v0`, `@arcjet/guard/openai-agents/v0`, `@arcjet/guard/genkit/v1`, `@arcjet/guard/google-adk/v2`, `@arcjet/guard/tanstack-ai/v0`, `@arcjet/guard/strands-agents/v1`, `@arcjet/guard/cloudflare-think/v0`) fail closed by default when Guard is unavailable. Import the versioned path – unversioned aliases do not resolve. JS `createAgent` (`@arcjet/guard/langchain/v1`) is not Python LangChain and not LangGraph JS. JS Google ADK (`@arcjet/guard/google-adk/v2`) is not a `guardTool` adapter. TanStack AI (`@arcjet/guard/tanstack-ai/v0`) is not Vercel AI SDK and not TanStack Start HTTP `protect()`. JS Strands Agents (`@arcjet/guard/strands-agents/v1`) is official `@strands-agents/sdk`, not Python `strands`. JS Claude Managed Agents (`@arcjet/guard/claude-managed-agents/v0`) is not Claude Agent SDK (`@arcjet/guard/claude-agent-sdk/v0`). Cloudflare Think (`@arcjet/guard/cloudflare-think/v0`) is not Vercel AI SDK — load [integrate-arcjet-guard-cloudflare-think](../integrate-arcjet-guard-cloudflare-think/SKILL.md).
- **Python framework wrappers** fail closed by default when Guard is unavailable. `guard_action` / `guard_action_sync` is core `arcjet.guard` (no extra) for any callable. Official LangChain, CrewAI, OpenAI Agents, Claude Agent SDK, Claude Managed Agents, Strands Agents, and Google ADK adapters live in the dedicated skills listed in Step 3 — load that skill for extras, pins, denial envelopes, and HITL traps. Do not mix adapters. Do not import a JS `@arcjet/guard/...` path from Python.
- **Eve `guardApproval`:** `approval` is one field – a function (request-time only) or `{ request, response }`. Optional peer `eve` `>=0.34.0 <1` (still 0.x); Node.js ≥ 24 still applies. Do not compose with Eve `always()` / `once()` / `never()`. Request/response + HITL details are in the JS Guard reference.
- **OpenAI Agents:** import `@arcjet/guard/openai-agents/v0` (`guardTool` + `openaiAgentsContext` only). Text `Agent` + `run()` + authored `tool()` – not Realtime, Sandbox, hosted, MCP, or `asTool`. Screen inbound before `run()` and act on that `guard()` decision: core `guard()` fails open, so ALLOW is not proof the rules ran. Details in the JS Guard reference.
- **Genkit:** import `@arcjet/guard/genkit/v1` (`guardTool` + `guardMiddleware` + `genkitContext` only). JS `genkit()` + `ai.defineTool` + `ai.generate` – not Go / Python Genkit. Authored tools via `guardTool`; filesystem / MCP / unwrapped via `guardMiddleware` on `generate({ use })` (needs Genkit >= 1.33). Screen inbound before `generate()` / `chat.send()` and act on that `guard()` decision: core `guard()` fails open, so ALLOW is not proof the rules ran. Details in the JS Guard reference.
- **Google ADK (JS):** import `@arcjet/guard/google-adk/v2` (`guardPlugin` + `googleAdkContext` only — **no `guardTool`**). JS `@google/adk` `>=2 <3` `Runner` + `LlmAgent` + `FunctionTool`. Gate is Runner `BasePlugin.beforeToolCallback`: a deny dict skips `runAsync`; `undefined` executes. Fail closed = always return a deny dict on error. Put the Arcjet plugin first. HITL (`requireConfirmation` / `requestConfirmation` / `adk_request_confirmation`) is not a policy gate. Correlation from a caller-owned session id via `googleAdkContext` — never mint, never `traceId`. No unversioned `@arcjet/guard/google-adk` alias. Until-published — pin `@arcjet/guard` to git SHA `41ef36816e7174f1b0288d28217e63fa14114307`; not in npm 1.10.0. Details in the JS Guard reference; docs https://docs.arcjet.com/guards/google-adk/. Example: [`examples/google-adk-agent`](https://github.com/arcjet/examples/tree/main/examples/google-adk-agent) (pins `41ef3681`; no verify fixture).
- **Google ADK (Python):** load [integrate-arcjet-guard-google-adk-py](../integrate-arcjet-guard-google-adk-py/SKILL.md). Extra `arcjet[google-adk]`. Not JS `@arcjet/guard/google-adk/v2`.
- **Cloudflare Think (JS):** load [integrate-arcjet-guard-cloudflare-think](../integrate-arcjet-guard-cloudflare-think/SKILL.md). Import `@arcjet/guard/cloudflare-think/v0`. Official `@cloudflare/think` `>=0.3.0`. Gate is `beforeToolCall` block/substitute. Fail closed. Not HITL/`needsApproval`. Not `@arcjet/guard/vercel-ai/v7`. Until-published — pin `@arcjet/guard` to git SHA `ADAPTER_SHA`; not in npm 1.11.0. Do not cite an example app until one exists.
- **LangChain JS `createAgent`:** import `@arcjet/guard/langchain/v1` (`guardTool` + `guardMiddleware` + `langchainContext` only). JS `createAgent` + `createMiddleware({ wrapToolCall })` – not LangGraph `StateGraph`/`ToolNode`, not Python LangChain (`/guards/langchain/`). Optional peers `langchain` `>=1.2.0 <2` and `@langchain/core` `>=1 <2`; no `@langchain/langgraph` peer; no unversioned alias. Authored tools via `guardTool` (plain `ArcjetDenialResult`); unwrapped / MCP via `guardMiddleware` (`wrapToolCall` short-circuit returns a real `ToolMessage`, JSON content, default status). Policy on `wrapToolCall` only. `wrapToolCall` only sees `runtime.configurable.thread_id` as of langchain 1.2.34. `humanInTheLoopMiddleware` is HITL, not a policy gate. A resumed run keeps its `thread_id` (`agent.invoke(new Command({ resume }), config)` — same config, same Sequence); do not mint an id or derive one from the interrupt / resume payload. Until-published — pin `@arcjet/guard` to git SHA `c49abcc1f9afce7d284b6c294d0dcee5916ada86` ([#6248](https://github.com/arcjet/arcjet-js/pull/6248)); not in npm 1.10.0. Details in the JS Guard reference; docs https://docs.arcjet.com/guards/langchain-js/.
- **CrewAI (Python):** load [integrate-arcjet-guard-crewai](../integrate-arcjet-guard-crewai/SKILL.md). Official `crewai` only; no `arcjet[crewai]` extra.
- **Claude Managed Agents (JS):** hosted harness (`client.beta.sessions`) — Anthropic runs the loop and built-in tools. Not Claude Agent SDK local `query()` / `PreToolUse`. Import `@arcjet/guard/claude-managed-agents/v0` (`guardCustomTool` + `guardEvents` + `claudeManagedAgentsContext` only). Until-published — not in npm 1.10.0; pin `@arcjet/guard` to git SHA `cb35c8f92c3a2fb63fbeb9b386d79b1878c19d92`. Optional peer `@anthropic-ai/sdk` `>=0.86.0 <1` — not `@anthropic-ai/claude-agent-sdk`. JS worked example: [`examples/claude-managed-agents`](https://github.com/arcjet/arcjet-js/tree/main/examples/claude-managed-agents). Default `always_allow` means no customer pre-exec for bash/files. Real gates: inbound `user.message` (`guardEvents` — DENY does not send) and custom tools on `agent.custom_tool_use` (`guardCustomTool`; DENY posts `user.custom_tool_result` with `is_error` true). `always_ask` + `user.tool_confirmation` is opt-in confirmation, not HITL-as-policy. Never mint. Do not correlate on Anthropic `session.id` / `sevt_…`. Details in the JS Guard reference; docs https://docs.arcjet.com/guards/claude-managed-agents/.
- **Claude Managed Agents (Python):** load [integrate-arcjet-guard-claude-managed-agents-py](../integrate-arcjet-guard-claude-managed-agents-py/SKILL.md). Not `arcjet.guard.claude_agent_sdk`.
- **TanStack AI:** import `@arcjet/guard/tanstack-ai/v0` (`guardMiddleware` + `tanstackAiContext` only — do **not** use `guardTool`; TanStack swallows an `execute` throw). Official `@tanstack/ai` `chat({ middleware })` + authored `tool({ execute })` – not Vercel AI SDK (`ai` / `@arcjet/guard/vercel-ai/v7`), not TanStack Start HTTP `protect()`, not TanStack's own `contentGuardMiddleware`. Default DENY is `onBeforeToolCall` skip with `ArcjetDenialResult`. Optional `onDeny: "abort"` returns `{ type: "abort", reason }` and stops the run (real DENY only; unavailable stays skip; the model does not get `ArcjetDenialResult`). Put Arcjet first in `middleware` (`onBeforeToolCall` is first-win). Inbound `guard()` before `chat()` does not brand tools and does not skip the middleware. `needsApproval` / `defineInterrupt` / `onInterruptBoundary` is HITL, not a policy gate (after a human yes, Guard still runs). No `guardInbound` — screen with `guard()` before `chat()` and act on that decision: core `guard()` fails open, so ALLOW is not proof the rules ran. Correlation from caller-owned context id only — never mint, never `threadId` / `requestId` / `streamId` / `traceId`. Optional peer `@tanstack/ai` `>=0.8.0 <1`; no unversioned alias. Fail closed (`onGuardError: "deny"`). The existing `tanstack-agent` example stays with Runtime. Until-published — pin `@arcjet/guard` to git SHA `d730d57a124f03843f085d41f64b0355a09d1eab` ([#6260](https://github.com/arcjet/arcjet-js/pull/6260)); not in npm 1.11.0. Details in the JS Guard reference; docs https://docs.arcjet.com/guards/tanstack-ai/.
- **Strands Agents (JS):** import `@arcjet/guard/strands-agents/v1` (`guardTool` + `guardHooks` + `strandsAgentContext` only). Official `@strands-agents/sdk` `Agent` + `invoke()` / `stream()` + authored `tool({ callback })` – not Python `strands`. Authored tools via `guardTool` (plain `ArcjetDenialResult`; `FunctionTool` wraps it in a `JsonBlock`). Unwrapped / MCP / vended via `guardHooks` (a Plugin on `Agent({ plugins })`). Gate is `BeforeToolCallEvent.cancel` (string = JSON of `ArcjetDenialResult`). Do not use `BeforeToolsEvent.cancel` (skips per-tool hooks). `event.interrupt()` is HITL, not a policy gate. No `guardInbound` — screen with `guard()` before `invoke()` / `stream()` and act on that decision: core `guard()` fails open, so ALLOW is not proof the rules ran. Correlation from caller-owned `invocationState.correlationId` → `sessionId` → `requestId` — never `traceId`, never `agent.id`, never `SessionManager`, never mint. Optional peer `@strands-agents/sdk` `>=1.1.0 <2`; no unversioned alias. Fail closed (`onGuardError: "deny"`). The existing `strands-agent` example stays with Runtime. Until-published — pin `@arcjet/guard` to git SHA `f3a07ee675cbdd812a36dcb778ee4325d2f89617` ([#6251](https://github.com/arcjet/arcjet-js/pull/6251)); not in npm 1.10.0. Details in the JS Guard reference; docs https://docs.arcjet.com/guards/strands-agents/.
- **Claude Agent SDK (Python):** load [integrate-arcjet-guard-claude-agent-sdk-py](../integrate-arcjet-guard-claude-agent-sdk-py/SKILL.md). Not the JS adapter and not Claude Managed Agents.
- **OpenAI Agents (Python):** load [integrate-arcjet-guard-openai-agents-py](../integrate-arcjet-guard-openai-agents-py/SKILL.md). Not the JS adapter.
- **Strands Agents (Python):** load [integrate-arcjet-guard-strands-agents-py](../integrate-arcjet-guard-strands-agents-py/SKILL.md). Not JS `@arcjet/guard/strands-agents/v1`.
- **LangChain (Python):** load [integrate-arcjet-guard-langchain-py](../integrate-arcjet-guard-langchain-py/SKILL.md). Not JS `createAgent` and not LangGraph JS.
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
- **Wrong layer for `guard()`**: don't put `guard()` in a `handleToolCall(name, args)` dispatcher – put it inside each specific tool / task function so the `label` and metadata can be hardcoded. In Python, if the project already uses LangChain, CrewAI, OpenAI Agents, Claude Agent SDK, Claude Managed Agents, Strands Agents, or Google ADK, load the dedicated skill from Step 3 instead of hand-wrapping. JS `createAgent` uses `@arcjet/guard/langchain/v1`, not `@arcjet/guard/langgraph/v1`. Official JS Google ADK uses `@arcjet/guard/google-adk/v2` `guardPlugin` on the Runner (no `guardTool`) – not a raw `guard()` in every tool. Official JS Strands Agents uses `@arcjet/guard/strands-agents/v1`, not a raw `guard()` in every tool. Official TanStack AI uses `@arcjet/guard/tanstack-ai/v0` `guardMiddleware` on `chat({ middleware })`, not `guardTool` and not a raw `guard()` in every `execute`. JS OpenAI Agents stays on `@arcjet/guard/openai-agents/v0`. JS Claude Managed Agents uses `guardCustomTool` / `guardEvents` — not Claude Agent SDK `guardTool` / `guardHooks` / `PreToolUse`. Official Cloudflare Think uses `@arcjet/guard/cloudflare-think/v0` `beforeToolCall` block/substitute — load [integrate-arcjet-guard-cloudflare-think](../integrate-arcjet-guard-cloudflare-think/SKILL.md); not `@arcjet/guard/vercel-ai/v7`.
- **Python adapter denials and HITL:** load the dedicated Python skill. Shared rule: capture handlers never block; HITL (`human_input`, `can_use_tool`, `needs_approval`, `event.interrupt()`, `always_ask`, `require_confirmation`) is not a policy gate.
- **Python helper `success` is not "the action ran"**: `guard_action` / `guard_tool` / `ArcjetMiddleware` write `metadata.outcome`. `success` means the action ran and policy judged all of it. When `on_guard_error="allow"` lets an action run without a full judgement, that event is `degraded` (`degraded` + `decision_id` = judged in part; without an id = judged not at all). `error` wins over `degraded` – do not count a throwing action in a degraded tally. Default `"deny"` still blocks those cases and records `unavailable`. Filter `degraded` and `unavailable` for post-incident review. This is not a Decision field, conclusion, or new `on_guard_error` value. Do not teach CrewAI `register_arcjet_hooks` as recording `degraded` — a proceed there is still `success`. Details in the Python Guard reference.
- **Hand-edited dependency manifests**: don't append `"arcjet": "^1.0.0"` to `package.json` or `arcjet>=1.0.0` to `requirements.txt`. Run the project's package manager so the version is real and the lockfile updates.
- **Double-counting**: Calling `protect()` or `guard()` multiple times for the same operation counts against rate limits multiple times.
- **Client-IP warning bypass**: never "fix" an `unverified-header` warning by reading `X-Forwarded-For` yourself and passing it as `ipSrc`, `ip_src`, or `WithIPSrc`. That relabels attacker-controlled input as manual/trusted. Configure the real ingress and trusted proxies, then verify the SDK provenance API instead.
- **JS denial envelopes:** one shared `ArcjetDenialResult` payload (`{ arcjetDenied: true, … }`, wording `"Arcjet denied this call …"`). Delivery is per-framework – AI SDK / Mastra / OpenAI Agents return the object (a throw drops the fields); Genkit returns it as completed `toolResponse.output` (a throw drops the fields; `interrupt()` is HITL, not a denial); Claude Agent SDK wraps it in a MCP `CallToolResult` with `isError: true` (a throw is a raw exception; omitting `isError` looks like success); Claude Managed Agents posts `user.custom_tool_result` with `is_error: true` (a throw leaves the hosted session idle; omitting `is_error` looks like success; this is not Claude Agent SDK `structuredContent`); LangGraph Graph API returns the object so `ToolMessage.status` is `success` (do not fabricate `status: "error"`); LangChain JS `createAgent` `guardTool` returns a plain `ArcjetDenialResult` and `guardMiddleware` `wrapToolCall` short-circuit returns a real `ToolMessage` (JSON content, default status; a throw drops the fields; `humanInTheLoopMiddleware` is HITL); Google ADK `guardPlugin` returns the object as a `beforeToolCallback` deny dict (skips `runAsync`; `undefined` executes; a throw is a raw exception; `requireConfirmation` is HITL); Cloudflare Think `beforeToolCall` default DENY is `{ action: "substitute", output: ArcjetDenialResult }` (optional `onDeny: "block"` uses `{ action: "block", reason }` and drops the fields; a throw is a raw exception; `needsApproval` is HITL; not Vercel AI SDK); TanStack AI `guardMiddleware` default DENY is `onBeforeToolCall` skip with `ArcjetDenialResult` (optional `onDeny: "abort"` stops the run on real DENY only — unavailable stays skip; an `execute` throw is swallowed; there is no `guardTool`; `needsApproval` / `defineInterrupt` / `onInterruptBoundary` is HITL); Strands Agents `guardTool` returns a plain `ArcjetDenialResult` and `guardHooks` sets `BeforeToolCallEvent.cancel` to the JSON string of the payload (`event.interrupt()` is HITL, not a denial; `cancel: true` and `BeforeToolsEvent.cancel` drop the fields); Eve `guardTool` still throws `ArcjetDeniedError` (opt in to a returned payload with `onDeny: "result"`). `guardTool` and `guardAction` are different handlers – envelope vs throw. Details in the JS Guard reference.
- **Never hardcode `ARCJET_KEY`** – always use environment variables.

## Choose protections

When you need to pick which rules address the user's concern – bot abuse, rate limits, prompt injection, signup spam, PII, or IP filtering – load [references/choosing_protections.md](references/choosing_protections.md). It maps common problems to Arcjet rules and explains the tradeoffs between strategies (for example token bucket vs sliding window). The mapping doesn't need to be in your context for the rest of the workflow.

## Resources

For exact API signatures, parameter names, and the full set of rules and helpers, read the installed SDK's source – types and docstrings are the source of truth:

- **Python SDK**: https://github.com/arcjet/arcjet-py – `arcjet` package (request protection) and `arcjet.guard` subpackage (non-HTTP guard).
- **Python Guard integration skills**: [integrate-arcjet-guard-langchain-py](../integrate-arcjet-guard-langchain-py/SKILL.md), [integrate-arcjet-guard-crewai](../integrate-arcjet-guard-crewai/SKILL.md), [integrate-arcjet-guard-openai-agents-py](../integrate-arcjet-guard-openai-agents-py/SKILL.md), [integrate-arcjet-guard-claude-agent-sdk-py](../integrate-arcjet-guard-claude-agent-sdk-py/SKILL.md), [integrate-arcjet-guard-claude-managed-agents-py](../integrate-arcjet-guard-claude-managed-agents-py/SKILL.md), [integrate-arcjet-guard-strands-agents-py](../integrate-arcjet-guard-strands-agents-py/SKILL.md), [integrate-arcjet-guard-google-adk-py](../integrate-arcjet-guard-google-adk-py/SKILL.md).
- **JavaScript Guard integration skills**: [integrate-arcjet-guard-cloudflare-think](../integrate-arcjet-guard-cloudflare-think/SKILL.md). JS Google ADK remains `@arcjet/guard/google-adk/v2` in this skill / the JS Guard reference (the packaged JS skill ships in `@arcjet/guard`).
- **JavaScript / TypeScript SDK**: https://github.com/arcjet/arcjet-js – monorepo with framework-specific packages (`@arcjet/next`, `@arcjet/node`, `@arcjet/fastify`, `@arcjet/sveltekit`, `@arcjet/guard`).
- **Go SDK**: https://github.com/arcjet/arcjet-go – `github.com/arcjet/arcjet-go` module with request and guard clients. The published tag is `v0.1.0`; APIs described in the Go references live on the default branch.
- **Docs**: https://docs.arcjet.com – narrative guides, blueprints, and product reference.
- **Console**: https://console.arcjet.com – sites, keys, and decision history.
