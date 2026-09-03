---
name: integrate-arcjet-guard-google-adk-py
description: Integrate Arcjet Guard into Python Google ADK — put guard_plugin first on Runner(plugins=) so before_tool_callback returns a deny dict and skips the tool, and read a caller-owned id via google_adk_context. Use when asked to add Arcjet to google-adk, Google ADK Python, rate limit those tools, screen inbound messages, or block prompt injection / PII. This is Python google-adk 2.x, not JS @google/adk and not @google/genai.
license: Apache-2.0
compatibility: Requires Python >= 3.10 and official google-adk>=2,<3 via arcjet[google-adk] (safe extra, no chromadb). This is Runner + LlmAgent + FunctionTool. Gate is before_tool_callback dict skip. Until-published — pin arcjet to git SHA ADAPTER_SHA; not in PyPI 0.9.0.
metadata:
  author: arcjet
  type: core
  library: arcjet
---

# Integrate Arcjet Guard into Python Google ADK

`arcjet.guard.google_adk` wraps the agent's existing Arcjet client.
It never talks to the Arcjet API itself. Shared Guard fundamentals
(client, rules, labels, decisions, capture, registration) live in
[../arcjet/references/guards_python.md](../arcjet/references/guards_python.md).
Load that reference for anything that is not Google ADK-specific.

Official Python `google-adk>=2,<3` only — not JS `@google/adk`
(`@arcjet/guard/google-adk/v2`, docs
https://docs.arcjet.com/guards/google-adk/), not `@google/genai`,
not Go / Java ADK. Importing `arcjet.guard.google_adk` does not
load LangChain, CrewAI, or the JS adapter. The extra is safe (no
chromadb).

Exports: `guard_plugin`, `google_adk_context`. There is **no
`guard_tool`**. Skip is the plugin return, not throw-from-execute.
There is no inbound helper and no approval helper.

Two surfaces, one decision rule:

- **Tool calls** → `guard_plugin`. A Runner `BasePlugin` whose
  `before_tool_callback` is the run-wide gate. DENY is a dictionary
  (`ArcjetDenialResult`) so ADK skips the tool's `run_async` and the
  model sees the payload. `None` lets the tool execute. Do not raise
  from the callback — a throw is a plugin error, not skip.
- **Correlation** → `google_adk_context` reads a caller-owned id.
  It never mints. It never reads `invocation_id`. It never reads
  `trace_id`. It never reads session-service auto-ids.

There is no `/guards/google-adk-py/` docs page. Do not invent one.
The JS adapter page is https://docs.arcjet.com/guards/google-adk/
— this skill is the Python teaching.

Put Arcjet **first** in `Runner(..., plugins=)`. PluginManager is
first-win; if another plugin returns a dict first, Guard never
runs.

## The gate is `before_tool_callback` dict skip

`guard_plugin` returns a `BasePlugin` for `Runner(..., plugins=)`.
`before_tool_callback` evaluates Guard and, on `DENY` or unevaluated
Guard under the default `on_guard_error="deny"`, returns a deny
dict so the tool never runs. Fail closed: always return that deny
dict on error — do not return `None` (that executes the tool) and
do not raise (PluginManager treats a throw as a plugin error). On
ALLOW it returns `None`. Do not invent a `guard_tool` wrap around
`FunctionTool`. Same fail-closed default as
[#196](https://github.com/arcjet/arcjet-py/pull/196): only `"allow"`
fails open; a `DENY` always blocks. Core `guard()` still fails
open (`has_failed_open()`).

## `require_confirmation` is not a policy gate

`require_confirmation` / `request_confirmation` /
`adk_request_confirmation` / confirmation resume is
human-in-the-loop. After a human yes, Guard still runs on the tool
call. Same trap as CrewAI `human_input`, JS `requireConfirmation`,
LangGraph `interrupt()`, OpenAI Agents `needs_approval`, and Genkit
`interrupt()`. There is no inbound helper and no approval helper.
Do not use ADK `SecurityPlugin` as the Arcjet gate.

## Screen inbound before `runner.run_async`

There is no inbound helper. Agent / model callbacks
(`before_model_callback`, `before_run_callback`) are not this
policy gate. Call `aj.guard(...)` in the application and **act on
the decision**. Core `guard()` fails open: `ALLOW` is not proof
the rules ran. Gate on `decision.has_failed_open()` if this call
site must fail closed; `guard_plugin` already defaults to that.

## Questions to ask the human first

Ask only what you cannot infer from the code; suggest defaults.

1. Which tools are **risky** (external side effects, irreversible,
   spends money, sends messages)? Those are gated by
   `guard_plugin`.
2. What **limits**? (e.g. "10 lookups/min per user" →
   `TokenBucket`.)
3. Who is the **user** for metadata — an opaque user/tenant ID
   (never PII)? Default: none. Put the conversation / session id
   you already have on `guard_plugin(..., session_id=...)` and on
   `runner.run_async(..., session_id=...)`. That id is the
   correlation id, not the user. Do not use `invocation_id` or a
   session-service auto-id.
4. Is an Arcjet outage unacceptable? Every helper defaults to
   `on_guard_error="deny"`. Ask explicitly about inbound screening
   before `runner.run_async`: failing closed there means the run
   does not start, so `"allow"` is a routine and legitimate choice
   at that one call site.

## The things readers get wrong

1. **This is not JS `@arcjet/guard/google-adk/v2`.** Import
   `arcjet.guard.google_adk`.
2. **There is no inbound helper.** Screen with core `guard()`
   before `runner.run_async`.
3. **`require_confirmation` / `request_confirmation` is HITL, not
   policy.** Do not use `SecurityPlugin` as the Arcjet gate.
4. **Fail closed = always return a deny dict on error.** Do not
   raise and do not return `None`.
5. **Correlation is read, never minted.** Never `invocation_id`,
   never `trace_id`, never session auto-ids. Put the same
   caller-owned id on the plugin *and* on `run_async`.
6. **Put Arcjet first.** PluginManager is first-win.
7. **There is no `guard_tool`.** Skip is the plugin return.
8. **Key rate limits on the authenticated caller**, not a
   model-supplied order id.
9. **Do not hand-wrap every ADK tool with raw `guard()`.**

## Step 1: Install and find the guard client

Until-published: PyPI `arcjet` 0.9.0 does not include this module.
Pin `arcjet` to git SHA `ADAPTER_SHA`:

```bash
pip install "arcjet[google-adk] @ git+https://github.com/arcjet/arcjet-py.git@ADAPTER_SHA"
```

If the agent has no guard client yet, launch one **once at module
scope**:

```python
import os
from arcjet.guard import launch_arcjet

aj = launch_arcjet(key=os.environ["ARCJET_KEY"])
```

## Step 2: Gate tool calls — Arcjet first

```python
from google.adk.agents import LlmAgent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.adk.tools import FunctionTool
from arcjet.guard import DetectPromptInjection, TokenBucket, launch_arcjet
from arcjet.guard.google_adk import google_adk_context, guard_plugin

aj = launch_arcjet(key=os.environ["ARCJET_KEY"])
lookup_limit = TokenBucket(
    label="order.looked-up",
    bucket="lookups",
    refill_rate=10,
    interval_seconds=60,
    max_tokens=10,
)
inbound = DetectPromptInjection()
user_id = authenticated_user_id

def lookup_order(order_id: str) -> dict:
    """Look up an order by ID."""
    return {"order_id": order_id, "status": "shipped"}

# require_confirmation=True is HITL — not this policy gate
lookup = FunctionTool(func=lookup_order)

agent = LlmAgent(
    name="support_agent",
    description="Help the user.",
    instruction="Help the user.",
    tools=[lookup],
)

session_service = InMemorySessionService()
runner = Runner(
    app_name="support",
    agent=agent,
    session_service=session_service,
    # Arcjet first: a deny dict skips run_async before later plugins run.
    plugins=[
        guard_plugin(
            guard=aj,
            action="order.looked-up",
            rules=[lookup_limit(key=user_id, requested=1)],
            session_id=conversation_id,
            on_guard_error="deny",
        ),
    ],
)
```

Use `action` + `rules` on `guard_plugin`. `action` may be a function
of the tool call when more than one tool shares the plugin. Key rate
limits on the authenticated caller, not a model-supplied order id.

## Step 3: Screen inbound before `runner.run_async`

```python
from google.genai import types

app_context = {"session_id": conversation_id}
derived = google_adk_context(app_context)
decision = await aj.guard(
    label="message.received",
    rules=[inbound(user_text)],
    correlation_id=derived.correlation_id,
)
if decision.conclusion == "DENY":
    raise RuntimeError("message blocked")
if decision.has_failed_open():
    raise RuntimeError("inbound guard unavailable")

async for event in runner.run_async(
    user_id=user_id,
    session_id=conversation_id,
    new_message=types.Content(
        role="user",
        parts=[types.Part(text=user_text)],
    ),
):
    _ = event
```

There is no inbound helper.

## Step 4: Correlation

`google_adk_context` reads a caller-owned id. Preference:
`correlation_id`, then `session_id`, then `conversation_id` (snake
or camelCase) on a caller-owned wrap, then the same names on
`guard_plugin(..., session_id=...)`, then session `state` as a last
resort. It never mints an id. It never reads `invocation_id` (ADK
always generates it). It never reads `trace_id`. It never reads
`tool_context.session_id` / `session.id` (session auto-ids). Do not
invent a correlation id per turn. Put the same id on
`guard_plugin(...)` *and* on `runner.run_async(...)`. If nothing
valid remains, the call is uncorrelated rather than joined to a
generated id.

## Verify the integration

1. `python -m py_compile` (or the project's type-check) passes.
2. Exercise inbound PI (before `run_async`, including
   `has_failed_open()`), a plugin deny-dict skip, `None` execute,
   first-plugin short-circuit (Arcjet first), no-raise, never-mint,
   and fail-closed (an unreachable guard → deny dict, never
   `None`). Confirm `require_confirmation` is never treated as the
   gate.
3. Confirm in the Arcjet Console / CLI that decisions share the
   caller-owned session / conversation id — not an `invocation_id`
   or session auto-id.
4. Manual E2E with a real `ARCJET_KEY` is still-to-verify until you
   run it.

Do not invent a Google ADK Python example name. Do not add an
example in this skills repo. Do not cite an example app until one
exists.
