---
name: integrate-arcjet-guard-agent-framework-go
description: Integrate Arcjet Guard into Microsoft Agent Framework for Go (github.com/microsoft/agent-framework-go). Wrap a functool or MCP tool with GuardTool, guard every tool an agent can see and screen inbound text with GuardMiddleware, or guard any Go function with arcjet.GuardAction. Use when asked to add Arcjet to a Go agent built on Microsoft Agent Framework, rate limit its tools, block prompt injection, or fail closed on tool calls. This is the Go framework, not the .NET or Python Microsoft Agent Framework.
license: Apache-2.0
compatibility: Requires Go >= 1.26 and github.com/arcjet/arcjet-go/agentframework v0.1.0 or later, which requires github.com/arcjet/arcjet-go v1.0.0 or later and github.com/microsoft/agent-framework-go v0.1.0 or later.
metadata:
  author: arcjet
  type: core
  library: arcjet
---

# Integrate Arcjet Guard into Microsoft Agent Framework for Go

`github.com/arcjet/arcjet-go/agentframework` wraps the application's existing
`arcjet.GuardClient`. Shared Guard fundamentals (client, rules, labels,
decisions, capture) live in
[../arcjet/references/guards_go.md](../arcjet/references/guards_go.md). Load
that reference for anything that is not framework-specific.

Three surfaces, one decision rule:

- **Any Go function** → `arcjet.GuardAction` in the root module. No
  framework dependency. Returns `*arcjet.GuardDeniedError` or
  `*arcjet.GuardUnavailableError`.
- **A `tool.FuncTool` you can name at wiring time** (from `functool.New`,
  `mcptool.ListTools`, or `agenttool.New`) → `agentframework.GuardTool`, or
  `GuardTools` for a list. The result is still a `tool.FuncTool`.
- **An agent whose tools the model picks, or user text to screen** →
  `agentframework.GuardMiddleware` in `agent.Config.Middlewares`.

This is the Go framework. The .NET and Python Microsoft Agent Framework
implementations have no Arcjet adapter. Do not import `@arcjet/guard` or
`arcjet.guard` here.

## Denials are tool results, never errors

The framework replaces a tool error with `Error: Function failed.` and
allows three consecutive rounds of failing tool calls before the fourth ends
the run. `GuardTool` therefore returns `arcjet.GuardDenialResult` as a
successful result. Do not "fix" this by returning an error, and do not set
`IncludeDetailedErrors` to make errors carry the denial.

## Fail closed by default

`GuardTool`, `GuardTools`, `GuardMiddleware`, and `arcjet.GuardAction` deny
when policy cannot be evaluated. A denied tool call returns
`arcjet.NewGuardUnavailableResult()` (reason `ERROR`, five second retry hint);
an inbound denial ends the run with that message. Set
`OnGuardError: arcjet.OnGuardErrorAllow` only where availability matters
more than enforcement, such as a read-only lookup. A `DENY` always blocks.

## Human approval is not policy

`tool.ApprovalRequiredFunc` and the `toolapproval` middleware ask a person.
`GuardTool` keeps a wrapped tool's approval status, and there is no adapter
that feeds an Arcjet decision into an auto-approval rule. Hosted tools
(`hostedtool.*`) run at the provider and cannot be guarded.

## Workflows need no separate helper

`workflow/` is not a third surface. An agent hosted with `agentworkflow` runs
through `agent.Agent.Run`, so `GuardMiddleware` and `GuardTool` apply inside a
workflow unchanged. A bare executor is ordinary Go code: call
`arcjet.GuardAction` in its handler, and decide there what a denial does to the
run, because nothing downstream will decide it for you.

Correlation does not survive the default execution environment. `inproc.Default`
is `inproc.OffThread`, whose run loop builds its own context, so an ID placed
with `arcjet.ContextWithCorrelationID` before `Run` never reaches an executor
and correlates nothing. Only `inproc.Lockstep` passes the caller's context
through. Set `GuardActionPolicy.CorrelationID` explicitly inside the executor
instead; it wins over the context in any case.

## Questions to ask the human first

Ask only what you cannot infer from the code; suggest defaults.

1. Which tools are **risky** (side effects, irreversible, spends money,
   sends messages)? Those get a fail-closed `ToolPolicy`. Read-only tools
   may use `OnGuardErrorAllow`.
2. What **limits**? ("5 refunds per hour per user" → `GuardTokenBucket`
   with a hardcoded `Bucket`.)
3. Who is the **user** for `Actor` and `SecurityMetadata.User`: an opaque
   ID from the authenticated request, never PII.
4. What is the **correlation ID**: the conversation or request ID the
   application already has. Put it on the context with
   `arcjet.ContextWithCorrelationID` before `Run`. Never mint one.
5. Should **inbound text** be screened? If yes, `GuardMiddleware` with an
   `InboundPolicy`. Failing closed there stops the agent for the duration
   of an outage, so `OnGuardErrorAllow` is a legitimate choice at that one
   site.

## The things readers get wrong

1. **Labels are hardcoded.** `Action: "refund.issued"`, never
   `fmt.Sprintf`. In a `GuardTools` policy function, `switch t.Name()`.
2. **`Action`, not `Label`.** Wrappers take `Action`; the raw
   `GuardRequest` takes `Label`. Same slug.
3. **Denial is a result.** See above.
4. **Correlation is caller-owned.** Put it on the context, or store it on
   the session under `agentframework.CorrelationIDStateKey`. Never
   `agent.Session.ServiceID`: providers rewrite it mid-run. Nothing
   generates an ID.
5. **`Args` decodes the tool's typed input.** For a struct input the
   arguments object is the value; for a scalar the framework wraps it.
6. **Wrap once.** `GuardTools` and `GuardMiddleware` skip a tool already
   wrapped by `GuardTool`, so composing them costs one evaluation per call.
7. **Rules are usually resolved from the arguments**, so `ToolPolicy.Rules`
   is a function, not a slice.
8. **`success` on capture means policy judged the action**, `degraded`
   means it ran under `OnGuardErrorAllow` without a full judgement.

## Step 1: Install and find the guard client

```bash
go get github.com/arcjet/arcjet-go@latest
go get github.com/arcjet/arcjet-go/agentframework@latest
```

The module requires Go 1.26. If the project is on an older Go, tell the user
and stop. Create one `arcjet.NewGuardClient` at package scope; it reads
`ARCJET_KEY` when `Key` is empty.

## Step 2: Gate a tool you can name: `GuardTool`

```go
guarded := agentframework.MustGuardTool(guard, issueRefund, agentframework.ToolPolicy{
	Action: "refund.issued",
	Actor:  func(context.Context, json.RawMessage) (string, error) { return userID, nil },
	Rules: agentframework.Args(func(_ context.Context, in refundArgs) ([]arcjet.GuardRuleInput, error) {
		return []arcjet.GuardRuleInput{refundLimit.Key(userID, 1)}, nil
	}),
	Metadata: arcjet.SecurityMetadata{User: userID, Reversibility: "irreversible"}.Metadata(),
})
```

`GuardTool` returns `(tool.FuncTool, error)`; `MustGuardTool` panics on a
configuration error and suits package-level initialization. For MCP tools,
wrap the output of `mcptool.ListTools` with `GuardTools` and a policy
function that switches on the tool name.

## Step 3: Gate an agent: `GuardMiddleware`

```go
mw, err := agentframework.GuardMiddleware(guard, agentframework.MiddlewareConfig{
	Tools: func(t tool.Tool) (agentframework.ToolPolicy, bool) {
		switch t.Name() {
		case "issue_refund":
			return agentframework.ToolPolicy{Action: "refund.issued", /* ... */}, true
		}
		return agentframework.ToolPolicy{}, false
	},
	Inbound: &agentframework.InboundPolicy{
		Action: "message.received",
		Rules: func(_ context.Context, text string) ([]arcjet.GuardRuleInput, error) {
			return []arcjet.GuardRuleInput{promptScan.Text(text)}, nil
		},
	},
})
a := anthropicprovider.NewAgent(client, anthropicprovider.AgentConfig{
	Config: agent.Config{Tools: tools, Middlewares: []agent.Middleware{mw}},
})
```

The middleware reaches tools from `agent.Config.Tools` and from a per-run
`agent.WithTool`.

## Step 4: Correlate

```go
ctx = arcjet.ContextWithCorrelationID(ctx, conversationID)
resp, err := a.RunText(ctx, prompt).Collect()
```

## Verify the integration

1. `go vet ./...` passes and the project builds.
2. Exercise: an allowed tool call, a rate-limited call (the model receives
   `arcjetDenied: true` and explains it), an inbound prompt-injection
   denial (the run ends before the provider is called), and fail-closed
   (an unreachable Arcjet returns `reason: "ERROR"`).
3. Confirm in the Arcjet Console or CLI that decisions share the
   caller-owned correlation ID.
4. Manual E2E with a real `ARCJET_KEY` is still-to-verify until you run it.

Worked example:
[`examples/agentframework`](https://github.com/arcjet/arcjet-go/tree/main/examples/agentframework).
Do not invent a second example name. Do not add an example in this skills
repo.
