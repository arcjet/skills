# Go request protection

## What request protection is

Request protection inspects `net/http` requests – headers, IP, body – to enforce security rules on API routes and handlers. The Go SDK works with `net/http` and routers/frameworks that expose `*http.Request`.

## Installation

The published tag is **`github.com/arcjet/arcjet-go` v0.1.0** (June 30, 2026). The module is pre-release and unstable. `go get ...@latest` still resolves that tag. Nested `Metadata`, `WithIPSrc`, Rampart, `decision.IP.Threat`, and Protect transport-failure ERROR decisions are on the module default branch. The module declares **Go 1.25** in `go.mod`; if the project uses an older Go toolchain, warn the user and stop until it is upgraded.

Install with Go tooling, not by editing `go.mod` directly:

```bash
go get github.com/arcjet/arcjet-go@latest
```

Read the installed package docs for exact API signatures.

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

Do not construct a client inside each handler; it wastes connections and makes rules harder to manage.

When `Key` is empty, `NewClient` reads `ARCJET_KEY`. An explicit `Key` wins. That env fallback is intentional Go policy (same as `NewGuardClient`), not a missing-key bug. There is no `ARCJET_ENV` switch.

### Protect inside handlers

Call `Protect(ctx, r, ...)` inside each route handler, once per request. Do not put it in generic middleware that runs on every path, including static assets; that removes per-route control and can double-count traffic.

```go
decision, err := security.Client.Protect(r.Context(), r)
if err != nil {
	// Arcjet fails open. Log and continue, or apply your fallback policy.
	log.Printf("arcjet: %v", err)
} else if decision.IsDenied() {
	status := http.StatusForbidden
	if decision.Reason.IsRateLimit() {
		status = http.StatusTooManyRequests
	}
	http.Error(w, "denied", status)
	return
}
```

On a Decide transport failure, `Protect` returns an `ERROR` decision alongside `err`. `IsAllowed()` and `IsErrored()` are both true – do not treat a missing `err` as the only fail-open signal. Programmer errors (nil client, nil request) still return the zero `Decision{}`.

Use `client.WithRule(...)` to derive a route-specific client when a handler needs extra rules beyond the shared base protection. Derived clients share the parent cache. Separate `NewClient` calls do not. `WithRule` returns `(*arcjet.Client, error)`, so construct derived clients during initialization and handle the error rather than ignoring it.

## Choose rules

For rule selection and rate-limiting strategy comparisons, see [Choose protections](choosing_protections.md).

- `Shield` – always include. Set `ShieldOptions{Mode: arcjet.ModeLive}` to enforce. **Every HTTP Protect rule defaults to dry run** when `Mode` is the zero value – not only Shield.
- `DetectBot` – request-based only; pass exactly one of `Allow` or `Deny`.
- Rate limits – `TokenBucket`, `FixedWindow`, `SlidingWindow`; use `WithRequested(n)` for variable-cost calls and `WithCharacteristics(...)` for user/session keys.
- `ValidateEmail` / `ProtectSignup` – signup and login forms. `ProtectSignup` returns `[]Rule` (bot + email + rate limit) – assign it to `Config.Rules` or `append` other rules. It is not a single composite rule like JS `protectSignup`.
- `SensitiveInfo` – scans text locally before it leaves the process; pass text with `WithSensitiveInfoValue(...)`. Default backend is WASM (email, phone, IP, card). For names, addresses, and government / financial identifiers, set `Backend` to a `rampart.New(...)` from `github.com/arcjet/arcjet-go/sensitiveinfo/rampart`. `SensitiveInfoOptions.ContextWindowSize` is an `int` (default 1); a custom `SensitiveInfoDetect` sees a window of that size. `GuardSensitiveInfo` does not expose this option – its window is always 1.
- `DetectPromptInjection` – pass untrusted user text with `WithDetectPromptInjectionMessage(...)`. There is no threshold option.
- `Filter` – block by IP metadata, country, VPN/proxy/Tor, or request-local fields.

`NewClient` and `WithRule` sort local Protect rules like JS: SensitiveInfo → Filter → Shield → RateLimit → Bot → Email → PromptInjection. Same-priority rules keep declaration order. Do not treat Go Protect as declaration-order evaluation. SensitiveInfo-first is a privacy property – it denies before another rule can forward the payload.

## Request context

Pass the real `*http.Request` and `r.Context()` so Arcjet respects cancellation and extracts IP/header metadata correctly. If the app is behind trusted reverse proxies, set `Config.Proxies` to the trusted proxy IPs/CIDRs. If the app runs on a known platform, set `Config.Platform` when appropriate.

When the context has no deadline, `Protect` and `ProtectDetails` apply 2s (4s when an email rule is present). The prompt-injection 1s floor is already met. A caller-supplied deadline is never shortened.

For user-based characteristics, use identity established by trusted authentication middleware or a verified token/session. Do not trust a caller-controlled header as a user ID unless a trusted proxy strips incoming values and rewrites the header.

## Correlation IDs

Pass `arcjet.WithCorrelationId(id)` to `Protect` to correlate this decision with guard calls, workflow runs, or agent traces. It is a dedicated field, not `WithExtra` or `Metadata`, and does not affect the decision.

## Explicit client IP

If the application has already determined the client IP from a trusted source, pass `arcjet.WithIPSrc(ip)`. The SDK trusts the value without validating it – do not pass a client-controlled header.

## Metadata

`Protect` accepts `Metadata` as `arcjet.Metadata` (`map[string]any`) – nested JSON, not `map[string]string`. It does not affect fingerprinting or the cache key. Do not put secrets or PII in it.

## IP threat intelligence

When present, `decision.IP.Threat` is optional threat metadata (`RiskLevel`, `Confidence`, `Reputation`, `IsSafe`, `Activities`, …). Always check for `nil` before reading.

## Outbound HTTP proxy

Available in **`arcjet-go` v0.1.0**: standard `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` environment variables are honored for outbound Arcjet API calls. Do not log proxy URLs because they may contain credentials.

## Key patterns

- Use `ModeLive` for enforcement and `ModeDryRun` to observe before blocking. HTTP Protect omitted `Mode` is dry run for every rule.
- Map only denial reasons that need different responses: rate limits usually return 429; email, sensitive info, and prompt injection often return 400; bot, shield, and filter denials usually return 403.
- Keep `ARCJET_KEY` in the environment. Never hardcode it.
