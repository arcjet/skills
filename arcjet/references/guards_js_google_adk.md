# JavaScript Guard: Google ADK

Load [guards_javascript.md](guards_javascript.md) for the client, rules, labels, decisions, capture, and the shared `ArcjetDenialResult` shape. This file is only the Google ADK adapter. Do not also wrap with a sibling adapter.

Docs: https://docs.arcjet.com/guards/google-adk/

Exports: `guardPlugin`, `googleAdkContext`. There is no `guardTool`. There is no unversioned `@arcjet/guard/google-adk` alias. This is JS `@google/adk` `>=2 <3` `Runner` + `LlmAgent` + `FunctionTool`. Not Python / Go / Java ADK. Until-published: published `@arcjet/guard@1.11.0` does not export `./google-adk/v2` (`ERR_PACKAGE_PATH_NOT_EXPORTED`). Pin `@arcjet/guard` to git SHA `41ef36816e7174f1b0288d28217e63fa14114307`. Optional peer `@google/adk` `>=2 <3`. Example: [`examples/google-adk-agent`](https://github.com/arcjet/examples/tree/main/examples/google-adk-agent) (pins `41ef3681`; no verify fixture).

Three gotchas first:

1. **Screen inbound before `runner.runAsync`.** There is no `guardInbound`. Agent / model callbacks are not this policy gate. Call `arcjet.guard()` in the application and **act on the decision**. Core `guard()` fails open: `ALLOW` is not proof the rules ran. Gate on `decision.hasFailedOpen()` if this call site must fail closed; `guardPlugin` already defaults to that.
2. **HITL is not a policy gate.** `requireConfirmation` / `requestConfirmation` / `adk_request_confirmation` / confirmation resume is human-in-the-loop. Same trap as Mastra `requireApproval`, Claude `canUseTool`, LangGraph `interrupt()`, OpenAI Agents `needsApproval`, Genkit `interrupt()`, and LangChain `humanInTheLoopMiddleware`. There is no `guardApproval`.
3. **Deny inside `guardPlugin`'s `beforeToolCallback`.** There is no `guardTool`. The Runner plugin is the only gate: a returned deny dict skips `FunctionTool.runAsync`; `undefined` executes. Fail closed = always return a deny dict on error (do not return `undefined` and do not throw). Put the Arcjet plugin **first** on `Runner({ plugins })` so a deny short-circuits before later plugins run. Do not also wrap with `@arcjet/guard/vercel-ai/v7`.

- **`guardPlugin`** returns a `BasePlugin` for `new Runner({ plugins })`. `beforeToolCallback` evaluates Guard and, on `DENY` or unevaluated Guard under the default `onGuardError: "deny"`, returns `{ arcjetDenied: true, … }` so `runAsync` never runs. Fail closed: always return that deny dict on error — never `undefined` (that executes the tool) and never throw (PluginManager treats a throw as a plugin error, not skip). On ALLOW it returns `undefined`. Do not invent a `guardTool` wrap around `FunctionTool`.
- **`googleAdkContext`** preference: caller-owned `correlationId` → `sessionId` → `conversationId`, then envelope copies. It never mints an id. It never reads `traceId`. It never reads `invocationId` (ADK always generates it). It never reads `toolContext.sessionId` / `session.id` (session auto-ids). Do not call `createAgentContext` inside a plugin / tool callback. Put the same id on `runner.runAsync({ sessionId })` *and* on `guardPlugin({ sessionId })`.
- Fail closed by default (`onGuardError: "deny"`). Optional peer `@google/adk` `>=2 <3`. Node.js 22+. Use `guardPlugin` / `googleAdkContext` only — not `guardTool`, `guardInbound`, `guardApproval`, `guardMiddleware`, `guardHooks`, `createAgentContext`, or `aiToolsContext`. Docs: https://docs.arcjet.com/guards/google-adk/.

```typescript
import { launchArcjet, detectPromptInjection, tokenBucket } from "@arcjet/guard";
import { guardPlugin, googleAdkContext } from "@arcjet/guard/google-adk/v2";
import { FunctionTool, InMemorySessionService, LlmAgent, Runner } from "@google/adk";

const arcjet = launchArcjet({ key: process.env.ARCJET_KEY! });
const lookupLimit = tokenBucket({
  bucket: "lookups",
  refillRate: 10,
  intervalSeconds: 60,
  maxTokens: 10,
});
// The authenticated caller, so a budget cannot be reset by varying the order id.
const userId = authenticatedUserId;

const lookupOrder = new FunctionTool({
  name: "lookup_order",
  description: "Look up an order by ID",
  // requireConfirmation is HITL — not this policy gate
  execute: async (input) => ({ input, status: "shipped" }),
});

const agent = new LlmAgent({
  name: "support_agent",
  description: "Help the user.",
  instruction: "Help the user.",
  tools: [lookupOrder],
});

const sessionService = new InMemorySessionService();
const runner = new Runner({
  appName: "support",
  agent,
  sessionService,
  // Arcjet first: a deny dict skips runAsync before later plugins run.
  plugins: [
    guardPlugin(arcjet, {
      action: ({ toolName }) => `${toolName}.invoked`,
      // Keyed on the authenticated caller, not the model-supplied order id.
      rules: () => [lookupLimit({ key: userId, requested: 1 })],
      sessionId: conversationId,
    }),
  ],
});

const appContext = { sessionId: conversationId };
const inbound = detectPromptInjection();
const decision = await arcjet.guard({
  label: "message.received",
  rules: [inbound(userText)],
  ...googleAdkContext({ context: appContext }),
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

for await (const event of runner.runAsync({
  userId,
  sessionId: conversationId,
  newMessage: { parts: [{ text: userText }] },
})) {
  void event;
}
```
