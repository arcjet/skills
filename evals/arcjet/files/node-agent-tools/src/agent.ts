import OpenAI from "openai";

const openai = new OpenAI();

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Get the current weather for a city",
      parameters: {
        type: "object",
        properties: { city: { type: "string" } },
        required: ["city"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_web",
      description: "Search the web for information",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
];

async function getWeather(city: string) {
  // Simulated weather lookup
  return { city, temp: 72, condition: "sunny" };
}

async function searchWeb(query: string) {
  // Simulated web search
  return { results: [{ title: "Result 1", url: "https://example.com" }] };
}

async function handleToolCall(name: string, args: Record<string, string>) {
  switch (name) {
    case "get_weather":
      return await getWeather(args.city);
    case "search_web":
      return await searchWeb(args.query);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function runAgent(userMessage: string, userId: string) {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: "You are a helpful assistant with access to tools." },
    { role: "user", content: userMessage },
  ];

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages,
    tools,
  });

  const choice = response.choices[0];
  if (choice.message.tool_calls) {
    for (const toolCall of choice.message.tool_calls) {
      const args = JSON.parse(toolCall.function.arguments);
      const result = await handleToolCall(toolCall.function.name, args);
      console.log(`Tool ${toolCall.function.name}:`, result);
    }
  }

  return choice.message.content;
}

// Example usage
runAgent("What's the weather in San Francisco?", "user_123");
