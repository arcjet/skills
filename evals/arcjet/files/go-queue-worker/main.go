package main

import (
	"context"
	"fmt"
)

type job struct {
	UserID    string
	Prompt    string
	TokenCost int
}

func callModel(_ context.Context, prompt string) (string, error) {
	return "model response to: " + prompt, nil
}

func processJob(ctx context.Context, j job) (string, error) {
	return callModel(ctx, j.Prompt)
}

func main() {
	result, err := processJob(context.Background(), job{
		UserID:    "user_123",
		Prompt:    "Summarize this document",
		TokenCost: 200, // Preflight estimate supplied by the job producer.
	})
	if err != nil {
		panic(err)
	}
	fmt.Println(result)
}
