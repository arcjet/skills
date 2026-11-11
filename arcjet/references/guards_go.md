# Go Guard

## What Guard is

Guard protects code paths that do not have an HTTP request – agent tool calls, MCP handlers, queue workers, background jobs, and other non-HTTP operations. In Go, Guard is part of the same `github.com/arcjet/arcjet-go` module as request protection, but uses `NewGuardClient` and `Guard`.

## Installation

The current release is **`github.com/arcjet/arcjet-go` v1.3.0** (verified November 11, 2026), which `go get ...@latest` resolves. It requires Go 1.25+. Uppercase labels and the default `client.Guard` deadline need **v1.2.0**. If the project uses an older Go toolchain, warn the user and stop until it is upgraded.

Separate modules: `github.com/arcjet/arcjet-go/agentframework` **v0.1.0** (Go 1.26+) and `github.com/arcjet/arcjet-go/sensitiveinfo/rampart`. Install with `go get ...@latest`, not by editing `go.mod`.

## Architecture: why things go where they do

### Client at package scope

Create one `arcjet.NewGuardClient` at package scope or in a shared package.

```go
var guard = must(arcjet.NewGuardClient(arcjet.GuardConfig{
	Key: os.Getenv("ARCJET_KEY"),
}))
```

Creating the client inside a tool function means a new connection per call. `must(value, err)` is a startup helper; use the project's own pattern if it has one. Go does not load `.env` files; the process must export `ARCJET_KEY`. The key is an actor key (`ajkey_`), never a project key (`aj_prj_key_`).

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

Labels are validated as slugs: ASCII letters of either case, digits, dash (`-`), dot (`.`), and underscore (`_`), starting and ending with a letter or digit, max 256 bytes. Matched case-sensitively. Uppercase needs v1.2.0. Prefer dash/dot in new labels. Check a label you build yourself with `ValidateGuardLabel`. A slug the service will not match reads as `ALLOW` with `HasFailedOpen()` false, so the guard does not run. `Capture` warns `AJ1023` and still sends.

## Remote policy inputs

A remote policy that declares `actor` or typed inputs only sees what the call sends. Generate the call from the policy in the Console ("Generate the SDK call") so names don't drift.

```go
decision, err := guard.Guard(ctx, arcjet.GuardRequest{
	Label: "refund.issued",
	Actor: &userID, // pointer here; plain string on GuardActionPolicy
	Inputs: map[string]arcjet.GuardPolicyInput{
		"amount": arcjet.GuardPolicyServerInteger(amountCents), // int64
		"note":   arcjet.GuardPolicyLocalString(note),          // stays in process; only a digest is sent
	},
})
```

Constructors: `GuardPolicyServerString`, `GuardPolicyServerBoolean`, `GuardPolicyServerInteger` (`int64`), `GuardPolicyServerNumber` (`float64`), `GuardPolicyServerStringList`, `GuardPolicyLocalString`.

- Missing **required** input → `AJP1003`; missing required actor → `AJP1002`. Policy evaluation is `INCOMPLETE`: `Guard` returns `ALLOW` with `HasFailedOpen()` true; `GuardAction` denies. An undeclared input is dropped with warning `AJ1060`.
- Limits: 64 inputs per call, ~100 KB per server string, 256 items and ~100 KB per string list (quotes, backslashes, newlines count extra). Over any limit, every live rule fails closed with `AJP1003`.
- Server-side sensitive-info detection on a value over 2 KB can take up to 3 s. The default Guard deadline is 2 s, so give `ctx` a longer deadline or the call fails open first. At most two `SERVER` inputs over 2 KB per call (`AJP1004`). PHI types are server-side only.
- Threat-intel detector: at most 30 distinct hosts per call (`AJP1009`). A failed lookup scores `none` – pair it with an allow list.

## Rate limits and keys

All Guard rate limit rules require an explicit key at call time. Use a user ID, session ID, API key, or another stable identifier. If there is no user context, use a deliberate scope such as deployment name, process identity, or `"global"` with a comment explaining why.

The second argument to `Key` is the amount consumed. Passing `1` creates a per-operation quota. For a token budget, pass a documented preflight token estimate or declared job cost; the SDK does not tokenize prompts or know the eventual output-token count for you.

An empty `Bucket` defaults to `default-token-bucket`, `default-fixed-window`, or `default-sliding-window` (parity with JS/Python), not a shared `"default"`. Prefer an explicit `Bucket` as in the preceding example.

## Content scanning rules

- `GuardPromptInjection` – untrusted text before it reaches a model or tool argument. Max 128 KiB; a live rule denies larger text (`AJ1131`). Split long text. Optional `Billing` (`tokens`).
- `GuardModerateContent` – evaluates the first 60 KB only (warning `AJ1142`); over 128 KiB denies (`AJ1141`). Use separate labels for input and output. `ExperimentalGuardModerateContent` is a deprecated alias.
- For both: gate on `decision.IsDenied() || decision.HasFailedOpen()`, never on a reason match alone. Empty text gives an error result.
- `GuardSensitiveInfo` – on-device. Set `Backend` to one shared `rampart.New(...)`; without it only email, phone, IP, and card are detected. `MaxInputChars` defaults to **4,096** code points – raise it for long text. Over the limit, the rule returns DENY with no detected entities, without scanning – a `LOCAL` policy input is denied the same way; in `DRY_RUN` the denial is recorded, not enforced. For longer text or PHI, send a `SERVER` input to the server-side detector (~100 KB per value, at most two values over 2 KB per call – split longer text across calls). Custom detection: `rampart.Options.Recognizers`.
- `GuardCustom` – runs your local function and reports the result. Keep it deterministic and side-effect free.
- One `Guard` call evaluates at most 50 rules; the rest are `NOT_RUN` with warning `AJ1003`.

Go has no registration / free `guard()` API. Pass the client.

## Fail-closed helpers: `GuardAction`

For a sensitive tool call or action, wrap it in `arcjet.GuardAction` instead of hand-writing the `HasFailedOpen()` gate. It calls Guard (always, even with no rules, under a 2 s deadline when `ctx` has none), denies with `*arcjet.GuardDeniedError`, fails closed with `*arcjet.GuardUnavailableError` when policy could not be evaluated, runs the function otherwise, and records one capture event whose metadata `outcome` is `success`, `degraded`, `denied`, `error`, or `unavailable`.

```go
out, err := arcjet.GuardAction(ctx, guard, arcjet.GuardActionPolicy{
	Action: "refund.issued",
	Actor:  userID,
	Rules:  []arcjet.GuardRuleInput{refundLimit.Key(userID, 1)},
}, func(ctx context.Context) (Receipt, error) { return refundPayment(ctx, id) })
```

Distinguish the two errors with `errors.As`. `OnGuardError: arcjet.OnGuardErrorAllow` opts a call site back into fail-open; a `DENY` still blocks, and so does `ErrGuardMisconfigured` (an unusable request). `Resolve func(ctx) (GuardActionInputs, error)` computes `Actor`, `Inputs`, and `Rules` per call; a `Resolve` error skips Guard and is governed by `OnGuardError`. Use `arcjet.NewGuardDenialResult(decision)` / `arcjet.NewGuardUnavailableResult()` when the caller is a model and needs a JSON result.

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

- `decision.HasFailedOpen()` is true when the decision is `ALLOW` only because a rule or the decision itself could not be processed. This is the fail-closed gate for sensitive operations.
- `decision.ErrorResults()` returns the errored rule results for logging.
- Each rule also exposes a per-rule `ErrorResult(decision)` accessor – the mirror of `DeniedResult(decision)` – returning that rule's `*ArcjetError` if it errored, else `nil`. Use it to attribute a fail-open to a specific rule (for example only block when the prompt-injection scan errored) instead of scanning `ErrorResults()`.
- `decision.Warnings` holds diagnostics (`AJ1060`, `AJ1062`, `AJ1142`, `AJ1003`, stripped metadata). They never change the conclusion and are **not shown in the Console** – log them, or a misnamed input goes unnoticed.

```go
if decision.HasFailedOpen() {
	log.Printf("guard failed open: %+v", decision.ErrorResults())
}
for _, w := range decision.Warnings {
	log.Printf("guard warning: [%s] %s", w.Code, w.Message)
}
```

## Correlation IDs

Set `GuardRequest.CorrelationID` to link this call with HTTP requests and capture events. It is a dedicated field, not metadata, and does not affect the decision. A Console Sequence is the **capture events** sharing a correlation ID; decisions alone don't form one. The agent helpers read `arcjet.ContextWithCorrelationID(ctx, id)`; `Guard` and `Capture` do not, so pass `CorrelationID` to them explicitly.

## Metadata

`Metadata` is `arcjet.Metadata` (`map[string]any`), not `map[string]string`. Values may be nested maps, slices, numbers, and booleans. Do not put secrets or PII in it. Dropped keys appear on `decision.Warnings`.

## Outbound HTTP proxy

Standard `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` environment variables are honored for outbound Arcjet API calls. Do not log proxy URLs because they may contain credentials.
