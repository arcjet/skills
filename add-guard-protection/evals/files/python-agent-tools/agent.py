import asyncio
import json
import os
from openai import AsyncOpenAI

client = AsyncOpenAI()

tools = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get the current weather for a city",
            "parameters": {
                "type": "object",
                "properties": {"city": {"type": "string"}},
                "required": ["city"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_web",
            "description": "Search the web for information",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "lookup_user",
            "description": "Look up user profile information",
            "parameters": {
                "type": "object",
                "properties": {"user_id": {"type": "string"}},
                "required": ["user_id"],
            },
        },
    },
]


async def get_weather(city: str) -> dict:
    """Simulated weather lookup."""
    return {"city": city, "temp": 72, "condition": "sunny"}


async def search_web(query: str) -> dict:
    """Simulated web search — returns untrusted content."""
    return {"results": [{"title": "Result 1", "snippet": "Some content from the web"}]}


async def lookup_user(user_id: str) -> dict:
    """Look up user profile — may contain PII."""
    return {"user_id": user_id, "name": "Alice", "email": "alice@example.com"}


async def handle_tool_call(
    name: str, args: dict, user_id: str
) -> dict:
    match name:
        case "get_weather":
            return await get_weather(args["city"])
        case "search_web":
            return await search_web(args["query"])
        case "lookup_user":
            return await lookup_user(args["user_id"])
        case _:
            raise ValueError(f"Unknown tool: {name}")


async def run_agent(user_message: str, user_id: str) -> str | None:
    messages = [
        {"role": "system", "content": "You are a helpful assistant with access to tools."},
        {"role": "user", "content": user_message},
    ]

    response = await client.chat.completions.create(
        model="gpt-4o",
        messages=messages,
        tools=tools,
    )

    choice = response.choices[0]
    if choice.message.tool_calls:
        for tool_call in choice.message.tool_calls:
            args = json.loads(tool_call.function.arguments)
            result = await handle_tool_call(tool_call.function.name, args, user_id)
            print(f"Tool {tool_call.function.name}: {result}")

    return choice.message.content


if __name__ == "__main__":
    asyncio.run(run_agent("What's the weather in San Francisco?", "user_123"))
