# Python Guard

## Contents

- [What Guard is](#what-guard-is)
- [Installation](#installation)
- [Architecture: why things go where they do](#architecture-why-things-go-where-they-do)
- [Choose a rate limit strategy](#choose-a-rate-limit-strategy)
- [Content scanning rules](#content-scanning-rules)
- [Decision handling](#decision-handling)
- [Async vs sync](#async-vs-sync)
- [Capture and flush](#capture-and-flush)
- [Optional registration](#optional-registration)
- [Framework helpers](#framework-helpers)
- [Key patterns](#key-patterns)

## What Guard is

Guard protects code paths that don't have an HTTP request – tool calls, agent loops, queue consumers, background jobs. It's part of the `arcjet` package (≥ 0.7.0) but uses a different entry point (`arcjet.guard`) from the HTTP request protection (`arcjet`). Features called out as 0.9.0 in the following sections still apply. Capture, registration, Rampart, nested metadata, and threat/billing are in **`arcjet` 0.10.0b1 / main**. `ModerateContent` (and the 2000&nbsp;ms default request timeout for Guard; `protect()` matches on `main`) are on `main` only. There's no request object to inspect, so you pass explicit context (labels, keys, text to scan) at each call site. On `main`, prefer `guard_action` / `guard_tool` / `ArcjetMiddleware` when they fit – see [Framework helpers](#framework-helpers). Official CrewAI uses `arcjet.guard.crewai` (no extra; install CrewAI yourself).

**Version compatibility:** Python ≥ 3.10 (same as the request SDK – they're shipped together in the `arcjet` package). If the project's Python is older, warn the user and stop.

Needs `libgcc` for the bundled WebAssembly runtime. Most Linux distributions include this by default, but Alpine Linux does not – run `apk add libgcc` first, otherwise `import arcjet` fails with `OSError: Error loading shared library libgcc_s.so.1`.

> _Published PyPI release last verified: `arcjet` **v0.9.0** on **June 30, 2026**. GitHub has a **v0.10.0b1** pre-release (**August 12, 2026**) that is **not on PyPI** – `pip install arcjet` still resolves 0.9.0. APIs newer than 0.9.0 live in 0.10.0b1 / main. `ModerateContent` (graduated name) and the 2000&nbsp;ms default request timeout (Guard; `protect()` matches on `main`) are on `main`; 0.10.0b1 still exports `experimental_ModerateContent` (class exists but is not in `__all__`) and Guard still defaults to 1000&nbsp;ms. `guard_action` / `guard_tool` / `ArcjetMiddleware` / `ArcjetCaptureHandler` are on `main` only ([arcjet-py#195](https://github.com/arcjet/arcjet-py/pull/195), [#196](https://github.com/arcjet/arcjet-py/pull/196)) – not in 0.9.0 or 0.10.0b1. `arcjet.guard.crewai` is until-published – PyPI `arcjet` 0.9.0 does not include the module, and there is no `arcjet[crewai]` extra (CrewAI pulls `chromadb`, CVE-2026-45829). Teaching is pinned to arcjet-py merge `b1253640ce676b948594beed5fe62450d0e1c77d` ([#224](https://github.com/arcjet/arcjet-py/pull/224)). Install CrewAI yourself (`pip install "crewai>=1.15.3,<2"`) and pin `arcjet` to that git SHA. Read the installed package's types before using either. Check `requires-python` in [`pyproject.toml`](https://github.com/arcjet/arcjet-py/blob/main/pyproject.toml)._

## Installation

Install with whichever package manager the project already uses (`pip install`, `uv add`, or `poetry add`) – don't hand-edit `requirements.txt` with a guessed version (`arcjet>=1.0.0` doesn't exist; the current minor release line is `0.x`):

```bash
pip install arcjet
```

Guard is included in the `arcjet` package – no separate install. LangChain helpers need an extra (`arcjet[langchain]` or `arcjet[langchain-agents]`). Official CrewAI uses `arcjet.guard.crewai` with no extra – install `crewai>=1.15.3,<2` yourself and pin `arcjet` to git SHA `b1253640ce676b948594beed5fe62450d0e1c77d` until that module is on PyPI. See [Framework helpers](#framework-helpers). Read the installed package's types and docstrings for the full API surface.

## Architecture: why things go where they do

### Client at module scope

```python
import os
from arcjet.guard import launch_arcjet

arcjet = launch_arcjet(key=os.environ["ARCJET_KEY"])
```

Use `launch_arcjet` for async code, `launch_arcjet_sync` for sync. The client holds a persistent connection to the Arcjet decision service. Creating it inside a function means a new connection per call.

### Rules at module scope

Rate limit state is tracked server-side by the combination of `bucket` and other configuration properties, so recreating rules per call won't break counting. However, defining rules at module scope is still best practice because:

- It makes the per-rule result accessors (for example `user_limit.denied_result(decision)`) work – you need a stable reference to call methods on.
- It avoids unnecessary object allocation on every invocation.
- It keeps rule configuration visible and centralized.

```python
from arcjet.guard import TokenBucket, DetectPromptInjection

# WORKS but awkward – no stable reference for result inspection
def handle_tool():
    limit = TokenBucket(...)  # hard to call limit.denied_result() later

# BETTER – declare rules at module scope, dynamically choose which to apply
admin_limit = TokenBucket(
    label="admin.tool-calls",
    bucket="admin-tools",
    refill_rate=100,
    interval_seconds=60,
    max_tokens=1000,
)
member_limit = TokenBucket(
    label="member.tool-calls",
    bucket="member-tools",
    refill_rate=10,
    interval_seconds=60,
    max_tokens=100,
)
pi_rule = DetectPromptInjection()

def tool_rules(user_id: str, role: str, text: str):
    limit = admin_limit if role == "admin" else member_limit
    return [
        limit(key=user_id, requested=1),
        pi_rule(text),
    ]
```

### guard() at the operation, with a hardcoded label

Place `guard()` wherever you already know exactly what operation is happening. That's typically inside the specific tool/task function, but the dispatch arm right before calling it works equally well – sometimes it gives cleaner error propagation:

```python
# Option A: guard inside the tool function
async def get_weather(city: str, user_id: str) -> dict:
    decision = await arcjet.guard(
        label="tools.get-weather",
        rules=[tool_call_limit(key=user_id, requested=1)],
        metadata={"user_id": user_id},
    )
    if decision.conclusion == "DENY":
        raise Exception(decision.reason)
    # ...do the work

# Option B: guard at the dispatch arm, right before the call
async def dispatch(task):
    if task["type"] == "summarize":
        decision = await arcjet.guard(
            label="queue.summarize",
            rules=[user_task_limit(key=task["user_id"], requested=3)],
            metadata={"user_id": task["user_id"]},
        )
        if decision.conclusion == "DENY":
            raise Exception(decision.reason)
        return _summarize(task)

# Avoid: generic dispatcher with interpolated label
async def handle_tool_call(name: str, args: dict, user_id: str):  # 👎
    decision = await arcjet.guard(label=f"tools.{name}", rules=[...])
```

The `label` must be a hardcoded string – `"tools.get-weather"`, not `f"tools.{name}"`. Hardcoded labels stay greppable, and the Console groups by them.

**Label naming rules:** labels are validated server-side as slugs – **lowercase letters, digits, dash (`-`), and dot (`.`) only**, must start and end with a letter or digit, max 256 bytes. Underscores, uppercase, and forward slashes are rejected. Metadata *keys* may contain underscores; labels and rate-limit `bucket` names may not. Use `tools.get-weather`, not `tools.get_weather`.

Pass `metadata` whenever you have useful auditing context. It is nested JSON, not a flat string map – `{"user": {"id": user_id}, "request_id": ...}` is valid. It shows up in the Console and does not affect the decision. Do not put secrets or PII in it.

## Choose a rate limit strategy

For a comparison of token bucket vs fixed window vs sliding window, see [Choose protections](choosing_protections.md).

Key Guard-specific notes: all rate limit rules require a `key` parameter at call time (user ID, session ID) – without it, limits are global across all callers. They also need a `bucket` name to avoid collisions between different rules.

**Picking a `key` when there's no user:** Some call sites have no per-user context – for example a single-tenant background worker. Don't fake it with an empty string. Use whatever identifier matches the scope (`os.environ.get("HOSTNAME", "default")` or a deployment name) and add a short comment if it's deliberately global.

## Content scanning rules

### Prompt injection detection

Use `DetectPromptInjection()` on any untrusted text before it reaches a model or is used as a tool argument. Also useful on tool call *results* when the tool fetches content from untrusted sources.

### Sensitive information detection

Use `LocalDetectSensitiveInfo()` to block PII from entering or leaving the system (for example users sending credit card numbers, or tool outputs leaking email addresses). The scan runs locally – raw text never leaves the SDK. The default backend is WASM; see [On-device Rampart backend](#on-device-rampart-backend) for names and government / financial identifiers.

### Content moderation

`ModerateContent()` flags unsafe or policy-violating text for Guard call sites (not available on `protect()`). The result is frozen to `detected` plus optional `billing` (`text_units`) – no per-category scores. Published **0.9.0** / **0.10.0b1** still export `experimental_ModerateContent` as the public name; current `main` graduates it to `ModerateContent` and keeps the old name as a deprecated alias (`DeprecationWarning`). Import whichever the installed types export. `decision.reason` is `"MODERATE_CONTENT"` on deny.

```python
from arcjet.guard import ModerateContent

moderate = ModerateContent()

decision = await arcjet.guard(
    label="llm.output",
    rules=[moderate(text)],
)
```

Treat evaluation errors as fail-open and inspect `decision.has_failed_open()` / `decision.error_results()`.

### On-device Rampart backend

`LocalDetectSensitiveInfo()` defaults to the bundled WASM engine (card, email, phone, IP). For names, addresses, and government / financial identifiers, install `arcjet[sensitive-info-rampart]` and pass `backend=rampart()`:

```python
from arcjet.guard import LocalDetectSensitiveInfo
from arcjet_sensitive_info_rampart import rampart

sensitive = LocalDetectSensitiveInfo(deny=["GIVEN_NAME", "SSN"], backend=rampart())
```

Listing a backend-only entity type without a supporting `backend` raises.

## Decision handling

`decision.conclusion` is either `"ALLOW"` or `"DENY"`. Always check before proceeding.

For useful error messages, branch on **which rule** denied – not just on `DENY`. Each rule defined at module scope exposes a `.denied_result(decision)` accessor that returns rule-specific info (for example `reset_at_unix_seconds` for rate limits). Use this to give the caller something actionable:

```python
if decision.conclusion == "DENY":
    rate_limited = user_task_limit.denied_result(decision)
    if rate_limited:
        raise Exception(f"rate limited – retry after unix {rate_limited.reset_at_unix_seconds}")
    if decision.reason == "PROMPT_INJECTION":
        raise Exception("input flagged as prompt injection")
    raise Exception("blocked")
```

`decision.reason` is a flat string – one of `"RATE_LIMIT"`, `"PROMPT_INJECTION"`, `"SENSITIVE_INFO"`, `"MODERATE_CONTENT"`, `"CUSTOM"`, `"ERROR"`, `"NOT_RUN"`, `"UNKNOWN"`. Prompt-injection and content-moderation results may include optional `billing` (`unit` / `count`). Prompt injection uses `tokens`; moderation uses `text_units`. The moderation result is `detected` plus that optional `billing` only. Read the types on the decision object for the full structure.

### Errors vs warnings (failing open)

`guard()` never raises for runtime degradation – a transport failure or a rule that couldn't be processed comes back as a fail-open `"ALLOW"` decision, not an exception. (Programmer errors – an invalid label, a misconfigured rule – still raise `ArcjetError`.) Two distinct signals (available from **`arcjet` 0.9.0**) tell you what happened:

- `decision.has_failed_open()` – `True` when the decision is `"ALLOW"` *only* because a rule or the decision itself could not be processed. This is the **fail-closed gate**: if the operation is sensitive enough that a degraded Arcjet signal must block rather than allow, branch on this and deny. `decision.error_results()` returns the errored results (each with a `code`/`message`) for logging.
- `decision.warnings` – request-validation diagnostics (for example an invalid metadata key that was stripped). The decision is still valid and trustworthy; warnings never change the conclusion. Log them so the config gets fixed, but don't block on them.

To attribute a failure to a *specific* rule rather than scanning the whole decision, each rule also exposes `.error_result(decision)` (added in **`arcjet` 0.9.0**) – the mirror of `.denied_result(decision)`. It returns that rule's `RuleResultError` (with `code`/`message`) if that rule errored, else `None`. Use it when only one rule failing open is actually unsafe (for example the prompt-injection scan) while others failing open is tolerable.

```python
decision = await arcjet.guard(label="tools.get-weather", rules=rules)
if decision.has_failed_open():
    # Arcjet couldn't fully evaluate. Allow by default, or deny for a sensitive op.
    logging.error("guard failed open: %s", decision.error_results())
for w in decision.warnings:
    logging.warning("%s: %s", w.code, w.message)
```

On `arcjet` ≤ 0.8.0 the only signal is `decision.has_error()`, which is **deprecated** from 0.9.0 (it conflated request diagnostics with rule errors, and emits a `DeprecationWarning`). Check the installed package's types – if `has_failed_open` exists, prefer it over `has_error()`.

### Correlation IDs

Available from **`arcjet` 0.9.0**: pass `correlation_id` to `.guard()` to correlate a guard decision with a request, workflow run, or agent trace. It is a dedicated field, not metadata, and it does not affect the decision. On `main`, keep a whole run on one Sequence with `arcjet_sequence` or LangChain `config["configurable"]["arcjet_correlation_id"]` – see [Framework helpers](#framework-helpers).

### Outbound HTTP proxy

Available from **`arcjet` 0.9.0**: standard `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` environment variables are honored for outbound Arcjet API calls. Do not log proxy URLs because they may contain credentials.

## Async vs sync

The package provides both variants:
- `launch_arcjet` / `await arcjet.guard(...)` – async, use in `async def` functions
- `launch_arcjet_sync` / `arcjet.guard(...)` – sync, use in regular `def` functions

**Pick the variant that matches the function you're protecting.** A FastAPI handler or an `AsyncOpenAI` agent loop is async – use `launch_arcjet`. A Celery task, a queue poller defined with `def`, or anything wrapped by a sync framework is sync – use `launch_arcjet_sync`. Mixing them produces "coroutine was never awaited" warnings or blocking calls inside an event loop. Both variants provide the same protection.

## Capture and flush

`capture()` records that an action happened. It is not a security decision – it never denies and is not awaited, even on the async client.

```python
aj.capture(
    action="refund.issued",
    correlation_id=workflow_id,
    decision_id=decision.id,
    metadata={"amount_cents": 4999, "invoice": {"id": "inv_123"}},
)
```

Call `await aj.flush()` (async) or `aj.flush()` (sync) on shutdown. Default deadline is 1000 ms. There is no `close()`.

### Helper capture outcomes

`guard_action`, LangChain `guard_tool`, and `ArcjetMiddleware` write `metadata.outcome` themselves. This is capture telemetry on those helpers ([arcjet-py#225](https://github.com/arcjet/arcjet-py/pull/225), `main` only) – not a Decision field, not a conclusion, and not a new `on_guard_error` value. The helper applies `outcome` last, so a caller metadata key of the same name cannot overwrite it. A raw `aj.capture()` does not write these values. CrewAI `register_arcjet_hooks` still records `success` on proceed — do not read that stream as this five-value table.

`success` is not "the action ran." It means the action ran **and** policy judged all of it.

| `metadata.outcome` | What it means |
| --- | --- |
| `success` | The action ran and policy judged all of it. |
| `degraded` | The action ran only because `on_guard_error="allow"` and policy did not judge it fully. |
| `error` | The action ran, then threw. Wins over `degraded` – do not count these in a degraded tally. |
| `denied` | Policy denied; the action did not run. |
| `unavailable` | Policy could not fully judge the action and the default `on_guard_error="deny"` blocked it. |

`degraded` is recorded when the helper proceeds under `"allow"` because the guard call failed, its answer could not be read, the decision failed open (`has_failed_open()`), or something the decision needed could not be resolved. The same conditions still block under the default `"deny"` and record `unavailable`.

A `degraded` event still carries `decision_id` when one exists: `degraded` + id means policy judged the action in part; `degraded` without an id means policy judged none of it.

After an incident, filter `degraded` (ran without a full judgement) and `unavailable` (blocked without a full judgement). Those are the calls a `success` / `denied` tally used to hide.

## Optional registration

`launch_arcjet()` never touches global state. `register_arcjet(aj)` is a separate, explicit call for code too deep to receive a client.

`capture()` is one free function for both client flavors. `guard` / `flush` come in pairs: `await guard(...)` / `await flush()` for `launch_arcjet()`, and `guard_sync(...)` / `flush_sync()` for `launch_arcjet_sync()`. Calling the wrong pair fail-opens and reports `AJ3007`.

Free `guard()` / `guard_sync()` fail-open if nothing is registered – check `has_failed_open()`. Free `capture()` drops silently. A second `register_arcjet` does not displace the first. `unregister_arcjet()` clears whatever is there – libraries must not call it. Registration is a module-level global, not a `ContextVar`, so it is visible from WSGI worker threads.

For tests, `from arcjet.guard.testing import register_test_client` and use `with register_test_client() as arcjet:`. Its `guard()` always returns fail-open ALLOW. Pass `on_guard_error="allow"` on the helpers below unless the test is asserting a denial – the recorder's fail-open ALLOW is an unevaluated policy, and the default `"deny"` refuses it.

## Framework helpers

LangChain surfaces are on current `arcjet-py` **main** ([#195](https://github.com/arcjet/arcjet-py/pull/195), [#196](https://github.com/arcjet/arcjet-py/pull/196)). They are **not** in PyPI 0.9.0 or the 0.10.0b1 pre-release. CrewAI (`arcjet.guard.crewai`) is until-published – not in PyPI 0.9.0, and there is no `arcjet[crewai]` extra. Teaching is pinned to arcjet-py merge `b1253640` ([#224](https://github.com/arcjet/arcjet-py/pull/224)). Read the installed package before using either.

Pick the helper that matches what you hold. Do not hand-wrap every tool with raw `guard()`.

| You have | Use | Extra |
| --- | --- | --- |
| Any Python callable (worker, MCP handler, job) | `guard_action` / `guard_action_sync` | none (`arcjet.guard`) |
| A LangChain `BaseTool` you call yourself | `guard_tool` | `arcjet[langchain]` (`langchain-core>=1.2.5,<2`) |
| `create_agent` (the model chooses tools) | `ArcjetMiddleware` + `ToolPolicy` | `arcjet[langchain-agents]` (`langchain>=1.3,<2`, `langgraph>=1.2,<2`) |
| A chain or agent you want to observe | `ArcjetCaptureHandler` | `arcjet[langchain]` – cannot deny |
| Official CrewAI crew / LiteAgent / MCP or crew-injected tool | `register_arcjet_hooks` + `ToolPolicy` | no extra – install crewai yourself |
| A CrewAI `BaseTool` you call yourself | `guard_tool` (`arcjet.guard.crewai`) | same – only path that raises Arcjet errors |

`guard_action` is core Guard – no LangChain extra. Importing `arcjet.guard.langchain` never loads LangGraph; that happens only when you reference `ArcjetMiddleware` or `ToolPolicy`. Without the agents extra those names raise, naming `arcjet[langchain-agents]`. Importing `arcjet.guard.crewai` does not load LangChain. There is no `guard_crew`. Python LangChain is not JS `createAgent` (docs https://docs.arcjet.com/guards/langchain-js/) and not LangGraph JS (docs https://docs.arcjet.com/guards/langgraph/). CrewAI docs: https://docs.arcjet.com/guards/crewai/.

### Gotchas

- **Fail closed.** `guard_action`, LangChain `guard_tool`, `ArcjetMiddleware`, `register_arcjet_hooks`, and CrewAI `guard_tool` default to `on_guard_error="deny"` (same fail-closed default as [#196](https://github.com/arcjet/arcjet-py/pull/196)). Only `"allow"` fails open; any other value is refused. A `DENY` always blocks. Core `guard()` still fails open (`has_failed_open()`). `guard_action`, LangChain `guard_tool`, and `ArcjetMiddleware` write `metadata.outcome`: default deny records `unavailable`; `"allow"` records `degraded` when the action ran without a full judgement. `register_arcjet_hooks` is not that path — a proceed still records `success`. See [Helper capture outcomes](#helper-capture-outcomes).
- **Configure the tool before `guard_tool()`.** Narrow `args_schema`, set `handle_tool_error` / `callbacks` / `response_format` on the tool you still hold, then wrap. Changes on the guarded handle do not reach the call.
- **One Sequence per conversation.** Use `with arcjet_sequence(correlation_id=session.id):` or `config={"configurable": {"arcjet_correlation_id": session.id}}`. Do not mint a new id per turn. LangChain's `run_id` is not used. The config key wins over an enclosing `arcjet_sequence`; `configurable` is checked before `metadata`. CrewAI correlation is the same caller-owned `correlation_id` / `arcjet_sequence` — crew, task, and agent names are metadata, never minted into an id.
- **Capture handlers never block.** LangChain ignores what a callback returns. Policy lives in `guard_action` / `guard_tool` / `ArcjetMiddleware`. CrewAI never registers `POST_TOOL_CALL`; the decision is captured in `PRE_TOOL_CALL`, which raises `HookAborted(reason=..., source="arcjet")`.
- **`human_input` is not a policy gate.** CrewAI Agent/Task `human_input` / `request_human_input` is human-in-the-loop, not Guard. Same trap as JS `humanInTheLoopMiddleware` and LangGraph `interrupt()`.

### Any callable – `guard_action`

```python
from arcjet.guard import launch_arcjet, TokenBucket, guard_action

aj = launch_arcjet(key=os.environ["ARCJET_KEY"])
job_limit = TokenBucket(
    label="queue.process-job",
    bucket="jobs",
    refill_rate=10,
    interval_seconds=60,
    max_tokens=10,
)

result = await guard_action(
    lambda: process_job(job),
    action="queue.process-job",
    guard=aj,
    rules=[job_limit(key=user_id, requested=1)],
    on_guard_error="deny",
)
```

`fn` takes no arguments – close over what you need. Sync code uses `guard_action_sync`. Raises `ArcjetDeniedError` on DENY, `ArcjetUnavailableError` when evaluation failed and `on_guard_error="deny"`. Guard `TokenBucket` takes `refill_rate` / `interval_seconds` / `max_tokens` (and optional `label` / `bucket`); that is not the request helper `token_bucket` (`interval` / `capacity`).

### LangChain tool you call – `guard_tool`

```python
from arcjet.guard.langchain import guard_tool

send_email.args_schema = PublicEmailArgs  # narrow first, then wrap
guarded = guard_tool(
    guard=aj,
    tool=send_email,
    action="email.sent",
    rules=[email_limit(key=user_id, requested=1)],
    on_guard_error="deny",
)
```

Needs `pip install "arcjet[langchain]"`. The result is still a `BaseTool`. DENY raises `ArcjetToolDeniedError` (the tool's `handle_tool_error` may convert it); unavailable raises `ArcjetToolUnavailableError`.

### `create_agent` – `ArcjetMiddleware`

```python
from langchain.agents import create_agent
from arcjet.guard.langchain import ArcjetMiddleware, ToolPolicy

tools = [send_email, search_orders]
agent = create_agent(
    model="openai:gpt-4o",
    tools=tools,
    middleware=[
        ArcjetMiddleware(
            guard=aj,
            policies={
                "send_email": ToolPolicy(
                    action="email.sent",
                    rules=[email_limit(key=user_id, requested=1)],
                ),
            },
            tools=tools,
            on_guard_error="deny",
        )
    ],
)

await agent.ainvoke(
    {"messages": [...]},
    config={"configurable": {"arcjet_correlation_id": session.id}},
)
# equivalently: with arcjet_sequence(correlation_id=session.id): ...
```

Needs `pip install "arcjet[langchain-agents]"`. Pass `tools=` the same sequence you gave `create_agent` – a typo in a policy key is refused at construction instead of leaving that tool unguarded. Tools without a policy pass through. `guard=` is optional if you already `register_arcjet()`.

If you can name the tool at wiring time, `guard_tool` is the smaller change. If the model picks the tool, use the middleware. They compose: a guarded tool inside a guarded agent evaluates each policy once and both land on the same Sequence.

This is Python `create_agent` (docs https://docs.arcjet.com/guards/langchain/). It is not JS `createAgent` / `wrapToolCall` (docs https://docs.arcjet.com/guards/langchain-js/) and not LangGraph JS `StateGraph` / `ToolNode` (docs https://docs.arcjet.com/guards/langgraph/).

### Observe a chain – `ArcjetCaptureHandler`

```python
from arcjet.guard.langchain import ArcjetAsyncCaptureHandler, ArcjetCaptureHandler

# invoke → ArcjetCaptureHandler; ainvoke → ArcjetAsyncCaptureHandler
chain.invoke(inputs, config={"callbacks": [ArcjetCaptureHandler(guard=aj)]})
await chain.ainvoke(
    inputs, config={"callbacks": [ArcjetAsyncCaptureHandler(guard=aj)]}
)
```

Same extra as `guard_tool`. Pair the handler with the call: `ArcjetCaptureHandler` with `invoke`, `ArcjetAsyncCaptureHandler` with `ainvoke`. Neither can deny a call.

### CrewAI – `register_arcjet_hooks`

Official `crewai` only – not community forks, not LangChain Crew wrappers. Import from `arcjet.guard.crewai`. There is **no** `arcjet[crewai]` extra: CrewAI hard-depends on `chromadb`, which carries unpatched RCE CVE-2026-45829, so an Arcjet extra must not pull it in. Install CrewAI yourself (`pip install "crewai>=1.15.3,<2"`). Until-published: PyPI `arcjet` 0.9.0 does not include this module. Pin `arcjet` to git SHA `b1253640ce676b948594beed5fe62450d0e1c77d` ([#224](https://github.com/arcjet/arcjet-py/pull/224)):

```bash
pip install "arcjet @ git+https://github.com/arcjet/arcjet-py.git@b1253640ce676b948594beed5fe62450d0e1c77d"
pip install "crewai>=1.15.3,<2"
```

Exports: `register_arcjet_hooks`, `unregister_arcjet_hooks`, `ArcjetCrewAIHooks`, `guard_tool`, `ToolPolicy`, `sanitize_tool_name`, `free_text_arguments`. There is no `guard_crew`.

Three gotchas first:

1. **The gate is process-wide `PRE_TOOL_CALL`, once.** `register_arcjet_hooks` registers on CrewAI's dispatcher. Every tool a crew, LiteAgent, MCP adapter, or crew-injected list executes hits the hook. A `DENY` (or unevaluated Guard under the default `on_guard_error="deny"`) raises `HookAborted(reason=..., source="arcjet")` so the tool never runs. CrewAI swallows every other exception — raising `ArcjetDeniedError` / `ArcjetUnavailableError` from the hook would *run* the tool. Same fail-closed default as [#196](https://github.com/arcjet/arcjet-py/pull/196): only `"allow"` fails open; a `DENY` always blocks. Core `guard()` still fails open (`has_failed_open()`). The hook path is **sync only** — pass `launch_arcjet_sync` / `ArcjetGuardSync`. An async client is refused at registration (`ArcjetMisconfiguration`). A second `register_arcjet_hooks` in the same process is also `ArcjetMisconfiguration` (CrewAI's registry appends and would double-evaluate); call `unregister()` on the handle first.
2. **`POST_TOOL_CALL` is never registered.** Only PRE is installed. The decision is captured in PRE. POST is not a policy surface and this module does not register it, so it cannot deny or rewrite a result. The agent always sees `Tool execution blocked by hook. Tool: {name}`. `HookAborted.reason` is telemetry only.
3. **`human_input` is not a policy gate.** Agent/Task `human_input` and `request_human_input` are human-in-the-loop. Same trap as JS `humanInTheLoopMiddleware`, LangGraph `interrupt()`, OpenAI Agents `needsApproval`, and Genkit `interrupt()`. There is no inbound helper and no approval helper.

`ToolPolicy` is `action` + `rules`, keyed by tool name. Keys and the optional `tools=` filter go through `sanitize_tool_name` (CrewAI 1.15.3+): `Send Email` and `send_email` name the same tool. Tools without a matching policy still get `"{sanitized_tool_name}.invoked"` and the registrar-level `rules` (empty still contacts Guard) unless you pass `tools=`. `free_text_arguments` strips opaque ids (`tool_call_id`, `*_id`, …) when you want only free text for a scanning rule — the hook itself hands resolvers the tool's own argument mapping unfiltered. Screen inbound user text with core `aj.guard(...)` / `guard_sync` **before** `crew.kickoff`. Already-`guard_tool`-wrapped tools are skipped so Guard is not called twice. Tear down with `unregister_arcjet_hooks(hooks)` or `hooks.unregister()`.

Do not hand-wrap every CrewAI tool with raw `guard()`. Use `register_arcjet_hooks` for crew-executed tools. Docs: https://docs.arcjet.com/guards/crewai/.

```python
from crewai import Agent, Crew, Task
from arcjet.guard import DetectPromptInjection, TokenBucket, launch_arcjet_sync
from arcjet.guard.crewai import ToolPolicy, register_arcjet_hooks, unregister_arcjet_hooks

aj = launch_arcjet_sync(key=os.environ["ARCJET_KEY"])
lookup_limit = TokenBucket(
    label="order.looked-up",
    bucket="lookups",
    refill_rate=10,
    interval_seconds=60,
    max_tokens=10,
)
inbound = DetectPromptInjection()
# The authenticated caller, so a budget cannot be reset by varying the order id.
user_id = authenticated_user_id

hooks = register_arcjet_hooks(
    guard=aj,
    policies={
        "lookup_order": ToolPolicy(
            action="order.looked-up",
            rules=[lookup_limit(key=user_id, requested=1)],
        ),
    },
    tools=["lookup_order"],
    on_guard_error="deny",
)

agent = Agent(
    role="Support",
    goal="Look up orders",
    backstory="Help the user with order status.",
    # human_input=True is HITL — not this policy gate
)
task = Task(
    description="Look up the user's order",
    expected_output="Order status",
    agent=agent,
)
crew = Crew(agents=[agent], tasks=[task])

decision = aj.guard(
    label="message.received",
    rules=[inbound(user_text)],
)
if decision.conclusion == "DENY":
    raise RuntimeError("message blocked")
# `guard()` fails open, so an ALLOW is not proof the rules ran. Gate
# on `has_failed_open()` when this inbound site must fail closed.
if decision.has_failed_open():
    raise RuntimeError("inbound guard unavailable")

crew.kickoff()
unregister_arcjet_hooks(hooks)
# equivalently: hooks.unregister()
```

Use `action` + `rules` only. Key rate limits on the authenticated caller, not a model-supplied order id.

### CrewAI tool you call – `guard_tool`

`BaseTool.run` never dispatches `PRE_TOOL_CALL`. This wrap is for a standalone CrewAI `BaseTool` you invoke yourself, and it is the **only** CrewAI path that raises `ArcjetDeniedError` / `ArcjetUnavailableError`. A sync call needs a blocking client; an async call needs an awaitable one. Hand the crew the copy this returns (it carries the brand the hook skips). The original stays unguarded on purpose — if you pass that to a crew, the hook still covers it.

```python
from arcjet.guard.crewai import guard_tool

guarded = guard_tool(
    guard=aj,
    tool=lookup_order,
    action="order.looked-up",
    rules=[lookup_limit(key=user_id, requested=1)],
    on_guard_error="deny",
)
result = guarded.run(order_id=order_id)
```

## Key patterns

- An empty `rules` list still calls `guard()` / the Decide API. `rules=[]` is a real decision, not a no-op skip.
- Use `metadata` for analytics/auditing context – nested JSON, not a flat string map. It appears in the Console and does not affect the decision. Do not put secrets or PII in it.
- The `label` string must identify the operation (`"tools.get-weather"`, `"queue.process-job"`) – it appears in the Console and groups which operations are being limited or blocked.
