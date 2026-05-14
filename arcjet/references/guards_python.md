# Python Guard

## What Guard Is

Guard protects code paths that don't have an HTTP request — tool calls, agent loops, queue consumers, background jobs. It's part of the `arcjet` package (>= 0.7.0) but uses a different entry point (`arcjet.guard`) from the HTTP request protection (`arcjet`). There's no request object to inspect, so you pass explicit context (labels, keys, text to scan) at each call site.

## Installation

```bash
pip install arcjet
```

Requires `arcjet` >= 0.7.0. Guard is included — no separate package. Read the installed package's types and docstrings for the full API surface.

## Architecture: Why Things Go Where They Do

### Client at module scope

```python
import os
from arcjet.guard import launch_arcjet

arcjet = launch_arcjet(key=os.environ["ARCJET_KEY"])
```

Use `launch_arcjet` for async code, `launch_arcjet_sync` for sync. The client holds a persistent connection to the Arcjet decision service. Creating it inside a function means a new connection per call.

### Rules at module scope

Rate limit state is tracked server-side by the combination of `bucket` and other configuration properties, so recreating rules per call won't break counting. However, defining rules at module scope is still best practice because:

- It makes the per-rule result accessors (e.g. `user_limit.denied_result(decision)`) work — you need a stable reference to call methods on.
- It avoids unnecessary object allocation on every invocation.
- It keeps rule configuration visible and centralized.

```python
# WORKS but awkward — no stable reference for result inspection
def handle_tool():
    limit = TokenBucket(...)  # hard to call limit.denied_result() later

# BETTER — declare rules at module scope, dynamically choose which to apply
admin_limit = TokenBucket(label="admin.tool_calls", bucket="admin-tools", max_tokens=1000, ...)
member_limit = TokenBucket(label="member.tool_calls", bucket="member-tools", max_tokens=100, ...)

def tool_rules(user_id: str, role: str, text: str):
    limit = admin_limit if role == "admin" else member_limit
    return [
        limit(key=user_id, requested=1),
        pi_rule(text),
    ]
```

### guard() inline at each call site

Don't wrap `guard()` in a shared helper function. Each call site should be visible with its own `label` and `rules` array so you can see exactly what protection applies where.

```python
# Each call site calls guard() directly with its own label
decision = await arcjet.guard(label="tools.search", rules=tool_rules(user_id, role, query))
```

## Choosing a Rate Limit Strategy

See the "Rate Limiting Strategies" section in the main skill for a comparison of token bucket vs fixed window vs sliding window.

Key guard-specific notes: all rate limit rules require a `key` parameter at call time (user ID, session ID) — without it, limits are global across all callers. They also need a `bucket` name to avoid collisions between different rules.

## Content Scanning Rules

### Prompt injection detection

Use `DetectPromptInjection()` on any untrusted text before it reaches a model or is used as a tool argument. Also useful on tool call *results* when the tool fetches content from untrusted sources.

### Sensitive information detection

Use `LocalDetectSensitiveInfo()` to block PII from entering or leaving the system (e.g. users sending credit card numbers, or tool outputs leaking email addresses). The scan runs locally — raw text never leaves the SDK, which matters for compliance.

## Decision Handling

`decision.conclusion` is either `"ALLOW"` or `"DENY"`. Always check before proceeding.

For specific error messages, use the per-rule result accessors (e.g. `user_limit.denied_result(decision)` gives you `reset_in_seconds` for rate limits, `decision.reason` tells you the denial category). Read the types on the decision object for the full structure.

`decision.has_error()` means something went wrong during rule evaluation (service unreachable, rule execution failure, etc.) but the SDK failed open. Log it but don't block the user.

## Async vs Sync

The package provides both variants:
- `launch_arcjet` / `arcjet.guard()` — async, use in `async def` functions
- `launch_arcjet_sync` / `arcjet.guard()` — sync, use in regular functions

Choose based on your application's concurrency model. Both provide the same protection.

## Key Patterns

- Use `metadata` for analytics/auditing context (user ID, session, etc.) — this appears in the dashboard.
- The `label` string should identify the operation (e.g. `"tools.get_weather"`, `"queue.process_job"`) — it appears in the dashboard and helps you understand which operations are being limited or blocked.
