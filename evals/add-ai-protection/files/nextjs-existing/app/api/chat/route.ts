import { anthropic } from "@ai-sdk/anthropic";
import { streamText } from "ai";
import type { UIMessage } from "ai";

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = streamText({
    model: anthropic("claude-sonnet-4-20250514"),
    system: "You are a helpful coding assistant.",
    messages,
  });

  return result.toDataStreamResponse();
}
