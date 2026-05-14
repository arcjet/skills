# Python Request Protection

## What Request Protection Is

Request protection inspects HTTP requests — headers, IP, body — to enforce security rules on API routes and form handlers. Works with FastAPI (async) and Flask (sync). Requires Python 3.10+ and `arcjet` >= 1.0.0.

## Installation

```bash
pip install arcjet
```

Read the installed package's types and docstrings for the full API surface.

## Architecture: Why Things Go Where They Do

### Shared client at module scope

For projects with multiple route files, create a separate `lib/arcjet.py` module. For single-file apps (e.g. a FastAPI `main.py`), define at the top of the file. Always include `shield()` as a base rule.

```python
import os
from arcjet import Mode, arcjet, shield

aj = arcjet(
    key=os.environ["ARCJET_KEY"],
    rules=[shield(mode=Mode.LIVE)],
)
```

Use `arcjet()` for async (FastAPI) and `arcjet_sync()` for sync (Flask). Do not create per request.

### with_rule() for per-route rules

Use `with_rule()` to add endpoint-specific rules without modifying the base client:

```python
from arcjet import detect_bot, sliding_window, Mode

items_aj = aj.with_rule(
    detect_bot(mode=Mode.LIVE, allow=[])
).with_rule(
    sliding_window(mode=Mode.LIVE, interval=60, max=100)
)
```

### protect() in route handlers

Call `protect()` inside each route handler, once per request. Pass the framework's request object directly.

## Choosing Rules

See the "Choosing the Right Rules" section in the main skill for rule selection guidance and rate limiting strategy comparisons. Key framework-specific notes:

- **shield** — always include. No configuration needed.
- **detect_bot** — `allow` and `deny` are mutually exclusive.
- **Rate limits** — use `characteristics` to key by something other than IP.
- **validate_email** — for signup/login forms.
- **detect_sensitive_info** — blocks PII in request bodies.
- **detect_prompt_injection** — for AI endpoints receiving user prompts.
- **filter_request** — block by IP metadata (VPN, Tor, country).

## Framework-Specific protect() Calls

### FastAPI (async)

```python
from fastapi import FastAPI, Request, HTTPException

@app.get("/api/items")
async def list_items(request: Request):
    decision = await aj.protect(request)
    if decision.is_denied():
        if decision.reason_v2.type == "RATE_LIMIT":
            raise HTTPException(status_code=429, detail="Too many requests")
        raise HTTPException(status_code=403, detail="Forbidden")
    # proceed...
```

### Flask (sync)

```python
from flask import Flask, request, jsonify

@app.get("/api/items")
def list_items():
    decision = aj.protect(request)
    if decision.is_denied():
        if decision.reason_v2.type == "RATE_LIMIT":
            return jsonify(error="Too many requests"), 429
        return jsonify(error="Forbidden"), 403
    # proceed...
```

## Decision Handling

`decision.is_denied()` means a LIVE rule triggered a denial. Map `decision.reason_v2.type` to HTTP status codes:

- `"RATE_LIMIT"` → 429
- `"BOT"` → 403
- `"SHIELD"` → 403
- `"EMAIL"` → 400
- `"SENSITIVE_INFO"` → 400
- `"PROMPT_INJECTION"` → 400
- `"FILTER"` → 403

`decision.is_error()` means something went wrong during rule evaluation but the SDK failed open. Log it and allow the request.

## Key Patterns

- Rules that need extra input at protect() time: `token_bucket` needs `requested=N`, `validate_email` needs `email="..."`, `detect_sensitive_info` needs `sensitive_info_value="..."`, `detect_prompt_injection` needs `detect_prompt_injection_message="..."`.
- Every rule accepts `mode=Mode.LIVE` or `mode=Mode.DRY_RUN`. Start with DRY_RUN to verify rules match expected traffic.
- For existing projects, check for an existing Arcjet client before creating a new one — extend with `with_rule()` instead.
