# Go Guard

## What Guard is

Guard protects code paths that do not have an HTTP request – agent tool calls, MCP handlers, queue workers, background jobs, and other non-HTTP operations. In Go, Guard is part of the same `github.com/arcjet/arcjet-go` module as request protection, but uses `NewGuardClient` and `Guard`.

## Installation

The current release is **`github.com/arcjet/arcjet-go` v1.0.0** (September 17, 2026), which `go get ...@latest` resolves. It requires Go 1.25+. Capture, Rampart, nested metadata, `WithIPSrc`, threat/billing, `GuardModerateContent`, and required Guard `Mode` are all in it. If the project uses an older Go toolchain, warn the user and stop until it is upgraded.

The Microsoft Agent Framework helpers are a separate module, **`github.com/arcjet/arcjet-go/agentframework` v0.1.0**, which requires Go 1.26+ because the framework does.

Install with Go tooling:

```bash
go get github.com/arcjet/arcjet-go@latest
```

## Architecture: why things go where they do

### Client at package scope

Create one `arcjet.NewGuardClient` at package scope or in a shared package.

```go
var guard = must(arcjet.NewGuardClient(arcjet.GuardConfig{
	Key: os.Getenv("ARCJET_KEY"),
}))
```

The client owns the connection to Arcjet. Creating it inside a tool function means a new connection per call.
The snippets use a small generic `must(value, err)` startup helper; use the project's existing initialization/error pattern if it has one.

Go does not load `.env` files automatically. Ensure the worker process or service manager exports `ARCJET_KEY`, or use the project's existing environment loader. Do not add a dotenv dependency solely to copy this example without reviewing it first.

When `Key` is empty, `NewGuardClient` reads `ARCJET_KEY`. An explicit `Key` wins. That env fallback is intentional Go policy (same as `NewClient`), not a missing-key bug. JavaScript Guard never reads environment variables; Python Guard requires an explicit key. There is no `ARCJET_ENV` switch.

### Rules at package scope

Declare configured rules at package scope so their result accessors are available and the configuration stays visible.

```go
var userLimit = must(arcjet.GuardTokenBucket(arcjet.GuardTokenBucketOptions{
	Mode:       arcjet.ModeLive,
	Label:      "tools.weather.limit",
	Bucket:     "tools-weather",
	RefillRate: 10,
	Interval:   time.Minute,
	Capacity:   10,
}))

var promptScan = must(arcjet.GuardPromptInjection(
	arcjet.GuardPromptInjectionOptions{Mode: arcjet.ModeLive},
))
```

Guard constructors require `Mode: arcjet.ModeLive` or `Mode: arcjet.ModeDryRun`. An empty `Mode` returns `ErrInvalidMode` – it does not fall through to dry run. HTTP Protect rules still default to `DRY_RUN`.

### Guard at the operation

Call `Guard` at the specific operation with a hardcoded label. Do not protect a generic dispatcher with labels derived from tool names.

```go
decision, err := guard.Guard(ctx, arcjet.GuardRequest{
	Label: "tools.get-weather",
	Metadata: arcjet.Metadata{
		"user": map[string]any{"id": userID},
	},
	Rules: []arcjet.GuardRuleInput{
		userLimit.Key(userID, requestedTokens),
		promptScan.Text(userMessage),
	},
})
if err != nil {
	// Configuration/programmer errors can return a zero decision, so do not
	// assume IsDenied or HasFailedOpen will catch every non-nil error.
	return fmt.Errorf("arcjet guard: %w", err)
}
if decision.HasFailedOpen() {
	// This sensitive operation chooses to fail closed.
	return fmt.Errorf("arcjet guard failed open: %+v", decision.ErrorResults())
}
if decision.IsDenied() {
	if rateLimited := userLimit.DeniedResult(decision); rateLimited != nil {
		return fmt.Errorf("rate limited")
	}
	return fmt.Errorf("blocked: %s", decision.Reason)
}
```

Labels are validated as slugs: lowercase letters, digits, dash (`-`), dot (`.`), and underscore (`_`), starting and ending with a lowercase letter or digit. Uppercase is rejected, so use `tools.get-weather` or `tools.get_weather`, not `tools.getWeather`. Prefer dash/dot in new labels. Check a label you build yourself with `ValidateGuardLabel`. A slug the service will not match reads as `ALLOW` with `HasFailedOpen()` false, so the guard does not run. `Capture` warns `AJ1023` and still sends.

## Rate limits and keys

All Guard rate limit rules require an explicit key at call time. Use a user ID, session ID, API key, or another stable identifier. If there is no user context, use a deliberate scope such as deployment name, process identity, or `"global"` with a comment explaining why.

The second argument to `Key` is the amount consumed. Passing `1` creates a per-operation quota. For a token budget, pass a documented preflight token estimate or declared job cost; the SDK does not tokenize prompts or know the eventual output-token count for you.

An empty `Bucket` defaults to `default-token-bucket`, `default-fixed-window`, or `default-sliding-window` (parity with JS/Python), not a shared `"default"`. Prefer an explicit `Bucket` as in the preceding example.

## Content scanning rules

- `GuardPromptInjection` – use on untrusted text before it reaches a model or tool argument. The result may include optional `Billing` (`tokens`).
- `GuardSensitiveInfo` – use to block PII entering or leaving the system; scanning happens locally. Default backend is WASM (email, phone, IP, card). For names, addresses, and government / financial identifiers, set `Backend` to a `rampart.New(...)` from `github.com/arcjet/arcjet-go/sensitiveinfo/rampart`. Create the backend once at startup.
- `GuardModerateContent` – Guard-only content moderation. Result is binary `Detected` plus optional `Billing` (`text_units`). `ExperimentalGuardModerateContent` is a deprecated alias.
- `GuardCustom` – runs your local custom function and reports the result to Arcjet. Keep the function deterministic and side-effect free.

Go has no registration / free `guard()` API. Pass the client.

## Fail-closed helpers: `GuardAction`

For a sensitive tool call or action, wrap it in `arcjet.GuardAction` instead of hand-writing the `HasFailedOpen()` gate. It calls Guard (always, even with no rules), denies with `*arcjet.GuardDeniedError`, fails closed with `*arcjet.GuardUnavailableError` when policy could not be evaluated, runs the function otherwise, and records one capture event whose metadata `outcome` is `success`, `degraded`, `denied`, `error`, or `unavailable`.

```go
out, err := arcjet.GuardAction(ctx, guard, arcjet.GuardActionPolicy{
	Action: "refund.issued",
	Actor:  userID,
	Rules:  []arcjet.GuardRuleInput{refundLimit.Key(userID, 1)},
}, func(ctx context.Context) (Receipt, error) { return refundPayment(ctx, id) })
```

Distinguish the two errors with `errors.As`. `OnGuardError: arcjet.OnGuardErrorAllow` opts a call site back into fail-open; a `DENY` still blocks. Use `arcjet.NewGuardDenialResult(decision)` and `arcjet.NewGuardUnavailableResult()` when the caller is a model and needs a JSON result rather than a Go error. Available from `arcjet-go` v1.0.0.

For Microsoft Agent Framework for Go, load [integrate-arcjet-guard-agent-framework-go](../../integrate-arcjet-guard-agent-framework-go/SKILL.md) instead of wrapping tools by hand.

## Capture and flush

`Capture` records that an action happened. It is not a security decision – it never denies, never returns an error, and never sets `HasFailedOpen()`.

```go
guard.Capture(arcjet.CaptureEvent{
	Action:        "refund.issued",
	CorrelationID: runID,
	DecisionID:    decision.ID,
	Metadata: arcjet.Metadata{
		"invoice":  map[string]any{"id": "inv_123", "amount": 4200},
		"refunded": true,
	},
})
```

Call `Flush(ctx)` on shutdown (one-second deadline if `ctx` has none). `Close` flushes first, then releases local wasm.

## Errors vs warnings

Available in **`arcjet-go` v0.1.0**:

- `decision.HasFailedOpen()` is true when the decision is `ALLOW` only because a rule or the decision itself could not be processed. This is the fail-closed gate for sensitive operations.
- `decision.ErrorResults()` returns the errored rule results for logging.
- Each rule also exposes a per-rule `ErrorResult(decision)` accessor – the mirror of `DeniedResult(decision)` – returning that rule's `*ArcjetError` if it errored, else `nil`. Use it to attribute a fail-open to a specific rule (for example only block when the prompt-injection scan errored) instead of scanning `ErrorResults()`.
- `decision.Warnings` contains decision-level diagnostics such as invalid metadata that was stripped. Warnings never change the conclusion.

```go
if decision.HasFailedOpen() {
	log.Printf("guard failed open: %+v", decision.ErrorResults())
}
for _, w := range decision.Warnings {
	log.Printf("guard warning: [%s] %s", w.Code, w.Message)
}
```

## Correlation IDs

Set `GuardRequest.CorrelationID` to correlate this guard call with HTTP requests, workflow runs, or agent traces. It is a dedicated field, not metadata, and does not affect the decision. The agent helpers read `arcjet.ContextWithCorrelationID(ctx, id)`; `Guard` and `Capture` do not, so pass `CorrelationID` to them explicitly.

## Metadata

`Metadata` is `arcjet.Metadata` (`map[string]any`), not `map[string]string`. Values may be nested maps, slices, numbers, and booleans. Do not put secrets or PII in it. Dropped keys appear on `decision.Warnings`.

## Outbound HTTP proxy

Available in **`arcjet-go` v0.1.0**: standard `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` environment variables are honored for outbound Arcjet API calls. Do not log proxy URLs because they may contain credentials.
