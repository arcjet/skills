# JavaScript Guard: LangGraph

Load [guards_javascript.md](guards_javascript.md) for the client, rules, labels, decisions, capture, and the shared `ArcjetDenialResult` shape. This file is only the LangGraph adapter. Do not also wrap with a sibling adapter.

Docs: https://docs.arcjet.com/guards/langgraph/

Exports: `guardTool`, `guardToolNode`, `langgraphAgentContext`. There is no unversioned `@arcjet/guard/langgraph` alias. This is LangGraph Graph API (`StateGraph` + `ToolNode` from `@langchain/langgraph/prebuilt`). It is not LangChain `createAgent` / `wrapToolCall` — that is `@arcjet/guard/langchain/v1` (docs https://docs.arcjet.com/guards/langchain/). It is not Python LangChain (docs https://docs.arcjet.com/guards/langchain/). Do not build on `createReactAgent` (deprecated in LangGraph JS v1).

- **`guardTool`** wraps a LangChain `tool()` / `StructuredTool` so `func` / `invoke` never runs on `DENY`. Return the shared `ArcjetDenialResult` – do not throw (that drops the fields). `ToolNode` wraps that object into a real `ToolMessage` whose `status` is `success`. Do not fabricate a `ToolMessage` to force `status: "error"` (crashes the reducer).
- **`guardToolNode`** guards the tools a `ToolNode` executes (MCP / runtime-discovered / unwrapped tools). It guards in place and returns the same node. A frozen tools array throws. The tools-array form returns copies and leaves the input array alone. Already-guarded tools are skipped so Guard is not called twice.
- **`langgraphAgentContext`** reads `configurable.thread_id`, then the run id, then `configurable.checkpoint_ns`. It never mints an id. Do not call `createAgentContext` inside a LangGraph callback.
- There is no `guardInbound` (screen before `graph.invoke` or in the first node). There is no `guardApproval` / `guardInterrupt`: `interrupt()` / `interrupt_before=["tools"]` is human HITL, not a policy gate (same trap as Mastra `requireApproval` and Claude `canUseTool`).
- Fail closed by default (`onGuardError: "deny"`). Do not also wrap with `@arcjet/guard/vercel-ai/v7`.

```typescript
import { launchArcjet, tokenBucket } from "@arcjet/guard";
import { guardTool, guardToolNode } from "@arcjet/guard/langgraph/v1";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { tool } from "@langchain/core/tools";
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

const mcpLimit = tokenBucket({
  bucket: "mcp-access",
  refillRate: 20,
  intervalSeconds: 60,
  maxTokens: 20,
});

const lookupOrder = guardTool(
  arcjet,
  tool(async ({ orderId, note }) => ({ orderId, note, status: "shipped" }), {
    name: "lookup_order",
    description: "Look up an order by ID",
    schema: z.object({
      orderId: z.string(),
      note: z.string(),
    }),
  }),
  {
    action: "order.looked-up",
    // Keyed on the authenticated caller, not the model-supplied order id.
    rules: () => [lookupLimit({ key: userId, requested: 1 })],
  },
);

const mcpTools = []; // from an MCP client you did not wrap with guardTool
export const tools = guardToolNode(arcjet, new ToolNode([lookupOrder, ...mcpTools]), {
  action: ({ toolName }) => `${toolName}.invoked`,
  rules: ({ toolName }) => [mcpLimit({ key: toolName, requested: 1 })],
});
```
