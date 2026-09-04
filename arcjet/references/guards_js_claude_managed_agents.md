# JavaScript Guard: Claude Managed Agents

Load [guards_javascript.md](guards_javascript.md) for the client, rules, labels, decisions, capture, and the shared `ArcjetDenialResult` shape. This file is only the Claude Managed Agents adapter. Do not also wrap with a sibling adapter.

Docs: https://docs.arcjet.com/guards/claude-managed-agents/

Exports: `guardCustomTool`, `guardEvents`, `claudeManagedAgentsContext`. There is no `guardTool`, `guardHooks`, `guardInbound`, or unversioned `@arcjet/guard/claude-managed-agents` alias. This is the hosted Claude Managed Agents harness (`@anthropic-ai/sdk` `client.beta.sessions`). It is **not** Claude Agent SDK local `query()` / `PreToolUse` — that stays `@arcjet/guard/claude-agent-sdk/v0` (docs https://docs.arcjet.com/guards/claude-agent-sdk/). Optional peer `@anthropic-ai/sdk` `>=0.86.0 <1` — not `@anthropic-ai/claude-agent-sdk`. Until-published: published `@arcjet/guard@1.11.0` does not export `./claude-managed-agents/v0` (`ERR_PACKAGE_PATH_NOT_EXPORTED`). Pin `@arcjet/guard` to git SHA `cb35c8f92c3a2fb63fbeb9b386d79b1878c19d92`. Worked example: [`examples/claude-managed-agents`](https://github.com/arcjet/arcjet-js/tree/main/examples/claude-managed-agents) (vendors the same `cb35c8f9`). Read the installed package's types before wiring. Python is `arcjet.guard.claude_managed_agents` (shared docs https://docs.arcjet.com/guards/claude-managed-agents/; load [integrate-arcjet-guard-claude-managed-agents-py](../../integrate-arcjet-guard-claude-managed-agents-py/SKILL.md)). There is no `/guards/claude-managed-agents-py/` page.

This is a hosted harness. Anthropic runs the agent loop and the built-in toolset (`bash`, files, web_*). The agent toolset defaults to `always_allow`, so there is **no customer pre-exec** for bash/files — `agent.tool_use` / `agent.tool_result` fire after the built-in already ran. There is no `PreToolUse`. Do not paper over that gap with `always_ask`.

Three gotchas first:

1. **The real gates are inbound `user.message` and custom tools on `agent.custom_tool_use`.** `guardEvents(arcjet, { events, inbound, context }, send)` screens `user.message` **before** `sessions.events.send` — the only place a turn can be declined before the hosted harness reads the prompt, so prompt-injection rules go here. `inbound.rules` receives `{ text, events }`, not `{ prompt }`. On DENY / fail-closed unavailability it returns `{ allowed: false, outcome, message }` and does **not** call `send`. `guardCustomTool` on the hosted path is `guardCustomTool(arcjet, { event, execute, send }, policy)` when the session emits `agent.custom_tool_use`. Built-ins never enter that handler. Self-hosted `EnvironmentWorker` / `betaTool({ run })` uses the wrap form `guardCustomTool(arcjet, betaTool, policy)`. The CLI worker cannot register custom tools.
2. **`always_ask` + `user.tool_confirmation` is opt-in confirmation, not HITL-as-policy.** Permission policies apply to the agent toolset and MCP, not custom tools. Same trap as Claude Agent SDK `canUseTool`, Mastra `requireApproval`, and LangGraph `interrupt()`. Do not treat a confirmation prompt as a Guard deny.
3. **MCP Guard only on servers you host.** Anthropic is the MCP client. You cannot intercept Anthropic-side MCP execution from this adapter. If you host the MCP server, put Guard on that server (core Guard / MCP patterns) — not `guardCustomTool`, and not Claude Agent SDK `PreToolUse`.

- **`guardCustomTool`** (hosted) runs Guard before `execute`. On `DENY` (or unevaluated Guard under the default `onGuardError: "deny"`) `execute` does not run and `send` is invoked with a real `user.custom_tool_result` (`custom_tool_use_id`, denial text on `content`, **`is_error: true`**). On ALLOW the caller posts the success `user.custom_tool_result`. A throw leaves the hosted session idle waiting for a result; omitting `is_error` looks like success. This is not Claude Agent SDK `structuredContent`.
- **`guardEvents`** is permit-then-send. `send` is `(body) => client.beta.sessions.events.send(session.id, body)`. `@anthropic-ai/sdk` `>=0.86.0` takes the session id as the first positional argument on both `send` and `stream` (`stream(session.id)`); Python is `stream(session_id=...)`. There is no wrapper that returns `{ send }`. Events that are not `user.message` pass through without an inbound screen. Inbound `"allow"` is a legitimate `onGuardError` choice because failing closed stops the agent answering. `agent.tool_use` is observe-only — the built-in already ran.
- **`claudeManagedAgentsContext`** reads a **caller-owned** `correlationId` only. It never mints. It never reads Anthropic `session.id` / `sesn_…` / `sevt_…` / `id` / `traceId`. Do not `randomUUID()` a correlation id the way Claude Agent SDK `options.sessionId` requires, and do not pass Anthropic's session id as correlation.
- Fail closed by default (`onGuardError: "deny"`). Node.js 22+. Use `guardCustomTool` / `guardEvents` / `claudeManagedAgentsContext` only — not `guardTool`, `guardHooks`, `guardInbound`, `createAgentContext`, or `aiToolsContext`. Do not also wrap with `@arcjet/guard/claude-agent-sdk/v0` or `@arcjet/guard/vercel-ai/v7`. Docs: https://docs.arcjet.com/guards/claude-managed-agents/. Worked example: [`examples/claude-managed-agents`](https://github.com/arcjet/arcjet-js/tree/main/examples/claude-managed-agents).

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { launchArcjet, detectPromptInjection, tokenBucket } from "@arcjet/guard";
import {
  claudeManagedAgentsContext,
  guardCustomTool,
  guardEvents,
} from "@arcjet/guard/claude-managed-agents/v0";

const client = new Anthropic();
const arcjet = launchArcjet({ key: process.env.ARCJET_KEY! });
const lookupLimit = tokenBucket({
  bucket: "lookups",
  refillRate: 10,
  intervalSeconds: 60,
  maxTokens: 10,
});
const inbound = detectPromptInjection();
// The authenticated caller, so a budget cannot be reset by varying the order id.
const userId = authenticatedUserId;
// Caller-owned Sequence id — not Anthropic session.id / sevt_...
const conversationId = authenticatedConversationId;
const ctx = claudeManagedAgentsContext({ correlationId: conversationId });

const session = await client.beta.sessions.create({
  agent: agentId,
  environment_id: environmentId,
});

// Screen user.message before the hosted harness reads it. DENY does not send.
const verdict = await guardEvents(
  arcjet,
  {
    events: [{ type: "user.message", content: [{ type: "text", text: userText }] }],
    inbound: {
      action: "message.received",
      rules: ({ text }) => [inbound(text)],
    },
    context: ctx,
  },
  (body) => client.beta.sessions.events.send(session.id, body),
);
if (!verdict.allowed) {
  return verdict.message;
}

for await (const event of client.beta.sessions.events.stream(session.id)) {
  if (event.type === "agent.custom_tool_use" && event.name === "lookup_order") {
    const gated = await guardCustomTool(
      arcjet,
      {
        event,
        execute: (input) => lookupOrder(input),
        send: (result) =>
          client.beta.sessions.events.send(session.id, { events: [result] }),
      },
      {
        action: "order.looked-up",
        rules: () => [lookupLimit({ key: userId, requested: 1 })],
        context: ctx,
      },
    );
    if (gated.allowed) {
      await client.beta.sessions.events.send(session.id, {
        events: [
          {
            type: "user.custom_tool_result",
            custom_tool_use_id: event.id,
            content: [{ type: "text", text: JSON.stringify(gated.output) }],
          },
        ],
      });
    }
    // DENY already posted user.custom_tool_result with is_error: true. Do not throw.
  }
  // agent.tool_use / always_ask + user.tool_confirmation are not this policy gate
}
```

Key rate limits on the authenticated caller, not a model-supplied order id.
