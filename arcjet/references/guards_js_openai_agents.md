# JavaScript Guard: OpenAI Agents

Load [guards_javascript.md](guards_javascript.md) for the client, rules, labels, decisions, capture, and the shared `ArcjetDenialResult` shape. This file is only the OpenAI Agents adapter. Do not also wrap with a sibling adapter.

Docs: https://docs.arcjet.com/guards/openai-agents/

Exports: `guardTool`, `openaiAgentsContext`. There is no unversioned `@arcjet/guard/openai-agents` alias. This is text `Agent` + `run()` / `Runner` + authored `tool({ execute })`. Not Realtime, not Sandbox, not hosted tools, not computer / shell / apply_patch, not MCP, not `agent.asTool()`. Ships in `@arcjet/guard` 1.11.0.

Three gotchas first:

1. **Screen inbound before `run()`.** There is no `guardInbound`. SDK `inputGuardrails` / `outputGuardrails` / `defineToolInputGuardrail` / `defineToolOutputGuardrail` are the SDK's own tripwires, not Arcjet. Call `arcjet.guard()` in the application and **act on the decision**. Core `guard()` fails open: `ALLOW` is not proof the rules ran. Gate on `decision.hasFailedOpen()` if this call site must fail closed; `guardTool` already defaults to that.
2. **`needsApproval` is not a policy gate.** `needsApproval` / `requireApproval` / `onApproval` is human-in-the-loop (`result.state.approve` / `reject`). Same trap as Mastra `requireApproval`, Claude `canUseTool`, and LangGraph `interrupt()`. There is no `guardApproval`.
3. **Deny is inside `tool({ execute })`.** After `tool()` the object is a `FunctionTool`; the runner calls `invoke`. Hosted tools, handoffs, computer / shell / apply_patch, and MCP (`mcpServers` → `mcpToFunctionTool`) skip that authored-`execute` path. `agent_tool_start` / `agent_tool_end` are void observe-only hooks. There is no `guardHooks` and no `guardToolNode`.

- **`guardTool`** wraps `FunctionTool.invoke` so the closed-over `execute` never runs on `DENY`. Return the shared `ArcjetDenialResult` (`{ arcjetDenied: true, … }`) on a `function_call_result` with `status: "completed"`. A throw hits `errorFunction` or `ToolCallError` and drops the fields. `timeoutMs` races the guard round trip as well as `execute`, so leave headroom; `outputGuardrails` / `customDataExtractor` receive the denial object and must not assume the tool's own shape. `guardTool` warns if `invoke` is handed neither a string nor an object (rules would silently see `{}`).
- **`openaiAgentsContext`** preference: `context.correlationId` → `sessionId` → `conversationId` → `groupId`, then envelope copies (`conversationId`, `groupId`, already-resolved `sessionId`). It never mints an id. It never reads `traceId` (the SDK mints one when omitted). It never calls `session.getSessionId()` (`MemorySession` mints a UUID when constructed without `sessionId`). Do not call `createAgentContext` inside a run callback.
- Fail closed by default (`onGuardError: "deny"`). Optional peer `@openai/agents` `>=0.17.0 <1`. Zod is their peer, not ours. Node.js 22+. Do not also wrap with `@arcjet/guard/vercel-ai/v7`.

```typescript
import { launchArcjet, detectPromptInjection, tokenBucket } from "@arcjet/guard";
import { guardTool, openaiAgentsContext } from "@arcjet/guard/openai-agents/v0";
import { Agent, run, tool } from "@openai/agents";
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

const lookupOrder = guardTool(
  arcjet,
  tool({
    name: "lookup_order",
    description: "Look up an order by number",
    parameters: z.object({ orderNumber: z.string() }),
    execute: async ({ orderNumber }) => ({ orderNumber, status: "shipped" }),
  }),
  {
    action: "order.looked-up",
    rules: () => [lookupLimit({ key: userId, requested: 1 })],
  },
);

const agent = new Agent({
  name: "support-agent",
  instructions: "Help the user.",
  tools: [lookupOrder],
});

const appContext = { sessionId: conversationId };
const inbound = detectPromptInjection();
const decision = await arcjet.guard({
  label: "message.received",
  rules: [inbound(userText)],
  ...openaiAgentsContext({ context: appContext, conversationId }),
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

await run(agent, userText, { context: appContext });
```
