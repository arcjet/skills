# Go request protection

Request protection inspects `net/http` requests (headers, IP, body) on API routes. It works with any router that exposes `*http.Request`.

## Installation

The current release is **`github.com/arcjet/arcjet-go` v1.3.0** (verified November 11, 2026), which `go get ...@latest` resolves. It requires Go 1.25+. Web Bot Auth (`SIGNED_BOT:`) needs v1.3.0. If the project uses an older Go toolchain, warn the user and stop until it is upgraded.

Install with `go get github.com/arcjet/arcjet-go@latest`, not by editing `go.mod`. Read the installed package docs for exact signatures.

## Architecture: why things go where they do

### Client at package scope

Create one `arcjet.NewClient` at package scope or in a shared package such as `internal/security`. Reuse it across handlers.

```go
package security

import (
	"os"

	"github.com/arcjet/arcjet-go"
)

var Client = must(arcjet.NewClient(arcjet.Config{
	Key: os.Getenv("ARCJET_KEY"),
	Rules: []arcjet.Rule{
		arcjet.Shield(arcjet.ShieldOptions{Mode: arcjet.ModeLive}),
	},
}))
```

Do not construct a client inside each handler. When `Key` is empty, `NewClient` reads `ARCJET_KEY`. An explicit `Key` wins. That env fallback is intentional Go policy (same as `NewGuardClient`), not a missing-key bug. There is no `ARCJET_ENV` switch.

### Protect inside handlers

Call `Protect(ctx, r, ...)` inside each route handler, once per request. Do not put it in generic middleware that runs on every path, including static assets; that removes per-route control and can double-count traffic.

```go
decision, err := security.Client.Protect(r.Context(), r)
if err != nil {
	log.Printf("arcjet: %v", err) // decision is ERROR and IsAllowed() is true
}
if decision.IsDenied() {
	if decision.Reason.IsRateLimit() {
		http.Error(w, "Too many requests", http.StatusTooManyRequests)
		return
	}
	// Block other denials too, such as one from a remote rule.
	http.Error(w, "Forbidden", http.StatusForbidden)
	return
}
if err != nil || decision.IsErrored() {
	// Fail closed on routes that send text to a model or need PII screening.
	http.Error(w, "Service unavailable", http.StatusServiceUnavailable)
	return
}
```

Order: reason-specific arms → catch-all `IsDenied()` (403) → `err` / `IsErrored()`. Without the catch-all, a remote-rule denial passes. Fail closed (503) on prompt-injection and sensitive-info routes; Shield, bot, and rate-limit routes may log and continue.

On a Decide transport failure, `Protect` returns an `ERROR` decision alongside `err`. `IsAllowed()` and `IsErrored()` are both true – do not treat a missing `err` as the only fail-open signal. Programmer errors (nil client, nil request) still return the zero `Decision{}`.

Use `client.WithRule(...)` to derive a route-specific client when a handler needs extra rules beyond the shared base protection. Derived clients share the parent cache. Separate `NewClient` calls do not. `WithRule` returns `(*arcjet.Client, error)`, so construct derived clients during initialization and handle the error rather than ignoring it.

## Choose rules

For rule selection and rate-limiting strategy comparisons, see [Choose protections](choosing_protections.md).

- `Shield` – always include. Set `ShieldOptions{Mode: arcjet.ModeLive}` to enforce. **Every HTTP Protect rule defaults to dry run** when `Mode` is the zero value – not only Shield.
- `DetectBot` – request-based only; pass exactly one of `Allow` or `Deny`. Web Bot Auth signers go in the same lists, by catalog name (`CHATGPT_AGENT`, `BROWSERBASE`, …) or as `SIGNED_BOT:https://<host>/.well-known/http-message-signatures-directory`. See [Web Bot Auth](#web-bot-auth).
- Rate limits – `TokenBucket`, `FixedWindow`, `SlidingWindow`; use `WithRequested(n)` for variable-cost calls and `WithCharacteristics(...)` for user/session keys.
- `ValidateEmail` / `ProtectSignup` – signup and login forms. `ProtectSignup` returns `[]Rule` (bot + email + rate limit) – assign it to `Config.Rules` or `append` other rules. It is not a single composite rule like JS `protectSignup`.
- `SensitiveInfo` – scans text on-device; pass text with `WithSensitiveInfoValue(...)`. Always set `Backend` (see [Sensitive information](#sensitive-information)).
- `DetectPromptInjection` – pass untrusted user text with `WithDetectPromptInjectionMessage(...)`. No threshold option. Max 128 KiB per call; a LIVE rule denies larger text. Missing or empty text is an ERROR decision (fails open), so a forgotten message silently allows.
- `Filter` – block by IP metadata, country, VPN/proxy/Tor, or request-local fields.

`NewClient` and `WithRule` sort local Protect rules like JS: SensitiveInfo → Filter → Shield → RateLimit → Bot → Email → PromptInjection. Same-priority rules keep declaration order. Do not treat Go Protect as declaration-order evaluation. SensitiveInfo-first is a privacy property – it denies before another rule can forward the payload.

## Sensitive information

Rampart is a separate module (~15 MB of embedded model weights):

```bash
go get github.com/arcjet/arcjet-go/sensitiveinfo/rampart
```

```go
var piiBackend = must(rampart.New(rampart.Options{})) // once at startup; safe for concurrent use

arcjet.SensitiveInfo(arcjet.SensitiveInfoOptions{
	Mode:    arcjet.ModeLive,
	Deny:    []arcjet.EntityType{arcjet.SensitiveInfoEmail, arcjet.SensitiveInfoCreditCardNumber},
	Backend: piiBackend,
})
```

- Without `Backend` only email, phone, IP, and card are detected. Set it on every rule; `rampart.Entities()` returns the full set.
- **Length limit:** Rampart denies input over `rampart.Options.MaxInputChars` (default **4,096** code points – far lower than JS/Python; raise it for long fields) **without scanning any of it** – it never scans a prefix and lets the rest through. The denial has an ERROR reason: `decision.IsDenied()` and `decision.Reason.IsError()` are true, `Reason.IsSensitiveInfo()` is false, so an arm that checks only the sensitive-info reason lets it through – keep the catch-all deny. Optionally answer 413. `DRY_RUN` logs a warning and doesn't deny. The limit must be a positive integer; there is no unlimited setting. For longer text or PHI, use the server-side detector (`SERVER` input, ~100 KB per value). Don't add your own length pre-check. A custom backend declares its limit by implementing `SensitiveInfoBackendLimiter` (`MaxInputChars() int`). Calling `Detect` directly still scans only the prefix.
- Custom detection is `rampart.Options.Recognizers` (`append(rampart.DefaultRecognizers, fn)`, `fn func(string) []rampart.DetectedSpan`, byte offsets). Recognizers win over the model on overlap. `Config.SensitiveInfoDetect` and `ContextWindowSize` are ignored by Rampart.
- Arcjet receives entity types and positions, never the matched text. PHI types (`MEDICAL_RECORD_NUMBER`, …) are not detected on-device; they need the server-side detector in a remote Guard policy.

## Web Bot Auth

- Arcjet Cloud verifies the signature; the SDK forwards `Signature*` headers and the original path when `Protect` receives an origin-form request target. With `ProtectDetails`, set `RawPath` only from the original request target.
- Check `decision.IsDenied()` before `decision.IsVerifiedBot()`. A verified signer missing from `Allow` is denied.
- An existing `Allow` list can now deny verified browser agents (Browserbase, ChatGPT agent). Add the signers you want.
- The first request from an uncached signer is unverified. Don't make a signature the only way a request can succeed, and keep rate limits on – a signature is not authorization.
- A proxy that strips `Signature`, `Signature-Input`, or `Signature-Agent`, rewrites `Host`, or adds a path prefix breaks verification.

## Request context

Pass the real `*http.Request` and `r.Context()` so Arcjet respects cancellation and extracts IP/header metadata correctly. Outside a supported platform, the SDK first uses a public `RemoteAddr`. When the direct peer matches `Config.Proxies`, it walks `X-Forwarded-For` right-to-left. If `RemoteAddr` is missing or non-public, it may use a public address from a common forwarding header; that result has `Provenance == "unverified-header"`, `Verified == false`, and produces one warning for the lifetime of the SDK client. Set `Config.Proxies` to every trusted proxy IP/CIDR, make the app reachable only through them, and ensure they overwrite or safely append forwarding headers. Malformed entries are rejected; `0.0.0.0/0` and `::/0` emit a warning, while the exact addresses `0.0.0.0` and `::` do not. If the app runs on a known platform, set `Config.Platform` when appropriate.

When the context has no deadline, `Protect` and `ProtectDetails` apply 2s (4s when an email rule is present). The prompt-injection 1s floor is already met. A caller-supplied deadline is never shortened.

For user-based characteristics, use identity established by trusted authentication middleware or a verified token/session. Do not trust a caller-controlled header as a user ID unless a trusted proxy strips incoming values and rewrites the header.

## Correlation IDs

Pass `arcjet.WithCorrelationID(id)` to `Protect` to link this decision with guard calls and capture events. It is a dedicated field, not `WithExtra` or `Metadata`, and does not affect the decision.

## Explicit client IP

If the application has already determined the client IP from a trusted source, pass `arcjet.WithIPSrc(ip)`. Empty and malformed values are rejected. Syntax validation does not establish provenance – do not pass a client-controlled header.

Before shipping, inspect staging requests with `client.ClientIPDetails(request)` (`IP`, `Provenance`, `Verified`, `Header`). Never copy `X-Forwarded-For` into `WithIPSrc` to bypass a warning.

## Metadata

`Protect` accepts `Metadata` as `arcjet.Metadata` (`map[string]any`) – nested JSON, not `map[string]string`. It does not affect fingerprinting or the cache key. Do not put secrets or PII in it.

## IP threat intelligence

When present, `decision.IP.Threat` is optional threat metadata (`RiskLevel`, `Confidence`, `Reputation`, `IsSafe`, `Activities`, …). Always check for `nil` before reading.

## Outbound HTTP proxy

Standard `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` environment variables are honored for outbound Arcjet API calls. Do not log proxy URLs because they may contain credentials.

## Key patterns

- Map only denial reasons that need different responses: rate limit 429; email, sensitive info, and prompt injection 400 (never echo the matched text); everything else 403 via the catch-all.
- Keep `ARCJET_KEY` in the environment. Never hardcode it.
