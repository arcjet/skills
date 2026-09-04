# JavaScript Guard: Strands Agents

Load [guards_javascript.md](guards_javascript.md) for the client, rules, labels, decisions, capture, and the shared `ArcjetDenialResult` shape. This file is only the Strands Agents adapter. Do not also wrap with a sibling adapter.

Docs: https://docs.arcjet.com/guards/strands-agents/

Exports: `guardTool`, `guardHooks`, `strandsAgentContext`. There is no unversioned `@arcjet/guard/strands-agents` alias. This is official `@strands-agents/sdk` `Agent` + `invoke()` / `stream()` + authored `tool({ callback })` + Plugin / `addHook`. It is not Python `strands`. Ships in `@arcjet/guard` 1.11.0. Optional peer `@strands-agents/sdk` `>=1.1.0 <2`. Annotate `rules` — `TInput` defaults to `unknown`. The existing `strands-agent` example stays with Runtime. The packaged skill is `node_modules/@arcjet/guard/skills/integrate-arcjet-guard-strands-agents`.

Three gotchas first:

1. **Screen inbound before `invoke()` / `stream()`.** There is no `guardInbound`. Middleware / model hooks are not this policy gate. Call `arcjet.guard()` in the application and **act on the decision**. Core `guard()` fails open: `ALLOW` is not proof the rules ran. Gate on `decision.hasFailedOpen()` if this call site must fail closed; `guardTool` / `guardHooks` already default to that.
2. **`event.interrupt()` is not a policy gate.** `BeforeToolCallEvent.interrupt()` / `InterruptError` / resume is human-in-the-loop. Same trap as Mastra `requireApproval`, Claude `canUseTool`, LangGraph `interrupt()`, OpenAI Agents `needsApproval`, Genkit `interrupt()`, and LangChain `humanInTheLoopMiddleware`. There is no `guardApproval` / `guardInterrupt`.
3. **Deny inside `guardTool` and `guardHooks`' `BeforeToolCallEvent.cancel`.** Authored `tool({ callback })` is a `FunctionTool` / `ZodTool` whose runner path is `_callback`. MCP / vended / unwrapped tools skip `guardTool`. `guardHooks` is the Plugin / invoke-wide gate for those: set `event.cancel` to the JSON string of `ArcjetDenialResult` (`HookOrder.SDK_FIRST - 1`). Do not call `event.interrupt()` to deny. Do not set `cancel: true` (that drops the fields). Do not use `BeforeToolsEvent.cancel` (that skips per-tool hooks). Do not also wrap with `@arcjet/guard/vercel-ai/v7` or `@arcjet/guard/langgraph/v1`.

- **`guardTool`** wraps an authored `tool({ callback })` so the closed-over `_callback` (and ZodTool's `_functionTool._callback`) never runs on `DENY`. Denial is a plain `ArcjetDenialResult` — this helper does not throw and does not fabricate a `ToolResultBlock`. `FunctionTool` wraps the object in a `JsonBlock`. Prefer omitting `outputSchema` on guarded tools, or verify it accepts the denial shape. Register only the value this helper returns on `Agent({ tools })` — passing the original `tool()` alongside the wrap leaves the original `stream()` path unguarded.
- **`guardHooks`** is a Plugin for `new Agent({ plugins })`. `initAgent` registers `BeforeToolCallEvent` (deny) and `AfterToolCallEvent` (capture only). A `BeforeToolCallEvent` deny sets `event.cancel` to `JSON.stringify` of `ArcjetDenialResult` so `tool.stream()` does not run; `AfterToolCallEvent` still fires. Already-branded (`guardTool`) tools skip the hook guard so Guard is not called twice. `cancel: true` uses a default message and loses the payload.
- **`strandsAgentContext`** preference: caller-owned `invocationState.correlationId` → `sessionId` → `requestId`, then envelope copies, then `init.sessionId` / `init.correlationId`. It never mints an id. It never reads `traceId`. It never reads `agent.id`. It never calls `SessionManager`. Do not call `createAgentContext` inside an invoke / hook / tool callback. Put the same id on `invoke(..., { invocationState })` *and* on `guardHooks({ sessionId })`.
- Fail closed by default (`onGuardError: "deny"`). Optional peer `@strands-agents/sdk` `>=1.1.0 <2`. Zod is theirs, not ours. Node.js 22+. Do not also wrap with `@arcjet/guard/vercel-ai/v7`. Use `guardTool` / `guardHooks` / `strandsAgentContext` only — not `guardInbound`, `guardApproval`, `guardMiddleware`, `guardToolNode`, `createAgentContext`, or `aiToolsContext`. Docs: https://docs.arcjet.com/guards/strands-agents/.

```typescript
import { launchArcjet, detectPromptInjection, tokenBucket } from "@arcjet/guard";
import { guardTool, guardHooks, strandsAgentContext } from "@arcjet/guard/strands-agents/v1";
import { Agent, tool } from "@strands-agents/sdk";
import { z } from "zod";

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
const userId = authenticatedUserId;

const lookupOrder = guardTool(
  arcjet,
  tool({
    name: "lookup_order",
    description: "Look up an order by ID",
    inputSchema: z.object({
      orderId: z.string(),
    }),
    callback: async ({ orderId }) => ({ orderId, status: "shipped" }),
  }),
  {
    action: "order.looked-up",
    // Keyed on the authenticated caller, not the model-supplied order id.
    rules: () => [lookupLimit({ key: userId, requested: 1 })],
  },
);

const invocationState = { sessionId: conversationId };
const inbound = detectPromptInjection();
const decision = await arcjet.guard({
  label: "message.received",
  rules: [inbound(userText)],
  ...strandsAgentContext({ invocationState }),
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
const agent = new Agent({
  tools: [lookupOrder, ...mcpTools],
  // The agent-wide gate for the tools above that guardTool did not wrap.
  // Already-branded tools are skipped, so Guard is not called twice.
  // BeforeToolCallEvent.cancel is the JSON string of ArcjetDenialResult.
  plugins: [
    guardHooks(arcjet, {
      action: ({ toolName }) => `${toolName}.invoked`,
      rules: ({ toolName }) => [mcpLimit({ key: toolName, requested: 1 })],
      sessionId: conversationId,
    }),
  ],
});

await agent.invoke(userText, { invocationState });
```
