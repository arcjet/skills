# Python Guard Reference

## Installation

Requires `arcjet` >= 0.7.0. Guard is included in the `arcjet` package.

```bash
pip install arcjet
```

## Create the Guard Client

### Async

```python
import os
from arcjet.guard import launch_arcjet

arcjet = launch_arcjet(key=os.environ["ARCJET_KEY"])
```

### Sync (for non-async code)

```python
from arcjet.guard import launch_arcjet_sync

arcjet = launch_arcjet_sync(key=os.environ["ARCJET_KEY"])
```

Create once at module scope. The client holds a persistent connection — creating it inside a function defeats connection reuse.

## Rules

Configure rules at module scope. Each rule config carries a stable ID for server-side aggregation, so creating them per call would break dashboard tracking and rate limit state.

### Token Bucket

Best for AI workloads with variable cost per call. Configure a `bucket` name for semantic clarity and to avoid collisions.

```python
from arcjet.guard import TokenBucket

user_limit = TokenBucket(
    label="user.task_bucket",
    bucket="task-calls",
    refill_rate=100,
    interval_seconds=60,
    max_tokens=500,
)
```

### Fixed Window

Hard cap per time period:

```python
from arcjet.guard import FixedWindow

call_limit = FixedWindow(
    label="user.hourly_calls",
    bucket="hourly-calls",
    max_requests=100,
    window_seconds=3600,
)
```

### Sliding Window

Smooth rate limiting:

```python
from arcjet.guard import SlidingWindow

api_limit = SlidingWindow(
    label="session.api_calls",
    bucket="session-api",
    max_requests=500,
    interval_seconds=60,
)
```

### Prompt Injection Detection

Detects jailbreaks, role-play escapes, and instruction overrides.

```python
from arcjet.guard import DetectPromptInjection

pi_rule = DetectPromptInjection()
```

### Sensitive Information Detection

Detects PII locally — raw text never leaves the SDK.

```python
from arcjet.guard import LocalDetectSensitiveInfo

si_rule = LocalDetectSensitiveInfo(
    deny=["CREDIT_CARD_NUMBER", "EMAIL", "PHONE_NUMBER"],
)
```

## Calling guard()

Call `guard()` inline where each operation happens. Pass a `label`, `rules`, and optionally `metadata` for analytics/auditing.

### Async

```python
async def process_task(user_id: str, message: str):
    decision = await arcjet.guard(
        label="tasks.generate",
        metadata={"user_id": user_id},
        rules=[
            user_limit(key=user_id, requested=1),
            pi_rule(message),
        ],
    )

    if decision.conclusion == "DENY":
        # Use per-rule results for specific error messages
        rate_denied = user_limit.denied_result(decision)
        if rate_denied:
            raise RuntimeError(f"Rate limited — try again in {rate_denied.reset_in_seconds}s")
        raise RuntimeError(f"Blocked: {decision.reason}")

    if decision.has_error():
        print("Arcjet guard error — proceeding with caution")

    # Safe to proceed...
```

### Sync

```python
def process_task(user_id: str, message: str):
    decision = arcjet.guard(
        label="tasks.generate",
        metadata={"user_id": user_id},
        rules=[
            user_limit(key=user_id, requested=1),
            pi_rule(message),
        ],
    )

    if decision.conclusion == "DENY":
        raise RuntimeError(f"Blocked: {decision.reason}")

    # Safe to proceed...
```

## Inspecting Per-Rule Results

```python
rl = user_limit(key=user_id, requested=5)
decision = await arcjet.guard(
    label="tools.chat",
    rules=[rl, pi_rule(message)],
)

r = rl.result(decision)
if r:
    print(r.remaining_tokens, r.max_tokens, r.reset_in_seconds)

denied = user_limit.denied_result(decision)
if denied:
    print(f"Retry after {denied.reset_in_seconds}s")
```
