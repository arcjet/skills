# Python request protection

## What request protection is

Request protection inspects HTTP requests – headers, IP, body – to enforce security rules on API routes and form handlers. Works with FastAPI (async) and Flask (sync).

**Version compatibility:**

- **Python:** ≥ 3.10 (declared in `pyproject.toml`). Older versions will fail to install – warn the user and stop.
- **FastAPI / Flask:** no formal peer dependency – the SDK adapts to whatever request shape is passed (ASGI scope dict, Flask/Werkzeug `Request`, Django `HttpRequest`, or a pre-built `RequestContext`). The SDK's own tests run against `fastapi==0.135.1` and `flask==3.1.3`; very old releases of either may not expose the expected request attributes.
- **`libgcc`:** needed by the bundled WebAssembly runtime. Most Linux distributions include this by default, but Alpine Linux does not – run `apk add libgcc` first, otherwise `import arcjet` fails with `OSError: Error loading shared library libgcc_s.so.1`.

> _Published PyPI release last verified: `arcjet` **v0.9.0** on **June 30, 2026**. GitHub has a **v0.10.0b1** pre-release (**August 12, 2026**) that is **not on PyPI**. Nested metadata, Rampart, and `ip_details.threat` are in 0.10.0b1 / main. `protect_signup()` is on `main` only – not in those published wheels. `ip_src` already exists on 0.9.0. The 2000&nbsp;ms Decide timeout for every `protect()` rule is on `main` ([arcjet-py#204](https://github.com/arcjet/arcjet-py/pull/204)). HTTP rule factories require explicit `mode` on `main` ([arcjet-py#221](https://github.com/arcjet/arcjet-py/pull/221)); published wheels still default `mode` to LIVE. Check `requires-python` in [`pyproject.toml`](https://github.com/arcjet/arcjet-py/blob/main/pyproject.toml)._

## Installation

Install with whichever package manager the project already uses (`pip install`, `uv add`, or `poetry add`) – don't hand-edit `requirements.txt` with a guessed version like `arcjet>=1.0.0` (that release doesn't exist; the current minor release line is `0.x`).

```bash
pip install arcjet
```

Read the installed package's types and docstrings for the full API surface.

## Architecture: why things go where they do

### Clients at module scope

Create one `arcjet()` / `arcjet_sync()` client at module scope with the shared base rules. For route-specific extras, call `with_rule(...)` – `Arcjet.with_rule()` / `ArcjetSync.with_rule()` return a client with the extra rules appended. The clone shares this instance's `DecisionCache`, key, characteristics, and transport. The original client is unchanged.

Prefer a base client plus `with_rule(...)` over constructing a second `arcjet()` / `arcjet_sync()` with overlapping rules. Sibling constructors each get their own cache, so the same fingerprint pays a second Decide call. Use a new constructor only when the rule set is wholly different.

`with_rule()` accepts a single rule or a sequence. Stored order is declaration order. Local evaluation still re-sorts (Sensitive Info first).

On `main` only ([arcjet-py#218](https://github.com/arcjet/arcjet-py/pull/218)). Published `arcjet` 0.9.0 / 0.10.0b1 do **not** have `with_rule()`.

```python
import os
from arcjet import BotCategory, Mode, arcjet, detect_bot, shield, sliding_window

aj = arcjet(
    key=os.environ["ARCJET_KEY"],
    rules=[
        shield(mode=Mode.LIVE),
        detect_bot(mode=Mode.LIVE, allow=[BotCategory.SEARCH_ENGINE]),
    ],
)

# Read endpoints: extra lenient limit; shares aj's DecisionCache
aj_read = aj.with_rule(sliding_window(mode=Mode.LIVE, interval=60, max=100))

# Write endpoints: extra stricter limit; same shared cache
aj_write = aj.with_rule(sliding_window(mode=Mode.LIVE, interval=60, max=15))
```

Each HTTP factory requires `mode=` – `shield()`, `detect_bot()`, `sliding_window()`, and `detect_prompt_injection(*, mode=)` have no LIVE default. Guard `DetectPromptInjection` still defaults to LIVE.

For projects with multiple route files, put these clients in a separate `lib/arcjet.py` and import them. For single-file apps, define at the top of the file. Use `arcjet()` for async (FastAPI) and `arcjet_sync()` for sync (Flask). Create clients at module scope only – never inside a handler.

On `main`, `arcjet()` / `arcjet_sync()` default to a 2000 ms Decide timeout for every `protect()` rule – same in production and development. Pass `timeout_ms` to override.

If you only need one rule set across the whole app, a single client is fine.

### Call `protect()` in route handlers

Call `protect()` inside each route handler, once per request. Pass the framework's request object directly.

## Choose rules

For rule selection and rate-limiting strategy comparisons, see [Choose protections](choosing_protections.md). Key framework-specific notes:

On `main` ([arcjet-py#221](https://github.com/arcjet/arcjet-py/pull/221)), `shield`, `detect_bot`, `token_bucket`, `fixed_window`, `sliding_window`, `validate_email`, `detect_prompt_injection(*, mode=)`, `detect_sensitive_info`, and `filter_request` require `mode=Mode.LIVE` or `mode=Mode.DRY_RUN`. Omitting `mode` raises `TypeError` – they do not default to LIVE, and they do not silently default to DRY_RUN (the JS HTTP default). Nested mappings passed to `protect_signup` must include `mode` because they forward to those factories. Published `arcjet` 0.9.0 / 0.10.0b1 still default `mode` to LIVE. Guard `DetectPromptInjection` still defaults to LIVE.

- **`shield`** – always include. Requires `mode=Mode.LIVE` or `mode=Mode.DRY_RUN`.
- **`detect_bot`** – pass exactly one of `allow` or `deny`. Neither or both raises `ValueError` – the factory no longer treats an omitted list as empty. Empty `allow=[]` is valid and means "block every detected bot"; that is an allow-config, not the same as writing `detect_bot()` with no lists. The usual starting point is `allow=[BotCategory.SEARCH_ENGINE]`.
- **Rate limits** – use `characteristics` to key by something other than IP.
- **`validate_email`** – for signup/login forms. Same XOR contract as `detect_bot`: exactly one of `allow` or `deny`. Typical signup config is `deny=[EmailType.DISPOSABLE, EmailType.INVALID]`. Empty `allow=[]` allows no email types. `validate_email()` with no lists raises the same `ValueError`.
- **`protect_signup`** – signup/login helper: sliding-window rate limit + bot detection + email validation. Returns a tuple – unpack with `*protect_signup(...)` into `arcjet(..., rules=...)` / `arcjet_sync(...)`. It is **not** a single composite rule like JS `protectSignup`. Keyword-only mappings `rate_limit`, `bots`, and `email` are forwarded to those factories. Nested `bots` / `email` still need exactly one of `allow` or `deny` (`allow=[]` is valid). On `main` only – not in published 0.9.0 / 0.10.0b1.
- **`detect_sensitive_info`** – blocks PII in request bodies. Default backend is WASM (card, email, phone, IP). For names, addresses, and government / financial identifiers, install `arcjet[sensitive-info-rampart]` and pass `backend=rampart()` from `arcjet_sensitive_info_rampart`.
- **`detect_prompt_injection`** – for AI endpoints receiving user prompts. On `main`, do not pass `threshold` – it is a `TypeError`. HTTP `detect_prompt_injection(*, mode=)` is required; omitting `mode` is also a `TypeError`. New configs are `detect_prompt_injection(mode=Mode.LIVE)`. Guard `DetectPromptInjection` still defaults to LIVE.
- **`filter_request`** – block by IP metadata (VPN, Tor, country).

For a signup/login form, unpack the helper into `rules` rather than listing the three factories as the only path:

```python
import os
from arcjet import EmailType, Mode, arcjet, protect_signup, shield

aj_signup = arcjet(
    key=os.environ["ARCJET_KEY"],
    rules=[
        shield(mode=Mode.LIVE),
        *protect_signup(
            rate_limit={"mode": Mode.LIVE, "max": 5, "interval": 600},
            bots={"mode": Mode.LIVE, "allow": []},
            email={
                "mode": Mode.LIVE,
                "deny": [
                    EmailType.DISPOSABLE,
                    EmailType.INVALID,
                    EmailType.NO_MX_RECORDS,
                ],
            },
        ),
    ],
)
```

### Local evaluation order

On `main` ([arcjet-py#213](https://github.com/arcjet/arcjet-py/pull/213)), local Protect evaluation sorts by the JS priority table (same ranks as Go), not the order of `rules=[...]`. The first LIVE DENY short-circuits, so declaration order does not control which LIVE DENY is reported. Do not reorder the list to pick a winner.

| Rank | Local Protect rule |
| ---- | ------------------ |
| 1 | Sensitive Info (`detect_sensitive_info`) |
| 2 | Filter (`filter_request`) |
| 3 | Shield (`shield`) |
| 4 | Rate limit (`token_bucket` / `fixed_window` / `sliding_window`) |
| 5 | Bot (`detect_bot`) |
| 6 | Email (`validate_email`) |
| 7 | Prompt Injection (`detect_prompt_injection`) |
| 100 | Unmapped types (sort last) |

Same-priority rules keep declaration order – the three rate-limit factories share rank 4. Sensitive Info first is a privacy property: it denies before another rule can forward the payload.

Rank 7 is listed for JS/Go parity only. `PromptInjectionDetection` is **not** evaluated locally today – Python does not run prompt injection in WASM on `protect()`. Do not assume a local PI deny.

## Framework-specific `protect()` calls

### FastAPI (async)

```python
from fastapi import Request, HTTPException

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
from flask import request, jsonify

@app.get("/api/items")
def list_items():
    decision = aj.protect(request)
    if decision.is_denied():
        if decision.reason_v2.type == "RATE_LIMIT":
            return jsonify(error="Too many requests"), 429
        return jsonify(error="Forbidden"), 403
    # proceed...
```

## Decision handling

`decision.is_denied()` means a LIVE rule triggered a denial. Map `decision.reason_v2.type` to HTTP status codes, but **only branch on reasons that produce a different response** – skip arms that would just return the same status as the default 403:

- `"RATE_LIMIT"` → 429
- `"EMAIL"` → 400
- `"SENSITIVE_INFO"` → 400
- `"PROMPT_INJECTION"` → 400
- everything else (`"BOT"`, `"SHIELD"`, `"FILTER"`, fallback) → default 403

A branch that returns 403 for SHIELD when the default already returns 403 is dead code; drop it.

`decision.is_error()` means something went wrong during rule evaluation but the SDK failed open. Log it and allow the request.

### Correlation IDs

Available from **`arcjet` 0.9.0**: pass `correlation_id` to `protect()` when the Arcjet decision must be correlated with a guard call, workflow run, or agent trace. It is a dedicated field, not `extra` or `metadata`, and it does not affect fingerprinting or the decision cache key.

```python
decision = await aj.protect(request, correlation_id=request_id)
```

### Explicit client IP

If the application has already determined the client IP from a trusted source, disable automatic detection when creating the client and pass `ip_src` to every `protect()` call:

```python
aj = arcjet(key=os.environ["ARCJET_KEY"], rules=[...], disable_automatic_ip_detection=True)
decision = await aj.protect(request, ip_src=get_client_ip_from_trusted_source(request))
```

When automatic detection is disabled, omitting `ip_src` or passing `""` raises `ArcjetMisconfiguration`. Passing a non-empty `ip_src` while automatic detection is enabled also raises. The SDK trusts `ip_src` without validating it – do not pass a client-controlled header. This option cannot be combined with `proxies`.

### Metadata

`protect()` accepts `metadata` – nested JSON, not a flat string map. It is attached to the decision for analytics and does not affect fingerprinting or the cache key. Do not put secrets or PII in it. `protect()` has no warnings channel; keys the SDK cannot encode are logged at `WARNING`.

### IP threat intelligence

When present, `decision.ip_details.threat` is optional threat metadata (`risk_level`, `confidence`, `reputation`, `is_safe`, `activities`, …). Always check before reading – it is omitted when unavailable.

### Outbound HTTP proxy

Available from **`arcjet` 0.9.0**: the SDK honors standard `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` environment variables for outbound Arcjet API calls. Because Arcjet is contacted over HTTPS, `HTTPS_PROXY` is the relevant variable for most deployments. Do not log proxy URLs because they may contain credentials.

### Inspect helpers

When the handler needs to treat a verified crawler, a missing `User-Agent`, or a spoofed bot differently from a plain `is_denied()`, import the helpers from `arcjet` – there is no Python `@arcjet/inspect` package. Parsing `reason_v2` by hand recreates the same checks and usually misses the `DRY_RUN` filter.

`is_verified_bot` and `is_missing_user_agent` are on `main` ([arcjet-py#214](https://github.com/arcjet/arcjet-py/pull/214)). `is_spoofed_bot` already exists on 0.9.0 / 0.10.0b1; on `main` it also ignores `DRY_RUN` ([arcjet-py#216](https://github.com/arcjet/arcjet-py/pull/216)). The new helpers are not in those published wheels – read the installed package before importing.

```python
from arcjet import is_missing_user_agent, is_spoofed_bot, is_verified_bot

# Verified search-engine crawler – skip other signals and return SEO content
if any(is_verified_bot(r) for r in decision.results):
    return {"message": "Hello bot"}

# Missing User-Agent is a strong non-browser signal (RFC 9110 recommends the header)
if any(is_missing_user_agent(r) for r in decision.results):
    raise HTTPException(status_code=400, detail="User-Agent required")

# Client claimed to be a known crawler from an unverified IP
if any(is_spoofed_bot(r) for r in decision.results):
    raise HTTPException(status_code=403, detail="Spoofed bot")
```

- `is_verified_bot(result)` – a live bot rule matched the client IP against official crawler ranges.
- `is_missing_user_agent(result)` – a live bot rule failed because `User-Agent` was missing.
- `is_spoofed_bot(result)` – a live bot rule found a spoofed user agent.

All three ignore `DRY_RUN` results (same as JS `isActive`) so an observation-only rule cannot drive the response ([arcjet-py#216](https://github.com/arcjet/arcjet-py/pull/216) aligned `is_spoofed_bot`). They return `False` for dry-run and non-bot results – Python is `bool`, not JS's `boolean | undefined`.

### Rate-limit headers

When a rate-limit rule is in play and the client needs to see remaining budget, call `set_rate_limit_headers` from `arcjet` instead of formatting IETF headers by hand. JS uses a separate `@arcjet/decorate` package; Python exports the same writer from `arcjet`. On `main` only ([arcjet-py#214](https://github.com/arcjet/arcjet-py/pull/214)).

```python
from arcjet import set_rate_limit_headers

decision = await aj.protect(request)
set_rate_limit_headers(response, decision)
# RateLimit: limit=100, remaining=3, reset=9
# RateLimit-Policy: 100;w=60
if decision.is_denied():
    raise HTTPException(status_code=429, detail="Too many requests")
```

Call it after `protect()` on the response you will return – including allowed requests. The target can be a FastAPI / Starlette / Flask `response` (uses `.headers`), a Fetch-style Headers object, a Node-style `setHeader` response, or a mutable mapping.

When several rate-limit results are present, the tightest remaining budget is advertised (`remaining`, then `reset`, then `max`). Two policies that share the same `max` abort – no headers are written, because the IETF field cannot disambiguate them. Don't give two rate-limit rules the same `max` if you want these headers. No rate-limit results, or an unrecognized target, is a no-op.

## Deprecations

As of `arcjet` 0.9.0, the request-based SDK still carries a few deprecated bits. Don't use them in new code; migrate existing uses when convenient.

- **`decision.reason` / `result.reason` → use `decision.reason_v2` / `result.reason_v2`.** The legacy `reason` accessor returns a tagged-union helper (`reason.is_rate_limit()`) and is marked `@deprecated`. `reason_v2` returns a typed discriminated union – branch on `reason_v2.type` (`"RATE_LIMIT"`, `"BOT"`) and read typed fields directly (`reason_v2.remaining`, `reason_v2.spoofed`). A TODO in the SDK notes the name `reason_v2` is itself transitional and is planned to fold back into `reason` in a later major; until then `reason_v2` is the right call.
- **`PromptInjectionReason.score`** – the `score` field on the reason returned for prompt-injection denials is no longer populated meaningfully and will be removed. Don't read it; rely on `reason_v2.type == "PROMPT_INJECTION"` instead.
- **`arcjet._decision.Reason`** – internal type; use `arcjet._dataclasses.Reason` (re-exported as `arcjet.Reason`) if you need the type annotation. Most callers won't touch this directly.

On `main` ([arcjet-py#217](https://github.com/arcjet/arcjet-py/pull/217)), `detect_prompt_injection(threshold=...)` is **removed**, not deprecated. Passing `threshold` raises `TypeError`. The server never honored it. New configs are `detect_prompt_injection(mode=Mode.LIVE)` – `mode` is required; omitting it is a `TypeError` ([arcjet-py#221](https://github.com/arcjet/arcjet-py/pull/221)). Drop leftover `threshold` from existing configs; unlike JS core, which ignores leftover `threshold`, Python throws. Published `arcjet` 0.9.0 / 0.10.0b1 still accept `threshold` (deprecated) and still default `mode` to `LIVE`.

> _Deprecations last verified against the published `arcjet` v0.9.0 on **June 30, 2026**. `threshold` removal is on `main` ([arcjet-py#217](https://github.com/arcjet/arcjet-py/pull/217)); required `mode` is on `main` ([arcjet-py#221](https://github.com/arcjet/arcjet-py/pull/221)). Before relying on these items, grep the installed package for new `@deprecated` markers – see [`src/arcjet/_decision.py`](https://github.com/arcjet/arcjet-py/blob/main/src/arcjet/_decision.py), [`src/arcjet/_dataclasses.py`](https://github.com/arcjet/arcjet-py/blob/main/src/arcjet/_dataclasses.py), and [`src/arcjet/_rules.py`](https://github.com/arcjet/arcjet-py/blob/main/src/arcjet/_rules.py)._

## Key patterns

- `detect_bot` and `validate_email` each take exactly one of `allow` or `deny`. Passing neither (or both) raises `ValueError`. `allow=[]` is the explicit "block every bot" / "allow no email types" config – do not omit the list.
- Local Protect evaluation follows the JS priority table, not `rules=[...]` order. The first LIVE DENY short-circuits. Do not reorder the list to pick which deny is reported. Prompt injection is in that table for parity only – it is not evaluated locally today ([arcjet-py#213](https://github.com/arcjet/arcjet-py/pull/213)).
- Rules that need extra input at protect() time: `token_bucket` needs `requested=N`, `validate_email` / `protect_signup` needs `email="..."`, `detect_sensitive_info` needs `sensitive_info_value="..."`, `detect_prompt_injection` needs `detect_prompt_injection_message="..."`.
- Signup/login: import `protect_signup` from `arcjet` and unpack with `*protect_signup(...)` into `rules`. It is three rules, not one – do not pass the helper as a single list item. Nested mappings must include `mode`. `protect(..., email=...)` is unchanged.
- HTTP rule factories require `mode=Mode.LIVE` or `mode=Mode.DRY_RUN`. Omitting `mode` raises `TypeError` – not a LIVE default, and not a silent DRY_RUN default (JS HTTP). That includes HTTP `detect_prompt_injection(*, mode=)`. Nested mappings passed to `protect_signup` must include `mode` because they forward to those factories. Start with DRY_RUN to verify rules match expected traffic. Guard constructors – including `DetectPromptInjection` – still default to LIVE.
- For existing projects, check for an existing Arcjet client before creating a new one. Prefer `with_rule(...)` for route-specific extras so clones share `DecisionCache`. A second `arcjet()` / `arcjet_sync()` with overlapping rules does not share cache and pays a second Decide call for the same fingerprint. Use a new constructor only for a wholly different rule set.
- Inspect bot results with `is_verified_bot` / `is_missing_user_agent` / `is_spoofed_bot` from `arcjet` (not a separate package). All three ignore `DRY_RUN`. Write IETF `RateLimit` / `RateLimit-Policy` with `set_rate_limit_headers(response, decision)` – tightest remaining budget; two policies with the same `max` abort.
