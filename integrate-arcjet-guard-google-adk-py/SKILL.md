---
name: integrate-arcjet-guard-google-adk-py
description: Integrate Arcjet Guard into Python Google ADK — assign guard_tool to LlmAgent(before_tool_callback=), put guard_plugin first on Runner(plugins=) so a deny dict with arcjetDenied skips the tool, and read a caller-owned id via google_adk_context. Use when asked to add Arcjet to google-adk, Google ADK Python, rate limit those tools, screen inbound messages, or block prompt injection / PII. This is Python google-adk 2.x, not JS @google/adk and not @google/genai.
license: Apache-2.0
compatibility: Requires Python >= 3.10 and official google-adk>=2.0.0,<3 via the published arcjet[google-adk] extra (safe extra, no chromadb). Install with pip install or uv add. This is LlmAgent.before_tool_callback plus Runner BasePlugin. DENY is a skip dict with arcjetDenied.
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

Official Python `google-adk>=2.0.0,<3` only — not JS `@google/adk`
(`@arcjet/guard/google-adk/v2`, docs
https://docs.arcjet.com/guards/google-adk/), not `@google/genai`,
not Go / Java ADK. Importing `arcjet.guard.google_adk` does not
load LangChain, CrewAI, or the JS adapter. The extra is safe (no
chromadb).

Exports: `guard_tool`, `guard_plugin`, `google_adk_context`. There
is no inbound helper and no approval helper.

Three surfaces, one decision rule:

- **An authored `LlmAgent`** → `guard_tool`. Assign the returned
  callback to `LlmAgent(before_tool_callback=...)`. This is not a
  wrap around `FunctionTool`.
- **Runner-wide / tools you did not attach a callback to** →
  `guard_plugin`. A Runner `BasePlugin` whose
  `before_tool_callback` is the run-wide gate. Put it **first**.
- **Correlation** → `google_adk_context` reads a caller-owned id.
  It never mints. It never reads `invocation_id`. It never reads
  `trace_id`. It never reads session-service auto-ids.

DENY is a skip dict with `arcjetDenied: true` (`ArcjetDenialResult`,
camelCase keys). ADK treats any mapping — including `{}` — as skip
and uses the dict as the tool result, except `{}` is falsy in the
callback chain and the tool would run. `None` is the only allow.
Never return `{}` to allow. Do not raise — a throw is a plugin /
callback error, not skip.

There is no `/guards/google-adk-py/` docs page. Do not invent one.
The JS adapter page is https://docs.arcjet.com/guards/google-adk/
— this skill is the Python teaching. Example:
[`examples/fastapi-google-adk-guard`](https://github.com/arcjet/arcjet-py/tree/main/examples/fastapi-google-adk-guard)
on arcjet-py `main`. Do not invent a second example name.

## The gate is `before_tool_callback` skip dict

Both helpers evaluate Guard and, on `DENY` or unevaluated Guard
under the default `on_guard_error="deny"`, return a deny dict so
the original tool function never runs. Fail closed: always return
that deny dict on error — do not return `None` (that executes the
tool) and do not raise. On ALLOW they return `None`. Same
fail-closed default as
[#196](https://github.com/arcjet/arcjet-py/pull/196): only
`"allow"` fails open; a `DENY` always blocks. Core `guard()` still
fails open (`has_failed_open()`).

`guard_tool` is the positional callback
`(tool, args, tool_context)`. `guard_plugin` is the keyword-only
plugin callback `(*, tool, tool_args, tool_context)`. Same skip
dict. `guard_tool` requires `action`. `guard_plugin` defaults
action to `"{tool_name}.invoked"`.

PluginManager is first-win on a returned dict. If another plugin
returns a dict first, Guard never runs. On ALLOW the plugin
returns `None` and a later agent `before_tool_callback` still
runs — do not stack `guard_plugin` and `guard_tool` on the same
tools or Guard is called twice.

## `require_confirmation` is not a policy gate

`require_confirmation` / `request_confirmation` /
`adk_request_confirmation` / ADK `SecurityPlugin` / confirmation
resume is human-in-the-loop. After a human yes, Guard still runs
on the tool call. Same trap as CrewAI `human_input`, JS
`requireConfirmation`, LangGraph `interrupt()`, OpenAI Agents
`needs_approval`, and Genkit `interrupt()`. There is no inbound
helper and no approval helper.

## Screen inbound before `runner.run_async`

There is no inbound helper. Agent / model callbacks
(`before_model_callback`, `before_run_callback`,
`on_user_message_callback`) are not this policy gate. Call
`aj.guard(...)` in the application and **act on the decision**.
Core `guard()` fails open: `ALLOW` is not proof the rules ran.
Gate on `decision.has_failed_open()` if this call site must fail
closed; `guard_tool` / `guard_plugin` already default to that.

## `actor` / `inputs` — omit and remote rules never fire

A remote policy that declares `actor` or typed `inputs` only
evaluates those values when this call sends them. Pass `actor=`
and `inputs=` on `guard_tool` / `guard_plugin` (and on inbound
`aj.guard(...)`). Build each input with `server_input` /
`local_input` from `arcjet.guard` — that is the Python
`policyInput` equivalent. Do not import JS `policyInput` and do
not invent a second helper.

- **Omit `actor` / `inputs`** and a remote policy that requires
  them never fires. The call still contacts Guard; the remote
  rules just have nothing to read.
- **A resolver that throws is degraded and fail-closes** under the
  default `on_guard_error="deny"`. The tool does not run.
- **`actor` is the authenticated caller**, never a model-produced
  tool argument. An order id or email `to=` the model chose is
  not who is acting. Take `actor` from a signed session, verified
  token, or other server-side identity.

Resolvers see the tool-call envelope: model args plus
`tool_name` (applied last so a tool argument of that name cannot
hide the callback's name).

## Questions to ask the human first

Ask only what you cannot infer from the code; suggest defaults.

1. Which tools are **risky** (external side effects, irreversible,
   spends money, sends messages)? An agent you authored gets
   `guard_tool`. Runner-wide / unwrapped tools get `guard_plugin`.
2. What **limits**? (e.g. "10 lookups/min per user" →
   `TokenBucket`.)
3. Who is the **user** for metadata — an opaque user/tenant ID
   (never PII)? Default: none. That same authenticated id is
   `actor`. Put the conversation / session id you already have on
   `guard_tool` / `guard_plugin` (`session_id=...`) and on
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
   `arcjet.guard.google_adk`. The JS adapter is plugin-only (no
   `guardTool`).
2. **There is no inbound helper.** Screen with core `guard()`
   before `runner.run_async`.
3. **`require_confirmation` / `request_confirmation` is HITL, not
   policy.** Do not use `SecurityPlugin` as the Arcjet gate.
4. **Fail closed = always return a deny dict with `arcjetDenied`
   on error.** Do not raise, do not return `None`, and never
   return `{}`.
5. **`guard_tool` is a callback, not a FunctionTool wrap.** Assign
   it to `LlmAgent(before_tool_callback=...)`.
6. **Do not stack `guard_plugin` and `guard_tool` on the same
   tools.** Plugin ALLOW still reaches the agent callback.
7. **Put Arcjet first** on `Runner(..., plugins=)`.
8. **Correlation is read, never minted.** Never `invocation_id`,
   never `trace_id`, never session auto-ids.
9. **Key rate limits on the authenticated caller**, not a
   model-supplied order id. Same for `actor`.
10. **Omit `actor` / `inputs` and remote rules never fire.** A
    resolver throw fail-closes. Use `server_input` / `local_input`,
    not JS `policyInput`.
11. **Do not hand-wrap every ADK tool with raw `guard()`.**

## Step 1: Install and find the guard client

Install the published extra. Use the package manager the project
already uses — do not pin a git SHA:

```bash
pip install "arcjet[google-adk]"
uv add "arcjet[google-adk]"
```

The extra pulls `google-adk>=2.0.0,<3`. If the agent has no guard
client yet, launch one **once at module scope**:

```python
import os
from arcjet.guard import launch_arcjet

aj = launch_arcjet(key=os.environ["ARCJET_KEY"])
```

## Step 2: Gate an authored agent — `guard_tool`

Build the callback (and the agent) from the **current request's**
authenticated caller. Do not freeze `user_id` / `conversation_id`
at import time.

```python
from google.adk.agents import LlmAgent
from google.adk.tools import FunctionTool
from arcjet.guard import DetectPromptInjection, TokenBucket, launch_arcjet, server_input
from arcjet.guard.google_adk import google_adk_context, guard_plugin, guard_tool

aj = launch_arcjet(key=os.environ["ARCJET_KEY"])
lookup_limit = TokenBucket(
    label="order.looked-up",
    bucket="lookups",
    refill_rate=10,
    interval_seconds=60,
    max_tokens=10,
)
inbound = DetectPromptInjection()
# Per request: authenticated caller + caller-owned conversation id.
user_id = authenticated_user_id
conversation_id = authenticated_conversation_id

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
    before_tool_callback=guard_tool(
        guard=aj,
        action="order.looked-up",
        # Authenticated caller — never a model-produced order id.
        actor=user_id,
        inputs=lambda call: {
            "order_id": server_input.string(str(call.get("order_id", ""))),
        },
        rules=[lookup_limit(key=user_id, requested=1)],
        session_id=conversation_id,
        on_guard_error="deny",
    ),
)
```

Use `action` + `rules` on `guard_tool`. `action` may be a function
of the tool-call envelope (`tool_name` plus `input`). Empty `rules`
still contacts Guard. Key rate limits on the authenticated caller,
not a model-supplied order id.

## Step 3: Gate the Runner — `guard_plugin`

Use this for tools you did not attach `guard_tool` to. Put Arcjet
**first**. Do not also assign `guard_tool` on those same agents.

```python
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService

session_service = InMemorySessionService()
runner = Runner(
    app_name="support",
    agent=agent,
    session_service=session_service,
    # Arcjet first: a deny dict skips the tool before later plugins run.
    plugins=[
        guard_plugin(
            guard=aj,
            action=lambda call: f"{call['tool_name']}.invoked",
            actor=user_id,
            inputs=lambda call: {
                "tool": server_input.string(str(call.get("tool_name", ""))),
            },
            rules=[lookup_limit(key=user_id, requested=1)],
            session_id=conversation_id,
            on_guard_error="deny",
        ),
    ],
)
```

## Step 4: Screen inbound before `runner.run_async`

```python
from google.genai import types

app_context = {"sessionId": conversation_id}
derived = google_adk_context(app_context)
decision = await aj.guard(
    label="message.received",
    actor=user_id,
    inputs={"content": server_input.string(user_text)},
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

## Step 5: Correlation

`google_adk_context` reads a caller-owned id. Preference:
`correlationId` / `correlation_id`, then `sessionId` /
`session_id`, then `conversationId` / `conversation_id` on the
object (or a bare mapping), then the same names on application-owned
`state`, then `correlation_id=` / `session_id=` /
`conversation_id=` kwargs, then an enclosing `arcjet_sequence`.
It never mints an id. It never reads `invocation_id` (ADK always
generates it). It never reads `trace_id`. It never reads
`toolContext.sessionId` / `session.id` (session auto-ids) and
never walks into `.session`. Do not invent a correlation id per
turn. Put the same id on the helper *and* on
`runner.run_async(...)`. If nothing valid remains, the call is
uncorrelated rather than joined to a generated id.

## Verify the integration

1. `python -m py_compile` (or the project's type-check) passes.
2. Exercise inbound PI (before `run_async`, including
   `has_failed_open()`), a `guard_tool` deny-dict skip
   (`arcjetDenied: true`), a `guard_plugin` deny-dict skip, `None`
   execute, first-plugin short-circuit (Arcjet first), no-raise,
   never-`{}`, never-mint, omitted `actor` / `inputs` (remote
   rules silent), a resolver throw (fail-closed deny dict), and
   fail-closed (an unreachable guard → deny dict, never `None`).
   Confirm `require_confirmation` is never treated as the gate
   and that stacking both helpers does not double-call Guard on
   ALLOW.
3. Confirm in the Arcjet Console / CLI that decisions share the
   caller-owned session / conversation id — not an `invocation_id`
   or session auto-id — and that `actor` is the authenticated
   caller.
4. Manual E2E with a real `ARCJET_KEY` is still-to-verify until you
   run it.

Worked example:
[`examples/fastapi-google-adk-guard`](https://github.com/arcjet/arcjet-py/tree/main/examples/fastapi-google-adk-guard)
on arcjet-py `main`. Do not invent a second example name. Do not add
an example in this skills repo.
