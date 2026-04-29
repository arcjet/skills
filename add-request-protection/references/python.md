# Python Request Protection Reference

## Installation

```bash
pip install arcjet
```

Works with FastAPI (async) and Flask (sync). Requires Python 3.10+.

## Create the Client

### FastAPI (async)

```python
import os
from arcjet import Mode, arcjet, shield

aj = arcjet(
    key=os.environ["ARCJET_KEY"],
    rules=[shield(mode=Mode.LIVE)],
)
```

### Flask (sync)

```python
import os
from arcjet import Mode, arcjet_sync, shield

aj = arcjet_sync(
    key=os.environ["ARCJET_KEY"],
    rules=[shield(mode=Mode.LIVE)],
)
```

Create once at module scope. Do not create per request.

## Rules

Every rule accepts `mode=Mode.LIVE` or `mode=Mode.DRY_RUN`.

### shield

```python
from arcjet import shield, Mode
shield(mode=Mode.LIVE)
```

### detect_bot

```python
from arcjet import detect_bot, Mode, BotCategory
detect_bot(mode=Mode.LIVE, allow=[BotCategory.SEARCH_ENGINE])
# or deny specific categories
detect_bot(mode=Mode.LIVE, deny=[BotCategory.DEFINITELY_AUTOMATED])
# or allow/deny by string name
detect_bot(mode=Mode.LIVE, allow=["CURL"])
```

### token_bucket

```python
from arcjet import token_bucket, Mode
token_bucket(
    mode=Mode.LIVE,
    characteristics=["userId"],  # optional, defaults to IP
    refill_rate=100,
    interval=60,      # seconds (number)
    capacity=1000,
)
# At protect() time: aj.protect(request, requested=50)
```

### fixed_window

```python
from arcjet import fixed_window, Mode
fixed_window(
    mode=Mode.LIVE,
    window=60,  # seconds (number)
    max=100,
)
```

### sliding_window

```python
from arcjet import sliding_window, Mode
sliding_window(
    mode=Mode.LIVE,
    interval=60,  # seconds (number)
    max=100,
)
```

### validate_email

```python
from arcjet import validate_email, Mode, EmailType
validate_email(
    mode=Mode.LIVE,
    deny=[EmailType.DISPOSABLE, EmailType.INVALID, EmailType.NO_MX_RECORDS],
)
# At protect() time: aj.protect(request, email="user@example.com")
```

### detect_sensitive_info

```python
from arcjet import detect_sensitive_info, Mode, SensitiveInfoEntityType
detect_sensitive_info(
    mode=Mode.LIVE,
    deny=[
        SensitiveInfoEntityType.CREDIT_CARD_NUMBER,
        SensitiveInfoEntityType.EMAIL,
    ],
)
# At protect() time: aj.protect(request, sensitive_info_value="text to scan")
```

### detect_prompt_injection

```python
from arcjet import detect_prompt_injection, Mode
detect_prompt_injection(mode=Mode.LIVE)
# At protect() time: aj.protect(request, detect_prompt_injection_message=msg)
```

### filter_request

```python
from arcjet import filter_request, Mode
filter_request(mode=Mode.LIVE, deny=["ip.src.vpn", "ip.src.tor"])
```

## Calling protect()

### FastAPI

```python
from fastapi import FastAPI, Request, HTTPException

app = FastAPI()

@app.get("/api/items")
async def list_items(request: Request):
    decision = await aj.protect(request)

    if decision.is_denied():
        if decision.reason_v2.type == "RATE_LIMIT":
            raise HTTPException(status_code=429, detail="Too many requests")
        if decision.reason_v2.type == "BOT":
            raise HTTPException(status_code=403, detail="Bot detected")
        raise HTTPException(status_code=403, detail="Forbidden")

    if decision.is_error():
        print(f"Arcjet error — proceeding: {decision.reason_v2}")

    return {"items": []}
```

### Flask

```python
from flask import Flask, request, jsonify

app = Flask(__name__)

@app.get("/api/items")
def list_items():
    decision = aj.protect(request)

    if decision.is_denied():
        if decision.reason_v2.type == "RATE_LIMIT":
            return jsonify(error="Too many requests"), 429
        return jsonify(error="Forbidden"), 403

    return jsonify(items=[])
```

## protect() Parameters

All optional keyword arguments alongside `request`:

| Parameter                         | Type             | Used by                    |
| --------------------------------- | ---------------- | -------------------------- |
| `requested`                       | `int`            | Token bucket rate limit    |
| `characteristics`                 | `dict[str, Any]` | Rate limiting              |
| `detect_prompt_injection_message` | `str`            | Prompt injection detection |
| `sensitive_info_value`            | `str`            | Sensitive info detection   |
| `email`                           | `str`            | Email validation           |
| `filter_local`                    | `dict[str, str]` | Request filters            |

## Decision API

```python
decision.is_denied()     # True if any rule denied
decision.is_allowed()    # True if all rules passed
decision.is_error()      # True if error (fails open)

# reason_v2.type values: "BOT", "RATE_LIMIT", "SHIELD", "EMAIL", "ERROR", "FILTER",
#   "SENSITIVE_INFO", "PROMPT_INJECTION"
if decision.is_denied():
    if decision.reason_v2.type == "RATE_LIMIT":
        # 429
    elif decision.reason_v2.type == "BOT":
        # 403

# Per-rule results
for result in decision.results:
    print(result.reason_v2.type, result.is_denied())
```

## withRule() Pattern

```python
from arcjet import detect_bot, sliding_window, Mode

# Base client with shield
aj = arcjet(key=os.environ["ARCJET_KEY"], rules=[shield(mode=Mode.LIVE)])

# Per-route clients
items_aj = aj.with_rule(
    detect_bot(mode=Mode.LIVE, allow=[])
).with_rule(
    sliding_window(mode=Mode.LIVE, interval=60, max=100)
)

@app.get("/api/items")
async def list_items(request: Request):
    decision = await items_aj.protect(request)
    # ...
```
