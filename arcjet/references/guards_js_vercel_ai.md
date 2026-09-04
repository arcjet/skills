# JavaScript Guard: Vercel AI SDK

Load [guards_javascript.md](guards_javascript.md) for the client, rules, labels, decisions, capture, and the shared `ArcjetDenialResult` shape. This file is only the Vercel AI SDK adapter. Do not also wrap with a sibling adapter.

Docs: https://docs.arcjet.com/guards/vercel-ai/

Exports: `guardTool`, `guardAction`, `captureAction`, `aiToolsContext`, `createAgentContext`, `securityMetadata`. There is no unversioned `@arcjet/guard/vercel-ai` alias. This is `ai` >= 7 `tool({ execute })` + `generateText` / `streamText` / `ToolLoopAgent`. Ships in `@arcjet/guard` 1.11.0. **This is the only JS adapter that maps typed `inputs` / `actor` to a remote policy.** Use `policyInput.server` / `policyInput.local`. Every other JS adapter takes `action` + SDK `rules`. Wrappers take `action`, not `label`.

Three gotchas first:

1. **Screen inbound before `generateText`.** Call `arcjet.guard()` in the application and **act on the decision**. Core `guard()` fails open: `ALLOW` is not proof the rules ran. Gate on `decision.hasFailedOpen()` if this call site must fail closed; `guardTool` / `guardAction` already default to that.
2. **`toolsContext` is required for correlation and the compiler will not catch a miss.** Pass `toolsContext: aiToolsContext(ctx, tools)`. Omitting it leaves correlation empty (first uncorrelated call warns; later ones are silent unless `ARCJET_LOG_LEVEL=warn`). Only tools branded by `guardTool` are included.
3. **`guardTool` and `guardAction` are different handlers.** Model-invoked tools return `ArcjetDenialResult` as the tool result — do not throw. App-invoked work uses `guardAction`, which throws `ArcjetDeniedError` / `ArcjetGuardUnavailableError`. Sharing one callback leaks a throw into the tool loop or swallows a denial as success. Wrapped tools cannot already declare `contextSchema` (`guardTool` throws). HITL on other SDKs is not a policy gate here.

- **`guardTool`** wraps `tool({ execute })` so `execute` never runs on `DENY`. Return `{ arcjetDenied: true, … }`. A throw becomes a generic tool error and drops the fields. Only rate-limit denials are `retryable` with `retryAfterSeconds`. Unavailable default is `reason: "ERROR"`, `retryable: true`, `retryAfterSeconds: 5`.
- **`createAgentContext`** at the run entry. Pass a caller-owned `correlationId` when you have one (1–256 printable ASCII); omit to auto-generate a ULID. Thread the context by hand — never stash it in module state or ALS.
- **`aiToolsContext(ctx, tools)`** maps that context onto `generateText` / `streamText`. Always add a system-prompt line that a denied tool must not be retried.
- **`guardAction`** wraps an app-invoked function. Throws `ArcjetDeniedError` on DENY and `ArcjetGuardUnavailableError` when the policy could not be evaluated. `captureAction` is observe-only.
- Fail closed by default (`onGuardError: "deny"`). Optional peers `ai` >= 7 and `@ai-sdk/provider-utils`. Node.js 22+. Do not also wrap with Eve / Mastra / LangChain / Claude adapters.

```typescript
import { launchArcjet, detectPromptInjection, policyInput, tokenBucket } from "@arcjet/guard";
import {
  aiToolsContext,
  createAgentContext,
  guardTool,
} from "@arcjet/guard/vercel-ai/v7";
import { generateText, tool } from "ai";
import { z } from "zod";

const arcjet = launchArcjet({ key: process.env.ARCJET_KEY! });
const lookupLimit = tokenBucket({
  bucket: "lookups",
  refillRate: 5,
  intervalSeconds: 10,
  maxTokens: 10,
});
const inbound = detectPromptInjection();
const userId = authenticatedUserId;

export async function runAgent(prompt: string) {
  const decision = await arcjet.guard({
    label: "message.received",
    actor: userId,
    rules: [inbound(prompt)],
  });
  if (decision.conclusion === "DENY" || decision.hasFailedOpen()) {
    throw new Error("message blocked");
  }

  const lookupOrder = guardTool(
    arcjet,
    tool({
      description: "Look up an order by ID",
      inputSchema: z.object({ orderId: z.string() }),
      execute: async ({ orderId }) => ({ orderId, status: "shipped" }),
    }),
    {
      action: "order.looked-up",
      actor: userId,
      rules: () => [lookupLimit({ key: userId, requested: 5 })],
      // Only this adapter maps typed inputs to a remote policy.
      inputs: ({ orderId }) => ({
        order_id: policyInput.server.string(orderId),
      }),
    },
  );

  const tools = { lookupOrder };
  const context = createAgentContext({ correlationId: userId });

  return generateText({
    model: "openai/gpt-4o-mini",
    system:
      "If a tool call is denied by security policy, do not retry it. Explain the denial to the user or try a different approach.",
    prompt,
    tools,
    toolsContext: aiToolsContext(context, tools),
  });
}
```
