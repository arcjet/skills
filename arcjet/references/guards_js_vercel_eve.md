# JavaScript Guard: Vercel Eve

Load [guards_javascript.md](guards_javascript.md) for the client, rules, labels, decisions, capture, and the shared `ArcjetDenialResult` shape. This file is only the Vercel Eve adapter. Do not also wrap with a sibling adapter.

Docs: https://docs.arcjet.com/guards/vercel-eve/

Exports: `guardTool`, `guardApproval`, `guardInbound`, `arcjetHooks`, `eveAgentContext`. Import `@arcjet/guard/vercel-eve/v0` – there is no unversioned alias and no `/v1`. Optional peer `eve` `>=0.34.0 <1`. Eve is still 0.x. Node.js ≥ 24. The request/response form ships in 1.11.0. A connection's tools have no local handler, so `guardApproval` is the only enforcement that reaches them.

`guardInbound` and `arcjetHooks` are unchanged. `guardTool` still throws `ArcjetDeniedError` (Eve projects that as a failed `action.result`). Opt in to a returned `ArcjetDenialResult` with `onDeny: "result"` so an `outputSchema` is not silently violated. `defineDynamic` / OpenAPI / MCP connections have no local `execute` – use `guardApproval`, not `guardTool`. `guardApproval` never throws; it returns Eve approval objects (`denied` / `rejected` / `allowed`). Eve 0.34+ request/response approval:

- **`approval` is one field.** It can be a function (request-time only) or `{ request, response }`. You cannot compose `guardApproval` with Eve's `always()` / `once()` / `never()`.
- Omit `response` and `guardApproval()` returns Eve's `ApprovalPolicy` function. Set `response` and it returns `{ request, response }` (`ApprovalConfiguration`).
- **`onAllow: "user-approval"`** parks the call for a human after the request-time gate.
- Optional `response` is `GuardApprovalResponsePolicy` against Eve's `ApprovalResponseContext`. Use it to authorize who may approve a parked HITL request (for example key a limit on `ctx.responder.principalId`). The request-time policy typically keys on `ctx.session.id` – split buckets, don't share one.
- Response-time ALLOW → `{ status: "allowed" }`. If the response policy denies the responder, or Arcjet is unreachable and `onGuardError` is `"deny"` (default), it returns `{ status: "rejected", reason }` and the approval stays pending. A rejection does not deny the tool.
- Request-time denials remain `{ type: "denied", reason }`. HITL clients answer with `cancel`, not `deny`.
- Fail closed by default (`onGuardError: "deny"`).

```typescript
import { launchArcjet, tokenBucket } from "@arcjet/guard";
import { guardApproval } from "@arcjet/guard/vercel-eve/v0";
import { defineOpenAPIConnection } from "eve/connections";

const arcjet = launchArcjet({ key: process.env.ARCJET_KEY! });
const sessionLimit = tokenBucket({
  bucket: "weather-session",
  refillRate: 5,
  intervalSeconds: 60,
  maxTokens: 5,
});
const approverLimit = tokenBucket({
  bucket: "weather-approver",
  refillRate: 5,
  intervalSeconds: 60,
  maxTokens: 5,
});

export default defineOpenAPIConnection({
  description: "Weather API",
  spec: "https://api.example.com/openapi.json",
  approval: guardApproval(arcjet, {
    action: "weather.fetched",
    rules: (ctx) => [sessionLimit({ key: ctx.session.id, requested: 1 })],
    onAllow: "user-approval",
    response: {
      action: "weather.approved",
      rules: (ctx) => [approverLimit({ key: ctx.responder.principalId, requested: 1 })],
    },
  }),
  operations: {
    allow: ["GetForecast"],
  },
});
```
