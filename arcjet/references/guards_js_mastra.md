# JavaScript Guard: Mastra

Load [guards_javascript.md](guards_javascript.md) for the client, rules, labels, decisions, capture, and the shared `ArcjetDenialResult` shape. This file is only the Mastra adapter. Do not also wrap with a sibling adapter.

Docs: https://docs.arcjet.com/guards/mastra/

Exports: `guardTool`, `guardProcessor`, `guardHooks`, `mastraAgentContext` (all in `@arcjet/guard` 1.11.0). There is no unversioned `@arcjet/guard/mastra` alias. This is `@mastra/core` >= 1 `<2` `createTool({ execute })` + `Agent`. There is no `guardInbound` and no `guardApproval`.

Three gotchas first:

1. **Screen inbound with `guardProcessor` on `inputProcessors`.** Channels already hit `processInput`, so there is no `guardInbound`. `processInput` + `abort()` on DENY raises a Mastra tripwire. `processInputStep` screens later agentic steps (tool continuations). The same processor implements `processOutputResult` for `outputProcessors` — use a separate `action` name for outbound.
2. **`requireApproval` is not a policy gate.** Mastra `requireApproval` is human HITL. Same trap as Claude `canUseTool` and LangGraph `interrupt()`. There is no `guardApproval`.
3. **Do not also wrap with `@arcjet/guard/vercel-ai/v7`.** Mastra tools are `createTool`, not AI SDK `tool()`. `guardTool` throws if the tool already carries the Arcjet protection brand. `guardHooks` is for MCP / workspace / toolsets you did **not** wrap — applying both to the same authored tool double-calls Guard.

- **`guardTool`** wraps `createTool({ execute })` so `execute` never runs on `DENY`. Return `{ arcjetDenied: true, … }` as the tool result. Do not throw. Prefer omitting `outputSchema` on guarded tools, or verify it accepts `ArcjetDenialResult`. If `onDeny` throws, the tool still does not run and the model still receives the default denial object.
- **`guardProcessor`** for inbound / outbound text. On DENY, `processInput` / `processInputStep` call `abort()`; if `abort()` were to return, the processor still throws so the turn cannot fail open. Inbound `"allow"` is a legitimate `onGuardError` choice because failing closed stops the agent answering.
- **`guardHooks`** — `beforeToolCall` returns `{ proceed: false, output }` on DENY so unwrapped MCP / workspace tools never execute. `afterToolCall` is observe-only. Pass `hooks` to the `Agent` constructor (or to `generate` / `stream`).
- **`mastraAgentContext`** is exported from `@arcjet/guard/mastra/v1` in 1.11.0. It reads `MASTRA_THREAD_ID_KEY`, then resource, then run. It never mints. It never calls `createAgentContext` (that splits the Sequence). Wrappers read `RequestContext` themselves; use this helper when calling core `guard()`. Set the reserved keys on `RequestContext` before `generate` / `stream`.
- Fail closed by default (`onGuardError: "deny"`). Optional peer `@mastra/core` `>=1 <2`. Node.js 22+.

```typescript
import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import {
  MASTRA_RESOURCE_ID_KEY,
  MASTRA_THREAD_ID_KEY,
  RequestContext,
} from "@mastra/core/request-context";
import { launchArcjet, detectPromptInjection, tokenBucket } from "@arcjet/guard";
import {
  guardHooks,
  guardProcessor,
  guardTool,
  mastraAgentContext,
} from "@arcjet/guard/mastra/v1";
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
const userId = authenticatedUserId;

const lookupOrder = guardTool(
  arcjet,
  createTool({
    id: "lookup-order",
    description: "Look up an order by ID",
    inputSchema: z.object({
      orderId: z.string(),
    }),
    async execute({ orderId }) {
      return { orderId, status: "shipped" };
    },
  }),
  {
    action: "order.looked-up",
    rules: () => [lookupLimit({ key: userId, requested: 1 })],
  },
);

const inbound = guardProcessor(arcjet, {
  action: "message.received",
  rules: ({ text }) => [detectPromptInjection()(text)],
});

const hooks = guardHooks(arcjet, {
  action: ({ toolName }) => `${toolName}.invoked`,
  rules: ({ toolName }) => [mcpLimit({ key: toolName, requested: 1 })],
});

const agent = new Agent({
  id: "support-agent",
  name: "support-agent",
  instructions: "Help the user.",
  model: "openai/gpt-4o",
  tools: { lookupOrder },
  inputProcessors: [inbound],
  hooks,
});

const requestContext = new RequestContext();
requestContext.set(MASTRA_THREAD_ID_KEY, conversationId);
requestContext.set(MASTRA_RESOURCE_ID_KEY, userId);
const ctx = mastraAgentContext(requestContext);
// Wrappers read RequestContext. Spread `ctx` onto core `guard()` / `capture()`
// so those calls join the same Sequence.

await agent.generate(userText, { requestContext });
```
