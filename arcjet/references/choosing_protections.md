# Choose protections

Map the user's problem to the right Arcjet rules. Load this file when you need to pick rules for a specific concern – bot abuse, cost explosion, or prompt injection. The main `SKILL.md` only points here.

## Automated traffic and bot abuse

Automated clients – scrapers, data harvesters, and script-based attackers – treat AI features as free compute. Without bot protection, every request from a bot reaches your AI provider and inflates your costs.

Arcjet bot detection runs inside the application, before the AI call, so denied requests never reach your provider. It classifies 800+ known bots across 23 categories and verifies legitimate bots by IP, reverse DNS, or Web Bot Auth signature.

You configure bot rules in application code – not at the CDN layer – so you can apply different strategies per route and make decisions based on full application context (identity, subscription level, session state).

**Rules:** `detectBot` (request-based only). Pass exactly one of `allow` or `deny` – neither or both is an error. `allow` is a safelist (everything else is denied); `deny` blocks listed categories. Empty `allow=[]` blocks every detected bot. Combine with rate limiting for traffic control.

**Signed agents (Web Bot Auth; JS 1.15.0, Python 1.5.0, Go v1.3.0):** list signers in the same `allow` / `deny` by catalog name (`CHATGPT_AGENT`, `BROWSERBASE`, …) or as `SIGNED_BOT:https://<host>/.well-known/http-message-signatures-directory`. Arcjet Cloud verifies the signature.

- An existing allow list such as `CATEGORY:SEARCH_ENGINE` now **denies** verified browser agents that used to pass as browsers. Add the signers you want.
- Check `isDenied()` before `isVerifiedBot` – a verified signer missing from `allow` is denied.
- A signature is identity, not authorization. Keep rate limits on, and don't make a signature the only way a request succeeds: the first request from an uncached signer is unverified.
- Signatures covering `@path` verify only where the adapter forwards the original path (`@arcjet/node`/Express, Fastify, Nest, Next.js Pages API routes). A proxy that strips `Signature*` headers or rewrites `Host` or the path breaks verification.

Bot rules can also be configured as remote rules via the CLI or MCP server – applied site-wide with no code changes or redeployment. Useful for blocking a newly-spotted bot category during an incident.

## Cost explosion and budget control

Automated traffic, user abuse, and prompt attacks inflate token and tool spend. Rate limiting enforces per-user token quotas to prevent cost explosions.

**Rules:** `tokenBucket`, `fixedWindow`, `slidingWindow` (request-based and guard).

Use token bucket for AI workloads where operations have variable cost – set `requested` per call to consume proportional tokens (1 for a lookup, 10 for an expensive generation). Fixed window gives a hard cap that resets at period boundaries. Sliding window provides smooth rate limiting without boundary bursts.

For request-based protection, rate limits default to keying by IP. Use `characteristics: ["userId"]` to key by something else. For Guard protection, always pass an explicit `key` (user ID or session ID) and a `bucket` name to avoid collisions.

## Prompt injection attacks

Jailbreaks, role-play escapes, and instruction overrides allow attackers to manipulate AI behavior. Arcjet inspects incoming messages for injection patterns before they reach the model. The rule is a binary detect – there is no `threshold` or `score` (removed in JS 1.11.0 / Python 1.0.0). Text is capped at 128 KiB: larger text is denied in LIVE (Guard `AJ1131`). Empty or missing text is an error result, which fails open – a forgotten message selector silently allows. The text is sent to Arcjet and stored with the decision.

**Rules:** `detectPromptInjection` (request-based and Guard). Use on any untrusted text before it reaches a model or tool argument – and on tool-call *results* when the tool fetches content from untrusted sources. Fail closed: deny when the decision errored or failed open unless the app can accept unchecked text.

## Unsafe content moderation

Some AI workflows need to block unsafe, abusive, or policy-violating text even when it is not prompt injection or PII.

**Rules:** Guard content moderation only (not available on `protect()`). JS: `moderateContent` (graduated in 1.11.0; `experimental_moderateContent` is a deprecated alias). Python: `ModerateContent` (graduated in 1.0.0; `experimental_ModerateContent` is a deprecated alias). Go: `GuardModerateContent` (`ExperimentalGuardModerateContent` remains a deprecated alias). The result is a binary `detected` / `Detected` plus optional `billing` (`text_units`) – no per-category scores. Gate on `DENY` **or** `hasFailedOpen()` / `has_failed_open()` / `HasFailedOpen()`; never on `reason === "MODERATE_CONTENT"` alone. Only the first 60 KB is evaluated (warning `AJ1142`); over 128 KiB is denied (`AJ1141`). Use separate labels for input and output (`chat.input` / `chat.output`). Don't copy the checked text into `metadata`.

## Data loss prevention

Sensitive data leaks into AI model context, logs, third-party tool calls, or model memory through unguarded inputs and outputs.

On-device detection sends the decision plus each finding's entity type and position – never the matched text. Always pass the **Rampart** backend on the rule: `@arcjet/sensitive-info-rampart` (`rampart()`), Python `arcjet[sensitive-info-rampart]` (`rampart()`), or Go `github.com/arcjet/arcjet-go/sensitiveinfo/rampart` (`rampart.New(...)`). Without it only card, email, phone, and IP are detected; other types never match (JS) or are a configuration error (Python / Go). The rule does not inherit the client's backend. Rampart needs a server runtime with filesystem access (not edge; on Workers pass your own `classify`). Inference runs synchronously and is slow on long text – cap request body size. Pass an explicit `deny` list; don't rely on defaults. Fail closed: deny when the decision errored.

**PHI** (`MEDICAL_RECORD_NUMBER`, `HEALTH_PLAN_BENEFICIARY_NUMBER`, `LICENSE_PLATE_NUMBER`, `VEHICLE_IDENTIFICATION_NUMBER`, `DEVICE_IDENTIFIER`) is detected only by the **server-side** detector in a remote Guard or coding-agent policy reading a `SERVER` input – which sends the text to Arcjet. On-device rules never match these. Detection is not de-identification or HIPAA compliance; a BAA (Enterprise) is required before sending PHI.

**Rules:** `sensitiveInfo` / `localDetectSensitiveInfo` / `LocalDetectSensitiveInfo` / `SensitiveInfo` / `GuardSensitiveInfo` (request-based and guard). Use to block PII from entering the system (users sending credit card numbers) or leaving it (tool outputs leaking email addresses).

## Unauthorized tool invocation

Agents invoke tools in ways they must not – issuing refunds, accessing data, escalating privileges. The prompt can be benign; the tool call is catastrophic.

**Rules:** Guard protection with per-tool rate limits and labels. Each tool call site gets its own `label` and rules, so you can enforce different budgets and detect abuse per operation. Combine with prompt injection detection on tool inputs.

`capture()` is not a protection rule. Use it after an action to record that it happened.

## Common web attacks

SQLi, XSS, and other injection attacks targeting web endpoints.

**Rules:** `shield` (request-based only). No extra options beyond `mode`. Include it on the shared client as a base rule unless the codebase has a different convention. JS and Go HTTP omitted `mode` is dry run – pass `LIVE` / `ModeLive` to enforce. Python HTTP `shield()` requires `mode=`. Cost is none.

Shield analyzes after it returns, so the request that makes a client suspicious is allowed; later requests from the same **fingerprint** are blocked for a period. An IP-only fingerprint blocks everyone behind a shared IP – choose `characteristics` that identify one client. To test, send `x-arcjet-suspicious: true`: the first five requests pass, the sixth is denied.

## Signup abuse

Credential stuffing, spam registrations, and disposable email abuse on signup/login forms.

**Rules:** `validateEmail` / `validate_email` plus the signup helper (request-based only). Rejects disposable, no-MX, and invalid addresses. JS `protectSignup` is one composite rule (bot detection + email validation + rate limiting). Python `protect_signup()` returns those three factories as a tuple – unpack with `*protect_signup(...)` into `arcjet(..., rules=...)`. Go `ProtectSignup` returns `[]Rule` – assign it to `Config.Rules` or `append` other rules. Same combo, different shape. The Python helper ships in **1.0.0**. Empty bot `allow=[]` denies `CURL` before the email rule can run – temporarily allow `CURL` when testing with curl.

## IP-based filtering

Block traffic by IP metadata – VPN, Tor, country, or specific IP ranges.

**Rules:** `filter` (request-based only). Can also be configured as remote rules via CLI/MCP for immediate response to active attacks without redeployment.

## Coding agents (no application SDK)

Protecting the developer's own coding agent (Claude Code, Copilot, Codex, Cursor, Muse Code) is not `protect()` or `@arcjet/guard`. Publish a coding-agent policy from a Console starter, attached to **Execute on** (Tool call, Prompt, or Model switch), then install the hooks from the vendor's page under https://docs.arcjet.com/coding-agents. See the hooks paragraph in `SKILL.md` Step 3.

## Shadow AI discovery

"Which AI tools do employees use" is Arcjet Discovery: an MDM-deployed endpoint agent for macOS and Windows, viewed in the Console **Discovery** tab. It is not an SDK. Don't write `protect()` or `guard()` code for it.
