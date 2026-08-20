# Choose protections

Map the user's problem to the right Arcjet rules. Load this file when you need to pick rules for a specific concern – bot abuse, cost explosion, or prompt injection. The main `SKILL.md` only points here.

## Automated traffic and bot abuse

Automated clients – scrapers, data harvesters, and script-based attackers – treat AI features as free compute. Without bot protection, every request from a bot reaches your AI provider and inflates your costs.

Arcjet bot detection runs inside the application, before the AI call, so denied requests never reach your provider. It classifies 600+ known bots across 25 categories, verifies legitimate bots (search engines, monitors), and detects emerging threats in real time.

You configure bot rules in application code – not at the CDN layer – so you can apply different strategies per route and make decisions based on full application context (identity, subscription level, session state).

**Rules:** `detectBot` (request-based only). Pass exactly one of `allow` or `deny` – neither or both is an error. `allow` is a safelist (everything else is denied); `deny` blocks listed categories. Empty `allow=[]` blocks every detected bot. Combine with rate limiting for traffic control.

Bot rules can also be configured as remote rules via the CLI or MCP server – applied site-wide with no code changes or redeployment. Useful for blocking a newly-spotted bot category during an incident.

## Cost explosion and budget control

Automated traffic, user abuse, and prompt attacks inflate token and tool spend. Rate limiting enforces per-user token quotas to prevent cost explosions.

**Rules:** `tokenBucket`, `fixedWindow`, `slidingWindow` (request-based and guard).

Use token bucket for AI workloads where operations have variable cost – set `requested` per call to consume proportional tokens (1 for a lookup, 10 for an expensive generation). Fixed window gives a hard cap that resets at period boundaries. Sliding window provides smooth rate limiting without boundary bursts.

For request-based protection, rate limits default to keying by IP. Use `characteristics: ["userId"]` to key by something else. For Guard protection, always pass an explicit `key` (user ID or session ID) and a `bucket` name to avoid collisions.

## Prompt injection attacks

Jailbreaks, role-play escapes, and instruction overrides allow attackers to manipulate AI behavior. Arcjet inspects incoming messages for injection patterns before they reach the model. On `main`, the rule is a binary detect – there is no `threshold` or `score`.

**Rules:** `detectPromptInjection` (request-based and Guard). Use on any untrusted text before it reaches a model or tool argument – and on tool-call *results* when the tool fetches content from untrusted sources.

## Unsafe content moderation

Some AI workflows need to block unsafe, abusive, or policy-violating text even when it is not prompt injection or PII.

**Rules:** Guard content moderation only (not available on `protect()`). JS: `moderateContent` (graduated; published `@arcjet/guard` 1.10.0 still exports `experimental_moderateContent` – read the installed types). Python: `ModerateContent` (graduated; published `arcjet` 0.9.0 / 0.10.0b1 still export `experimental_ModerateContent` – read the installed types). Go: `GuardModerateContent` (`ExperimentalGuardModerateContent` remains a deprecated alias). The result is a binary `detected` / `Detected` plus optional `billing` (`text_units`) – no per-category scores. Use `hasFailedOpen()` / `has_failed_open()` / `HasFailedOpen()` as the fail-closed gate when evaluation is incomplete.

## Data loss prevention

Sensitive data leaks into AI model context, logs, third-party tool calls, or model memory through unguarded inputs and outputs. Detection always runs locally – raw text never leaves the SDK.

The **default backend** is a bundled WebAssembly engine that detects four structured types: card numbers, email addresses, phone numbers, and IP addresses. For names, addresses, and government / financial identifiers, pass the optional on-device **Rampart NER** backend: `@arcjet/sensitive-info-rampart` (`rampart()`), Python `arcjet[sensitive-info-rampart]` (`from arcjet_sensitive_info_rampart import rampart`), or Go `github.com/arcjet/arcjet-go/sensitiveinfo/rampart` (`rampart.New(...)`). Rampart needs a server runtime with filesystem / native-addon access (not edge). Listing a Rampart-only entity without a Rampart backend never matches (JS) or is a configuration error (Python / Go).

**Rules:** `sensitiveInfo` / `localDetectSensitiveInfo` / `LocalDetectSensitiveInfo` / `SensitiveInfo` / `GuardSensitiveInfo` (request-based and guard). Use to block PII from entering the system (users sending credit card numbers) or leaving it (tool outputs leaking email addresses).

## Unauthorized tool invocation

Agents invoke tools in ways they must not – issuing refunds, accessing data, escalating privileges. The prompt can be benign; the tool call is catastrophic.

**Rules:** Guard protection with per-tool rate limits and labels. Each tool call site gets its own `label` and rules, so you can enforce different budgets and detect abuse per operation. Combine with prompt injection detection on tool inputs.

`capture()` is not a protection rule. Use it after an action to record that it happened.

## Common web attacks

SQLi, XSS, and other injection attacks targeting web endpoints.

**Rules:** `shield` (request-based only). No extra options beyond `mode`. Include it on the shared client as a base rule unless the codebase has a different convention. JS and Go HTTP omitted `mode` is dry run – pass `LIVE` / `ModeLive` to enforce. Python HTTP `shield()` requires `mode=`. Cost is none.

## Signup abuse

Credential stuffing, spam registrations, and disposable email abuse on signup/login forms.

**Rules:** `validateEmail` / `validate_email` plus the signup helper (request-based only). Rejects disposable, no-MX, and invalid addresses. JS `protectSignup` is one composite rule (bot detection + email validation + rate limiting). Python `protect_signup()` returns those three factories as a tuple – unpack with `*protect_signup(...)` into `arcjet(..., rules=...)`. Go `ProtectSignup` returns `[]Rule` – assign it to `Config.Rules` or `append` other rules. Same combo, different shape. The Python helper is on `main` only (not in published 0.9.0 / 0.10.0b1).

## IP-based filtering

Block traffic by IP metadata – VPN, Tor, country, or specific IP ranges.

**Rules:** `filter` (request-based only). Can also be configured as remote rules via CLI/MCP for immediate response to active attacks without redeployment.
