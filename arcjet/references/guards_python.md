# Python Guard

## Contents

- [What Guard is](#what-guard-is)
- [Installation](#installation)
- [Architecture: why things go where they do](#architecture-why-things-go-where-they-do)
- [Choose a rate limit strategy](#choose-a-rate-limit-strategy)
- [Content scanning rules](#content-scanning-rules)
- [Common mistakes](#common-mistakes)
- [Decision handling](#decision-handling)
- [Async vs sync](#async-vs-sync)
- [Capture and flush](#capture-and-flush)
- [Optional registration](#optional-registration)
- [Framework helpers](#framework-helpers)
- [Key patterns](#key-patterns)

## What Guard is

Guard protects code paths that don't have an HTTP request – tool calls, agent loops, queue consumers, background jobs. It's part of the `arcjet` package (≥ 0.7.0) but uses a different entry point (`arcjet.guard`) from the HTTP request protection (`arcjet`). Capture, registration, Rampart, nested metadata, threat/billing, `ModerateContent`, `guard_action`, and the 2000 ms default request timeout ship in **`arcjet` 1.0.0**. There's no request object to inspect, so you pass explicit context (labels, keys, text to scan) at each call site. Prefer `guard_action` when it fits – see [Framework helpers](#framework-helpers). Official Python agent adapters (LangChain, CrewAI, OpenAI Agents, Claude Agent SDK, Claude Managed Agents, Strands Agents) live in dedicated skills so this file stays shared fundamentals. Do not copy adapter wiring from those skills back into this reference.

**Version compatibility:** Python ≥ 3.10 (same as the request SDK – they're shipped together in the `arcjet` package). If the project's Python is older, warn the user and stop.

Needs `libgcc` for the bundled WebAssembly runtime. Most Linux distributions include this by default, but Alpine Linux does not – run `apk add libgcc` first, otherwise `import arcjet` fails with `OSError: Error loading shared library libgcc_s.so.1`.

> _Published PyPI release last verified: `arcjet` **v1.0.0** on **August 26, 2026**. That wheel includes `guard_action`, LangChain (`arcjet[langchain]` / `arcjet[langchain-agents]`), CrewAI (`arcjet.guard.crewai`, no extra), OpenAI Agents (`arcjet[openai-agents]`), `ModerateContent`, `with_rule()`, `protect_signup()`, required HTTP `mode=`, and typed `server_input` / `local_input`. Claude Agent SDK, Claude Managed Agents, and Strands Agents extras are on `main` only – pin those in the dedicated skill. `experimental_ModerateContent` remains a deprecated alias._
>
> _Read the installed package's types before using any of them. Check `requires-python` in [`pyproject.toml`](https://github.com/arcjet/arcjet-py/blob/main/pyproject.toml)._

## Installation

Install with whichever package manager the project already uses (`pip install`, `uv add`, or `poetry add`) – don't hand-edit `requirements.txt` with a guessed version. Current PyPI line is `1.x`:

```bash
pip install arcjet
```

Guard is included in the `arcjet` package – no separate install. `guard_action` needs no extra. Official Python agent adapters install their own extras (or, for CrewAI, no extra — install CrewAI yourself). Load the dedicated skill for that adapter from [Framework helpers](#framework-helpers) instead of repeating install pins here. Read the installed package's types and docstrings for the full API surface.

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

Use `LocalDetectSensitiveInfo()` to block PII from entering or leaving the system (for example users sending credit card numbers, or tool outputs leaking email addresses). The scan runs locally – raw text never leaves the SDK.

**Always pass `allow` or `deny`.** `LocalDetectSensitiveInfo()` with neither list fails local evaluation (`AJ1203`) and the decision still concludes `ALLOW`, so the check looks configured and blocks nothing. Only `has_failed_open()` reveals it. Guard has no `sensitiveInfo` / `detect_sensitive_info` export – those are HTTP `protect()` rules.

The default WASM backend detects exactly four types: `EMAIL`, `PHONE_NUMBER`, `IP_ADDRESS`, `CREDIT_CARD_NUMBER`. Every other type needs `backend` **on the rule**. The rule does not inherit the client's `sensitive_info_backend`. Share one Rampart instance:

```python
from arcjet.guard import LocalDetectSensitiveInfo
from arcjet_sensitive_info_rampart import rampart

sensitive_info_backend = rampart()
sensitive = LocalDetectSensitiveInfo(
    deny=["EMAIL", "CREDIT_CARD_NUMBER", "BANK_ACCOUNT"],
    backend=sensitive_info_backend,
)
```

### Content moderation

`ModerateContent()` flags unsafe or policy-violating text for Guard call sites (not available on `protect()`). The result is frozen to `detected` plus optional `billing` (`text_units`) – no per-category scores. Graduated in **1.0.0**; `experimental_ModerateContent` remains a deprecated alias. `decision.reason` is `"MODERATE_CONTENT"` on deny.

```python
from arcjet.guard import ModerateContent

moderate = ModerateContent()

decision = await arcjet.guard(
    label="llm.output",
    rules=[moderate(text)],
)
```

Treat evaluation errors as fail-open and inspect `decision.has_failed_open()` / `decision.error_results()`.

### Common mistakes

These produce code that runs without error and enforces nothing. Full list: https://docs.arcjet.com/llms.txt.

- Always pass `allow` or `deny` on `LocalDetectSensitiveInfo`. Share `backend` with the client for non-default entity types.
- Every Python adapter accepts typed `inputs` (`server_input` / `local_input`). Resolver arity varies: `guard_tool` gets the arguments mapping; CrewAI hooks get `(arguments, ctx)`; LangChain `guard_tool` gets `(arguments, config)`. LangChain `rules=` is a **static sequence**, not a lambda.
- A missing decision is not a denial. Verify in Console/CLI.
- Guarding one tool only helps if it is the only path. Claude Agent SDK needs `setting_sources=[]` **and** `strict_mcp_config=True`.
- Claude Agent SDK `session_id` on options must be a unique UUID per run (`resume` later); the Guard `session_id` is a long-lived actor id.
- Claude Managed Agents: `guard_events` has no `inbound=` – `action` and `rules` sit at the top level, it takes `send=`, and the returned callable replaces `send`. Correlate on a caller-owned id; the helper drops Anthropic `sesn_…` / `sevt_…`.

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

Available from **`arcjet` 0.9.0**: pass `correlation_id` to `.guard()` to correlate a guard decision with a request, workflow run, or agent trace. It is a dedicated field, not metadata, and it does not affect the decision. Keep a whole run on one Sequence with `arcjet_sequence`. Framework adapters each have their own caller-owned reader — load the dedicated skill for that adapter. Never mint a new id per turn.

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

`guard_action`, LangChain `guard_tool`, and `ArcjetMiddleware` write `metadata.outcome` themselves. This is capture telemetry on those helpers ([arcjet-py#225](https://github.com/arcjet/arcjet-py/pull/225), in 1.0.0) – not a Decision field, not a conclusion, and not a new `on_guard_error` value. The helper applies `outcome` last, so a caller metadata key of the same name cannot overwrite it. A raw `aj.capture()` does not write these values. CrewAI `register_arcjet_hooks` still records `success` on proceed — do not read that stream as this five-value table.

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

`guard_action` is core Guard — no extra. Official Python agent adapters
live in dedicated skills so this reference stays shared fundamentals.
Pick the helper that matches what you hold. Do not hand-wrap every tool
with raw `guard()`.

| You have | Use | Load |
| --- | --- | --- |
| Any Python callable (worker, MCP handler, job) | `guard_action` / `guard_action_sync` | this file |
| LangChain `BaseTool` / `create_agent` / capture | `arcjet.guard.langchain` | [integrate-arcjet-guard-langchain-py](../../integrate-arcjet-guard-langchain-py/SKILL.md) |
| Official CrewAI crew / LiteAgent / standalone `BaseTool` | `arcjet.guard.crewai` | [integrate-arcjet-guard-crewai](../../integrate-arcjet-guard-crewai/SKILL.md) |
| Official Python OpenAI Agents `FunctionTool` | `arcjet.guard.openai_agents` | [integrate-arcjet-guard-openai-agents-py](../../integrate-arcjet-guard-openai-agents-py/SKILL.md) |
| Official Python Claude Agent SDK `@tool` / unwrapped built-ins | `arcjet.guard.claude_agent_sdk` | [integrate-arcjet-guard-claude-agent-sdk-py](../../integrate-arcjet-guard-claude-agent-sdk-py/SKILL.md) |
| Claude Managed Agents custom tools / inbound events | `arcjet.guard.claude_managed_agents` | [integrate-arcjet-guard-claude-managed-agents-py](../../integrate-arcjet-guard-claude-managed-agents-py/SKILL.md) |
| Official Python Strands Agents `@tool` / Agent | `arcjet.guard.strands_agents` | [integrate-arcjet-guard-strands-agents-py](../../integrate-arcjet-guard-strands-agents-py/SKILL.md) |

Do not mix adapters. Importing one adapter module does not load another.
Python LangChain is not JS `createAgent` (docs https://docs.arcjet.com/guards/langchain/) and not LangGraph JS (docs https://docs.arcjet.com/guards/langgraph/). Python OpenAI Agents, Claude Agent SDK, Claude Managed Agents, and Strands Agents are not their JS `@arcjet/guard/...` counterparts. There is no `guard_crew`. There is no `arcjet[crewai]` extra (CrewAI pulls `chromadb`, CVE-2026-45829). Extras, denial envelopes, and HITL traps live in the dedicated skill — do not restate them here.

### Shared helper rules

- **Fail closed.** Framework wrappers default to `on_guard_error="deny"` (same fail-closed default as [#196](https://github.com/arcjet/arcjet-py/pull/196)). Only `"allow"` fails open; any other value is refused. A `DENY` always blocks. Core `guard()` still fails open (`has_failed_open()`). `guard_action`, LangChain `guard_tool`, and `ArcjetMiddleware` write `metadata.outcome` — see [Helper capture outcomes](#helper-capture-outcomes). CrewAI `register_arcjet_hooks` is not that path — a proceed still records `success`.
- **One Sequence per conversation.** Use `with arcjet_sequence(correlation_id=session.id):` for core Guard. Framework adapters each have a caller-owned reader in their skill. Do not mint a new id per turn.
- **HITL is not a policy gate.** CrewAI `human_input`, Strands `event.interrupt()`, Claude Agent SDK `can_use_tool`, OpenAI Agents `needs_approval`, and Claude Managed Agents `always_ask` + `user.tool_confirmation` are human-in-the-loop. Same trap as JS `humanInTheLoopMiddleware` and LangGraph `interrupt()`.

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

## Key patterns

- An empty `rules` list still calls `guard()` / the Decide API. `rules=[]` is a real decision, not a no-op skip.
- Use `metadata` for analytics/auditing context – nested JSON, not a flat string map. It appears in the Console and does not affect the decision. Do not put secrets or PII in it.
- The `label` string must identify the operation (`"tools.get-weather"`, `"queue.process-job"`) – it appears in the Console and groups which operations are being limited or blocked.
