// Example Microsoft Agent Framework agent with no security protection.
//
// The agent has two tools. lookup_order looks up an order's status.
// issue_refund refunds an order in full. Neither tool call is rate limited,
// screened for prompt injection, or otherwise checked before it runs.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/microsoft/agent-framework-go/agent"
	"github.com/microsoft/agent-framework-go/provider/anthropicprovider"
	"github.com/microsoft/agent-framework-go/tool"
	"github.com/microsoft/agent-framework-go/tool/functool"
)

type orderArgs struct {
	OrderNumber string `json:"orderNumber"`
}

func main() {
	if err := run(); err != nil {
		slog.Error("orders agent", "error", err)
		os.Exit(1)
	}
}

func run() error {
	if os.Getenv("ANTHROPIC_API_KEY") == "" {
		return errors.New("ANTHROPIC_API_KEY is required")
	}
	model := os.Getenv("ANTHROPIC_MODEL")
	if model == "" {
		model = "claude-sonnet-5"
	}

	lookupOrder := functool.MustNew(functool.Config{Name: "lookup_order", Description: "Look up the status of an order"},
		func(_ context.Context, in orderArgs) (string, error) {
			return fmt.Sprintf("Order %s: shipped, arriving tomorrow", in.OrderNumber), nil
		})
	issueRefund := functool.MustNew(functool.Config{Name: "issue_refund", Description: "Refund an order in full"},
		func(_ context.Context, in orderArgs) (string, error) {
			return fmt.Sprintf("Refund issued for order %s", in.OrderNumber), nil
		})

	a := anthropicprovider.NewAgent(anthropic.NewClient(), anthropicprovider.AgentConfig{
		Model:        model,
		Instructions: "You help customers with their orders.",
		Config: agent.Config{
			Name:  "OrdersAgent",
			Tools: []tool.Tool{lookupOrder, issueRefund},
		},
	})

	ctx := context.Background()
	for _, prompt := range []string{
		"Where is order o-1001?",
		"Please refund order o-1001.",
		"Please refund order o-1002.",
	} {
		fmt.Printf("\n> %s\n", prompt)
		resp, err := a.RunText(ctx, prompt).Collect()
		if err != nil {
			fmt.Printf("run error: %v\n", err)
			continue
		}
		fmt.Println(resp.String())
	}

	return nil
}
