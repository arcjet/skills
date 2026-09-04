# JavaScript Guard: TanStack AI

Load [guards_javascript.md](guards_javascript.md) for the client, rules, labels, decisions, capture, and the shared `ArcjetDenialResult` shape. This file is only the TanStack AI adapter. Do not also wrap with a sibling adapter.

Docs: https://docs.arcjet.com/guards/tanstack-ai/

Exports: `guardMiddleware`, `tanstackAiContext`. There is no `guardTool`. There is no unversioned `@arcjet/guard/tanstack-ai` alias. This is official `@tanstack/ai` `chat({ middleware })` + authored `tool({ execute })`. It is not Vercel AI SDK (`ai` / `@arcjet/guard/vercel-ai/v7`, docs https://docs.arcjet.com/guards/vercel-ai/). It is not TanStack Start HTTP `protect()`. It is not TanStack's own `contentGuardMiddleware` (`@tanstack/ai/middlewares` stream redaction). Until-published: published `@arcjet/guard@1.11.0` does not export `./tanstack-ai/v0` (`ERR_PACKAGE_PATH_NOT_EXPORTED`). Pin `@arcjet/guard` to git SHA `d730d57a124f03843f085d41f64b0355a09d1eab` ([#6260](https://github.com/arcjet/arcjet-js/pull/6260)). Optional peer `@tanstack/ai` `>=0.8.0 <1`. The existing `tanstack-agent` example stays with Runtime. Once it ships, the packaged skill is `node_modules/@arcjet/guard/skills/integrate-arcjet-guard-tanstack-ai`.

Three gotchas first:

1. **Screen inbound before `chat()`.** There is no `guardInbound`. Middleware `onConfig` / `onChunk` and TanStack's own `contentGuardMiddleware` intercept config or streamed text, not user text as a policy gate. Call `arcjet.guard()` in the application and **act on the decision**. Core `guard()` fails open: `ALLOW` is not proof the rules ran. Gate on `decision.hasFailedOpen()` if this call site must fail closed; `guardMiddleware` already defaults to that.
2. **`needsApproval` / `defineInterrupt` / `onInterruptBoundary` is not a policy gate.** `needsApproval` / `defineInterrupt` / `onInterruptBoundary` / `onInterruptResolution` is human-in-the-loop. After a human yes, Guard still runs on the tool call. Same trap as Mastra `requireApproval`, Claude `canUseTool`, LangGraph `interrupt()`, OpenAI Agents `needsApproval`, Genkit `interrupt()`, and LangChain `humanInTheLoopMiddleware`. There is no `guardApproval` / `guardInterrupt`.
3. **Deny inside `guardMiddleware`'s `onBeforeToolCall`.** Policy sits on `chat({ middleware })` only — do not wrap `tool({ execute })` with `guardTool` and do not throw from `execute` (TanStack swallows an `execute` throw into `{ error }` and drops the fields). Default DENY is `{ type: "skip", result: ArcjetDenialResult }` so the tool never runs and the model sees the payload. Optional `onDeny: "abort"` returns `{ type: "abort", reason }` and stops the chat run — the model does not get `ArcjetDenialResult`. `onDeny: "abort"` applies to real DENY only; unavailable stays skip. Put Arcjet first in the `middleware` array (`onBeforeToolCall` is first-win; if `toolCacheMiddleware` skips first, Guard never runs). Inbound `guard()` before `chat()` does not brand tools and does not skip this gate (brand-skip is only a sibling `guardTool` stamp; this namespace has no `guardTool`). Do not also wrap with `@arcjet/guard/vercel-ai/v7`.

- **`guardMiddleware`** is `ChatMiddleware` for `chat({ middleware })`. Default DENY is an `onBeforeToolCall` skip with the shared `ArcjetDenialResult` without calling `execute`. Optional `onDeny: "abort"` stops the run on real DENY only (unavailable stays skip). Do not throw. Do not emit an interrupt to deny.
- **`tanstackAiContext`** preference: caller-owned `context.correlationId` → `sessionId` → `conversationId`, then `init.sessionId` / `init.correlationId`. It never mints an id. It never reads `threadId`, `requestId`, `streamId`, or `traceId` (TanStack mints those). It never reads `runId`. A bare object that also has string `requestId` and `streamId` looks like TanStack's middleware envelope, so top-level `sessionId` on that object is ignored — pass `{ context: appContext }`. Do not call `createAgentContext` inside a `chat()` / middleware / tool callback. Put the same caller-owned id on `chat({ context })` *and* on `guardMiddleware({ sessionId })`.
- Fail closed by default (`onGuardError: "deny"`). Optional peer `@tanstack/ai` `>=0.8.0 <1`. Zod is theirs, not ours. Node.js 22+. Do not also wrap with `@arcjet/guard/vercel-ai/v7`. Use `guardMiddleware` / `tanstackAiContext` only — not `guardTool`, `guardInbound`, `guardApproval`, `guardToolNode`, `guardHooks`, `createAgentContext`, or `aiToolsContext`. Docs: https://docs.arcjet.com/guards/tanstack-ai/.

```typescript
import { launchArcjet, detectPromptInjection, tokenBucket } from "@arcjet/guard";
import { guardMiddleware, tanstackAiContext } from "@arcjet/guard/tanstack-ai/v0";
import { chat, tool } from "@tanstack/ai";
import { z } from "zod";

const arcjet = launchArcjet({ key: process.env.ARCJET_KEY! });
const lookupLimit = tokenBucket({
  bucket: "lookups",
  refillRate: 10,
  intervalSeconds: 60,
  maxTokens: 10,
});
// The authenticated caller, so a budget cannot be reset by varying the order id.
const userId = authenticatedUserId;

const lookupOrder = tool({
  name: "lookup_order",
  description: "Look up an order by ID",
  inputSchema: z.object({
    orderId: z.string(),
  }),
  execute: async ({ orderId }) => ({ orderId, status: "shipped" }),
});

const appContext = { sessionId: conversationId };
const inbound = detectPromptInjection();
const decision = await arcjet.guard({
  label: "message.received",
  rules: [inbound(userText)],
  ...tanstackAiContext({ context: appContext }),
});
if (decision.conclusion === "DENY") {
  throw new Error("message blocked");
}
// `guard()` fails open, so an ALLOW is not proof the rules ran. Gate
// on `hasFailedOpen()` when this inbound site must fail closed. Omitting
// that gate is legitimate if an outage must not stop the agent.
if (decision.hasFailedOpen()) {
  throw new Error("inbound guard unavailable");
}

const stream = chat({
  adapter,
  messages: [{ role: "user", content: userText }],
  tools: [lookupOrder],
  context: appContext,
  // Put Arcjet first: onBeforeToolCall is first-win.
  // Default DENY is skip with ArcjetDenialResult.
  // Optional onDeny: "abort" is real DENY only; unavailable stays skip.
  // Do not wrap execute — TanStack swallows an execute throw.
  middleware: [
    guardMiddleware(arcjet, {
      action: ({ toolName }) => `${toolName}.invoked`,
      // Keyed on the authenticated caller, not the model-supplied order id.
      rules: () => [lookupLimit({ key: userId, requested: 1 })],
      sessionId: conversationId,
    }),
  ],
});
void stream;
```
