---
name: integrate-arcjet-guard-cloudflare-think
description: Integrate Arcjet Guard into Cloudflare Think — install beforeToolCall so a DENY block/substitutes the tool, and read a caller-owned id via cloudflareThinkContext. Use when asked to add Arcjet to @cloudflare/think, Cloudflare Agents Think, rate limit those tools, screen inbound messages, or block prompt injection / PII. This is Cloudflare Think, not the Vercel AI SDK and not needsApproval HITL.
license: Apache-2.0
compatibility: Requires official @cloudflare/think >= 0.3.0 on Node.js >= 22 (Workers-compatible). Gate is Think beforeToolCall block/substitute. Path is /v0. Do not use @arcjet/guard/vercel-ai/v7. Until-published — pin @arcjet/guard to git SHA ADAPTER_SHA; not in npm 1.11.0.
metadata:
  author: arcjet
  type: core
  library: "@arcjet/guard"
---

# Integrate Arcjet Guard into Cloudflare Think

`@arcjet/guard/cloudflare-think/v0` wraps the agent's existing Arcjet
client. It never talks to the Arcjet API itself. Shared Guard
fundamentals (client, rules, labels, decisions, capture, registration)
live in
[../arcjet/references/guards_javascript.md](../arcjet/references/guards_javascript.md).
Load that reference for anything that is not Think-specific.

Official `@cloudflare/think` `>=0.3.0` only — a `Think` subclass
with server-side `execute` tools. This is **not** the Vercel AI SDK
(`ai` / `@arcjet/guard/vercel-ai/v7`). Think owns `streamText`
internally; do not also wrap its tools with the AI SDK mix-in.
Not TanStack Start HTTP `protect()`. Not Cloudflare Workers HTTP
`protect()` (`@arcjet/node` / request-based).

Exports: `guardThink`, `cloudflareThinkContext`. There is **no
`guardTool`**. Skip is the `beforeToolCall` return, not
throw-from-execute. There is no `guardInbound` and no
`guardApproval`. No unversioned `@arcjet/guard/cloudflare-think`
alias.

Two surfaces, one decision rule:

- **Tool calls** → `guardThink`. Installs Think's `beforeToolCall`
  so a DENY never reaches `execute`. Delivery is a Think
  `ToolCallDecision`: **substitute** (`{ action: "substitute",
  output: ArcjetDenialResult }`) so the model sees the payload, or
  **block** (`{ action: "block", reason }`) so the model sees a
  reason string. `void` / `{ action: "allow" }` executes. Do not
  throw — a throw is a raw exception / `onChatError`, not a denial.
- **Correlation** → `cloudflareThinkContext` reads a caller-owned
  id. It never mints. It never reads Durable Object ids, `requestId`,
  or `traceId`.

There is no `/guards/cloudflare-think/` docs page yet. Do not
invent a second slug and do not overwrite any other `/guards/...`
page.

## The gate is `beforeToolCall` block / substitute

Think wraps every server-side tool's `execute` and consults
`beforeToolCall` first (subclass hook, then extensions). Returning
`block` or `substitute` skips `execute`. Fail closed: always return
one of those on error — do not return `void` (that executes the
tool) and do not throw. Default DENY is **substitute** with
`ArcjetDenialResult` so the model sees `{ arcjetDenied: true, … }`.
`onDeny: "block"` uses `{ action: "block", reason }` instead and
drops the structured fields. `onDeny: "block"` applies to real
DENY; unavailable still fail-closes with a decision (never void).
Core `guard()` still fails open (`hasFailedOpen()`).

Client tools (no server `execute`) never enter this hook. Workspace
tools that Think auto-merges do, if they have `execute`.

## `needsApproval` is not a policy gate

AI SDK `needsApproval` / confirmation-style tools / human resume
are human-in-the-loop. After a human yes, Guard still runs on the
tool call. Same trap as TanStack `needsApproval`, Mastra
`requireApproval`, Claude `canUseTool`, LangGraph `interrupt()`,
OpenAI Agents `needsApproval`, Genkit `interrupt()`, and Google ADK
`requireConfirmation`. There is no `guardApproval`.

## Screen inbound before `chat()` / `submitMessages()`

There is no `guardInbound`. `beforeTurn` / `beforeStep` tune the
model call; they are not this policy gate. Call `arcjet.guard()` in
the application (or at the start of `beforeTurn` **and act on the
decision**) before the turn starts. Core `guard()` fails open:
`ALLOW` is not proof the rules ran. Gate on
`decision.hasFailedOpen()` if this call site must fail closed;
`guardThink` already defaults to that.

## Questions to ask the human first

Ask only what you cannot infer from the code; suggest defaults.

1. Which tools are **risky** (external side effects, irreversible,
   spends money, sends messages)? Those are gated by
   `beforeToolCall`. Client tools with no `execute` are out of
   scope.
2. What **limits**? (e.g. "10 lookups/min per user" →
   `tokenBucket`.)
3. Who is the **user** for metadata — an opaque user/tenant ID
   (never PII)? Default: none. Put the conversation / session id
   you already have on `guardThink({ sessionId })`. That id is the
   correlation id, not the user. Do not use the Durable Object id
   or `requestId`.
4. Is an Arcjet outage unacceptable? Every helper defaults to
   `onGuardError: "deny"`. Ask explicitly about inbound screening
   before the turn: failing closed there means the agent does not
   answer, so `"allow"` is a routine and legitimate choice at that
   one call site.

## The things readers get wrong

1. **This is not the Vercel AI SDK.** Do not import
   `@arcjet/guard/vercel-ai/v7` and do not wrap Think tools with
   `guardTool` from that namespace. Think already owns
   `streamText`.
2. **There is no `guardInbound`.** Screen with core `guard()`
   before `chat()` / `submitMessages()`.
3. **`needsApproval` is HITL, not policy.**
4. **Fail closed = always return `block` or `substitute` on
   error.** `void` executes the tool. A throw is not a denial.
5. **Default DENY is substitute** (structured `ArcjetDenialResult`).
   `block` is the reason-string path and drops the fields.
6. **Correlation is read, never minted.** Never Durable Object id,
   never `requestId`, never `traceId`.
7. **The import path is versioned.**
   `@arcjet/guard/cloudflare-think/v0` resolves;
   `@arcjet/guard/cloudflare-think` does not.
8. **Key rate limits on the authenticated caller**, not a
   model-supplied order id.
9. **Do not hand-wrap every Think tool with raw `guard()`.**

## Step 1: Install and find the guard client

Until-published: npm `@arcjet/guard@1.11.0` does not export
`./cloudflare-think/v0` (`ERR_PACKAGE_PATH_NOT_EXPORTED`). Pin
`@arcjet/guard` to git SHA `ADAPTER_SHA`:

```bash
npm install github:arcjet/arcjet-js#ADAPTER_SHA
npm install @cloudflare/think
```

If the agent has no guard client yet, launch one **once at module
scope**:

```ts
import { launchArcjet } from "@arcjet/guard";

export const arcjet = launchArcjet({ key: process.env.ARCJET_KEY! });
```

## Step 2: Gate tool calls — `beforeToolCall`

```ts
import { Think } from "@cloudflare/think";
import { launchArcjet, tokenBucket } from "@arcjet/guard";
import { guardThink } from "@arcjet/guard/cloudflare-think/v0";

const arcjet = launchArcjet({ key: process.env.ARCJET_KEY! });
const lookupLimit = tokenBucket({
  bucket: "lookups",
  refillRate: 10,
  intervalSeconds: 60,
  maxTokens: 10,
});
const userId = authenticatedUserId;

export class SupportAgent extends guardThink(Think, arcjet, {
  action: ({ toolName }) => `${toolName}.invoked`,
  // Keyed on the authenticated caller, not the model-supplied order id.
  rules: () => [lookupLimit({ key: userId, requested: 1 })],
  sessionId: conversationId,
  onGuardError: "deny",
  // default DENY is substitute (ArcjetDenialResult). onDeny: "block"
  // uses { action: "block", reason } and drops the fields.
}) {
  getModel() {
    return "@cf/moonshotai/kimi-k2.7-code";
  }

  getSystemPrompt() {
    return "Help the user.";
  }

  // needsApproval on a tool is HITL — not this policy gate
}
```

If the subclass already implements `beforeToolCall`, call the
helper from that method and return its `ToolCallDecision`. Do not
void past a DENY and do not also wrap with
`@arcjet/guard/vercel-ai/v7`.

## Step 3: Screen inbound before the turn

```ts
import { detectPromptInjection } from "@arcjet/guard";
import { cloudflareThinkContext } from "@arcjet/guard/cloudflare-think/v0";

const inbound = detectPromptInjection();
const decision = await arcjet.guard({
  label: "message.received",
  rules: [inbound(userText)],
  ...cloudflareThinkContext({ context: { sessionId: conversationId } }),
});
if (decision.conclusion === "DENY") {
  throw new Error("message blocked");
}
if (decision.hasFailedOpen()) {
  throw new Error("inbound guard unavailable");
}

// Then chat() / submitMessages() / the WebSocket turn.
```

There is no `guardInbound`. `guard()` fails open — always check
`hasFailedOpen()`.

## Step 4: Correlation

`cloudflareThinkContext` reads a caller-owned id. Preference:
`correlationId`, then `sessionId`, then `conversationId` on a
caller-owned wrap, then `guardThink({ sessionId })`. It never
mints. It never reads the Durable Object id / `this.ctx.id` /
`this.name`. It never reads `requestId`, `traceId`, or stream ids
Think or the AI SDK mint. Do not invent a correlation id per turn.
If nothing valid remains, the call is uncorrelated rather than
joined to a generated id.

## Verify the integration

1. `npm run typecheck` (or the project's type-check) passes.
2. Exercise inbound PI (before the turn, including
   `hasFailedOpen()`), a substitute-deny (model sees
   `ArcjetDenialResult`), a block-deny (reason string), void
   execute, no-throw, never-mint, and fail-closed (an unreachable
   guard → block or substitute, never void). Confirm
   `needsApproval` is never treated as the gate and that tools are
   not also wrapped with `@arcjet/guard/vercel-ai/v7`.
3. Confirm in the Arcjet Console / CLI that decisions share the
   caller-owned session / conversation id — not a Durable Object id
   or `requestId`.
4. Manual E2E with a real `ARCJET_KEY` is still-to-verify until you
   run it.

Do not invent a Cloudflare Think example name. Do not add an
example in this skills repo. Do not cite an example app until one
exists.
