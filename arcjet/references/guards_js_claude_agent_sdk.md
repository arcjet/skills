# JavaScript Guard: Claude Agent SDK

Load [guards_javascript.md](guards_javascript.md) for the client, rules, labels, decisions, capture, and the shared `ArcjetDenialResult` shape. This file is only the Claude Agent SDK adapter. Do not also wrap with a sibling adapter.

Docs: https://docs.arcjet.com/guards/claude-agent-sdk/

Exports: `guardTool`, `guardHooks`, `claudeAgentContext`, plus the shared
`guardAction` / `captureAction` / `securityMetadata`. There is no unversioned
`@arcjet/guard/claude-agent-sdk` alias.

- **`guardTool`** wraps an authored `tool()` definition (the ones you pass to `createSdkMcpServer`) so the handler never runs on DENY. Delivery is the shared `ArcjetDenialResult` in a MCP `CallToolResult` with `isError: true` (payload on `structuredContent`). A throw is a raw exception; omitting `isError` looks like success.
- **`guardHooks`** returns hooks for `query({ options.hooks })`. `inbound` screens `UserPromptSubmit` – the only place a turn can be declined before the model reads the prompt, so prompt-injection rules go here. Inbound deny is Claude's hook shape `{ decision: "block" }`, not `ArcjetDenialResult`. `PreToolUse` denies with `permissionDecision: "deny"` and is the only gate for built-ins (Bash, Write) and unwrapped MCP tools. `PostToolUse` is observe-only.
- **`exclude`** on `guardHooks` lists tools that already guard themselves via `guardTool`. `PreToolUse` fires for every tool and the hook input carries only a name, so without it a wrapped tool is guarded twice per invocation – two round trips, two quota units. Entries match the reported name exactly: pass `{ server, name }` for an authored tool (it resolves to `mcp__<server>__<tool>`) and a bare string for a built-in. A bare authored name deliberately does **not** match every server's tool of that name – two servers can expose the same name with only one wrapped.
- **`options.sessionId` must be a UUID, and a session id can only be created once.** A non-UUID exits the CLI with `Invalid session ID. Must be a valid UUID.`; passing the same id to a second `query()` exits with `Session ID … is already in use.` Mint one UUID per conversation, then continue it with `options.resume` – which is also what keeps every turn on one Sequence, since `claudeAgentContext` reads the hook's `session_id` first.
- Isolation needs `settingSources: []` **and** `strictMcpConfig: true`. Guarding one tool only helps if it is the only path.
- `ClaudeAgentOptions.sessionId` is unique per run; the Guard `sessionId` passed to `guardTool` / `guardHooks` is a long-lived actor id.
- `canUseTool` is not a policy gate (skipped by `allowedTools`, allow rules, `bypassPermissions` / `acceptEdits`), and annotations / sandbox settings are not enforcement. Do not double-wrap with `vercel-ai/v7`.

```typescript
import { randomUUID } from "node:crypto";
import { launchArcjet, detectPromptInjection, tokenBucket } from "@arcjet/guard";
import { guardHooks, guardTool } from "@arcjet/guard/claude-agent-sdk/v0";
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const arcjet = launchArcjet({ key: process.env.ARCJET_KEY! });
const lookupLimit = tokenBucket({ bucket: "lookups", refillRate: 10, intervalSeconds: 60, maxTokens: 10 });

// The authenticated caller this conversation belongs to. Key the budget on the
// actor, not on the object being acted on: an order id is model-supplied, so
// keying on it lets a looping agent get a fresh budget per order and makes two
// unrelated callers share one.
const userId = authenticatedUserId;

const lookupOrder = guardTool(
  arcjet,
  tool("lookup_order", "Look up an order", { orderId: z.string() }, async ({ orderId }) => ({
    content: [{ type: "text", text: `${orderId}: shipped` }],
  })),
  {
    action: "order.looked-up",
    rules: () => [lookupLimit({ key: userId, requested: 1 })],
  },
);

const sessionId = randomUUID(); // per conversation, not per turn

for await (const message of query({
  prompt: userText,
  options: {
    sessionId, // later turns: `resume: sessionId` instead
    mcpServers: { support: createSdkMcpServer({ name: "support", tools: [lookupOrder] }) },
    hooks: guardHooks(arcjet, {
      sessionId,
      exclude: [{ server: "support", name: "lookup_order" }], // guarded by guardTool
      inbound: {
        action: "message.received",
        rules: ({ prompt }) => [detectPromptInjection()(prompt)],
      },
    }),
  },
})) {
  void message;
}
```
