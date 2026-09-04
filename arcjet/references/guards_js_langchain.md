# JavaScript Guard: LangChain JS createAgent

Load [guards_javascript.md](guards_javascript.md) for the client, rules, labels, decisions, capture, and the shared `ArcjetDenialResult` shape. This file is only the LangChain JS createAgent adapter. Do not also wrap with a sibling adapter.

Docs: https://docs.arcjet.com/guards/langchain/

Exports: `guardTool`, `guardMiddleware`, `langchainContext`. There is no unversioned `@arcjet/guard/langchain` alias. This is JS `createAgent` + `createMiddleware({ wrapToolCall })` from the `langchain` package. It is not LangGraph Graph API (`StateGraph` + `ToolNode` — `@arcjet/guard/langgraph/v1`, docs https://docs.arcjet.com/guards/langgraph/). It is not Python LangChain (`arcjet.guard.langchain`, docs https://docs.arcjet.com/guards/langchain/). Ships in `@arcjet/guard` 1.11.0. Optional peers `langchain` `>=1.2.0 <2` and `@langchain/core` `>=1 <2`. No `@langchain/langgraph` peer. Does not map typed `inputs` to a remote policy — use SDK `rules`.

Three gotchas first:

1. **Screen inbound before `agent.invoke`.** There is no `guardInbound`. Call `arcjet.guard()` in the application and **act on the decision**. Core `guard()` fails open: `ALLOW` is not proof the rules ran. Gate on `decision.hasFailedOpen()` if this call site must fail closed; `guardTool` / `guardMiddleware` already default to that. `wrapModelCall` / `beforeModel` / `afterModel` intercept the model call, not user text — they are not this policy gate.
2. **`humanInTheLoopMiddleware` is not a policy gate.** `humanInTheLoopMiddleware` / `interruptOn` / `interrupt()` is human-in-the-loop. Same trap as Mastra `requireApproval`, Claude `canUseTool`, LangGraph `interrupt()`, OpenAI Agents `needsApproval`, and Genkit `interrupt()`. There is no `guardApproval`.
3. **Deny inside `guardTool` and `guardMiddleware`'s `wrapToolCall`.** Policy sits on `wrapToolCall` only — do not deny in `afterModel`. `createAgent` runs authored tools through the tool object and everything else through middleware `createMiddleware({ wrapToolCall })`. MCP / runtime-discovered / unwrapped tools skip `guardTool`. `guardMiddleware` is the agent-wide gate for those. Do not also wrap with `@arcjet/guard/langgraph/v1` (`guardToolNode` is Graph API). Do not build on `createReactAgent`. Server-side provider tools and headless `.implement()` tools are out of scope.

- **`guardTool`** wraps a LangChain `tool()` / `StructuredTool` so `func` / `invoke` never runs on `DENY`. Denial is a plain `ArcjetDenialResult` — this helper does not throw and does not fabricate a `ToolMessage`. `createAgent`'s `baseHandler` wraps a non-ToolMessage in a success `ToolMessage`. Distinct from LangGraph Graph API, where `ToolNode` wraps the same plain object (`status: "success"`); do not fabricate `status: "error"` there, and do not use that adapter here.
- **`guardMiddleware`** is `createMiddleware({ wrapToolCall })` for `createAgent({ middleware })`. A `wrapToolCall` short-circuit returns a real `ToolMessage` (`content` = JSON of the payload, default status) without calling the inner handler. A bare object from `wrapToolCall` is the reducer-crash case. Do not throw (that drops the fields) and do not set `status: "error"`. Already-branded (`guardTool`) tools skip the middleware guard so Guard is not called twice.
- **`langchainContext`** preference: `configurable.thread_id` (what `wrapToolCall` sees on `runtime.configurable` as of langchain 1.2.34), then caller-owned `sessionId` / `conversationId`. It never mints an id. It never reads `traceId`. A resumed run keeps its `thread_id` because `humanInTheLoopMiddleware` resumes with `agent.invoke(new Command({ resume }), config)` — same config, same Sequence. The interrupt and its resume value are not correlation sources; do not derive an id from that payload. Do not call `createAgentContext` inside a `createAgent` callback.
- Fail closed by default (`onGuardError: "deny"`). Node.js 22+. Do not also wrap with `@arcjet/guard/vercel-ai/v7`. Use `guardTool` / `guardMiddleware` / `langchainContext` only — not `guardInbound`, `guardApproval`, `guardToolNode`, `guardHooks`, `createAgentContext`, or `aiToolsContext`. Docs: https://docs.arcjet.com/guards/langchain/.

```typescript
import { launchArcjet, detectPromptInjection, tokenBucket } from "@arcjet/guard";
import { guardTool, guardMiddleware, langchainContext } from "@arcjet/guard/langchain/v1";
import { createAgent } from "langchain";
import { tool } from "@langchain/core/tools";
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
  tool(async ({ orderId }) => ({ orderId, status: "shipped" }), {
    name: "lookup_order",
    description: "Look up an order by ID",
    schema: z.object({
      orderId: z.string(),
    }),
  }),
  {
    action: "order.looked-up",
    // Keyed on the authenticated caller, not the model-supplied order id.
    rules: () => [lookupLimit({ key: userId, requested: 1 })],
  },
);

const inbound = detectPromptInjection();
const decision = await arcjet.guard({
  label: "message.received",
  rules: [inbound(userText)],
  ...langchainContext({ configurable: { thread_id: conversationId } }),
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
const agent = createAgent({
  model: "openai:gpt-4o",
  tools: [lookupOrder, ...mcpTools],
  // The createAgent-wide gate for the tools above that guardTool did not wrap.
  // Already-branded tools are skipped, so Guard is not called twice.
  // wrapToolCall short-circuit returns a real ToolMessage — not a bare object.
  middleware: [
    guardMiddleware(arcjet, {
      action: ({ toolName }) => `${toolName}.invoked`,
      rules: ({ toolName }) => [mcpLimit({ key: toolName, requested: 1 })],
      sessionId: conversationId,
    }),
  ],
});

await agent.invoke(
  { messages: [{ role: "user", content: userText }] },
  { configurable: { thread_id: conversationId } },
);
```
