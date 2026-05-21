package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"

	openai "github.com/sashabaranov/go-openai"
)

type ToolResult struct {
	Name   string `json:"name"`
	Result string `json:"result"`
}

func getWeather(city string) string {
	return fmt.Sprintf(`{"city": "%s", "temp": 72, "condition": "sunny"}`, city)
}

func searchWeb(query string) string {
	return fmt.Sprintf(`{"results": [{"title": "Result for %s", "url": "https://example.com"}]}`, query)
}

func handleToolCall(name string, args map[string]string, userID string) (string, error) {
	switch name {
	case "get_weather":
		return getWeather(args["city"]), nil
	case "search_web":
		return searchWeb(args["query"]), nil
	default:
		return "", fmt.Errorf("unknown tool: %s", name)
	}
}

func runAgent(userMessage string, userID string) error {
	client := openai.NewClient(os.Getenv("OPENAI_API_KEY"))

	tools := []openai.Tool{
		{
			Type: openai.ToolTypeFunction,
			Function: &openai.FunctionDefinition{
				Name:        "get_weather",
				Description: "Get the current weather for a city",
				Parameters: json.RawMessage(`{
					"type": "object",
					"properties": {"city": {"type": "string"}},
					"required": ["city"]
				}`),
			},
		},
		{
			Type: openai.ToolTypeFunction,
			Function: &openai.FunctionDefinition{
				Name:        "search_web",
				Description: "Search the web for information",
				Parameters: json.RawMessage(`{
					"type": "object",
					"properties": {"query": {"type": "string"}},
					"required": ["query"]
				}`),
			},
		},
	}

	resp, err := client.CreateChatCompletion(
		context.Background(),
		openai.ChatCompletionRequest{
			Model: openai.GPT4o,
			Messages: []openai.ChatCompletionMessage{
				{Role: openai.ChatMessageRoleSystem, Content: "You are a helpful assistant with access to tools."},
				{Role: openai.ChatMessageRoleUser, Content: userMessage},
			},
			Tools: tools,
		},
	)
	if err != nil {
		return fmt.Errorf("chat completion error: %w", err)
	}

	choice := resp.Choices[0]
	if choice.Message.ToolCalls != nil {
		for _, tc := range choice.Message.ToolCalls {
			var args map[string]string
			json.Unmarshal([]byte(tc.Function.Arguments), &args)
			result, err := handleToolCall(tc.Function.Name, args, userID)
			if err != nil {
				log.Printf("Tool %s failed: %v", tc.Function.Name, err)
				continue
			}
			fmt.Printf("Tool %s: %s\n", tc.Function.Name, result)
		}
	}

	return nil
}

func main() {
	if err := runAgent("What's the weather in San Francisco?", "user_123"); err != nil {
		log.Fatal(err)
	}
}
