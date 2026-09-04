# JavaScript Guard: Genkit

Load [guards_javascript.md](guards_javascript.md) for the client, rules, labels, decisions, capture, and the shared `ArcjetDenialResult` shape. This file is only the Genkit adapter. Do not also wrap with a sibling adapter.

Docs: https://docs.arcjet.com/guards/genkit/

Exports: `guardTool`, `guardMiddleware`, `genkitContext`. There is no unversioned `@arcjet/guard/genkit` alias. This is JS `genkit()` + `ai.defineTool` + `ai.generate`. Not Go / Python Genkit. Ships in `@arcjet/guard` 1.11.0. Annotate `rules` — `TInput` defaults to `unknown`. The packaged skill is `node_modules/@arcjet/guard/skills/integrate-arcjet-guard-genkit`.

Three gotchas first:

1. **Screen inbound before `generate()` / `chat.send()`.** There is no `guardInbound`. The middleware `model` hook intercepts the model call, not user text — it is not this policy gate. Call `arcjet.guard()` in the application and **act on the decision**. Core `guard()` fails open: `ALLOW` is not proof the rules ran. Gate on `decision.hasFailedOpen()` if this call site must fail closed; `guardTool` / `guardMiddleware` already default to that.
2. **`interrupt()` is not a policy gate.** `interrupt()` / `defineInterrupt` / `@genkit-ai/middleware` `toolApproval` / `restartTool` / `finishReason === "interrupted"` is human-in-the-loop (`restartTool` / `respond`). Same trap as Mastra `requireApproval`, Claude `canUseTool`, LangGraph `interrupt()`, and OpenAI Agents `needsApproval`. There is no `guardApproval`.
3. **Deny inside `defineTool` and `guardMiddleware`'s `tool` hook.** After `defineTool` the object is a `ToolAction`; `generate()` calls it as a function. Filesystem middleware tools, MCP tools, and anything not wrapped with `guardTool` skip that handler. `guardMiddleware` is the generate()-wide gate for those. `returnToolRequests: true` means the app calls the tool itself — `guardTool` still gates that; `guardMiddleware` does not run if they never `generate()` the tool.

- **`guardTool`** wraps the `ToolAction` from `ai.defineTool` so the closed-over handler never runs on `DENY`. Return the shared `ArcjetDenialResult` as completed `toolResponse.output`. Do not throw. Do not call `interrupt()`. Do not throw `ToolInterruptError`. Wrap the returned `ToolAction` (the callable `generate()` invokes), not the inner handler — wrapping outside `action()` keeps a denial off `outputSchema` validation. `generate()` discards the action objects and re-resolves by name, so `guardTool` also replaces the registry entries. It throws if it cannot replace one (a frozen store would otherwise run the unguarded original with no signal).
- **`guardMiddleware`** is a `generate({ use })` middleware whose `tool` hook denies by returning a completed `ToolResponsePart` without calling `next()`. Already-branded (`guardTool`) actions skip the middleware guard when they can be looked up. Pass a **plain object `{ name, instantiate }`** — a raw function becomes a *model* hook only. Names get a random suffix so two instances do not collide (`normalizeMiddleware` keeps the first registration under a given name). Requires the `generateMiddleware` `tool` hook (Genkit >= 1.33).
- **`genkitContext`** preference: `context.correlationId` → `sessionId` → `conversationId` → a caller-owned `flowId` / `runId`, then envelope copies. It never mints an id. It never reads `traceId`. It never treats `interrupt` / `resumed` as correlation. Do not call `createAgentContext` inside a generate / tool callback. Do not read `Session.sessionId` from a Session constructed without an id (that class mints a UUID). Put the same id on `generate({ context })` *and* on `guardMiddleware({ sessionId })` — the tool hook from `toRunOptions` is only `{ metadata, resumed }` (no ALS context).
- Fail closed by default (`onGuardError: "deny"`). Optional peer `genkit` `>=1.0.0 <2`. Zod is theirs, not ours. Node.js 22+. Do not also wrap with `@arcjet/guard/vercel-ai/v7`. Use `guardTool` / `guardMiddleware` / `genkitContext` only — not `guardInbound`, `guardApproval`, `guardAction`, `createAgentContext`, or `aiToolsContext`.

```typescript
import { launchArcjet, detectPromptInjection, tokenBucket } from "@arcjet/guard";
import { guardTool, guardMiddleware, genkitContext } from "@arcjet/guard/genkit/v1";
import { genkit, z } from "genkit";

const ai = genkit({ /* plugins, default model */ });
const arcjet = launchArcjet({ key: process.env.ARCJET_KEY! });
const lookupLimit = tokenBucket({
  bucket: "lookups",
  refillRate: 10,
  intervalSeconds: 60,
  maxTokens: 10,
});
const mcpLimit = tokenBucket({
  bucket: "mcp-access",
  refillRate: 20,
  intervalSeconds: 60,
  maxTokens: 20,
});
// The authenticated caller, so a budget cannot be reset by varying the order id.
const userId = authenticatedUserId; // from your auth layer

const lookupOrder = guardTool(
  arcjet,
  ai.defineTool(
    {
      name: "lookup_order",
      description: "Look up an order by number",
      inputSchema: z.object({ orderNumber: z.string() }),
    },
    async ({ orderNumber }) => ({ orderNumber, status: "shipped" }),
  ),
  {
    action: "order.looked-up",
    // Keyed on the authenticated caller, not the model-supplied order id.
    rules: () => [lookupLimit({ key: userId, requested: 1 })],
  },
);

const appContext = { sessionId: conversationId };
const inbound = detectPromptInjection();
const decision = await arcjet.guard({
  label: "message.received",
  rules: [inbound(userText)],
  ...genkitContext({ context: appContext }),
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

const mcpTools = []; // from an MCP client you did not wrap with guardTool
await ai.generate({
  prompt: userText,
  tools: [lookupOrder, ...mcpTools],
  use: [
    guardMiddleware(arcjet, {
      action: ({ toolName }) => `${toolName}.invoked`,
      rules: ({ toolName }) => [mcpLimit({ key: toolName, requested: 1 })],
      sessionId: conversationId,
    }),
  ],
  context: appContext,
});
```
