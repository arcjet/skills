// Example Microsoft Agent Framework agent with no security protection.
//
// The agent has two tools. lookup_order looks up an order's status.
// issue_refund refunds an order in full. Neither tool call is rate limited,
// screened for prompt injection, or otherwise checked before it runs.
//
// The context carries a Session holding the customer and conversation the run
// belongs to.
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

// Session is the customer conversation this process is serving. A real
// application builds one per request; here it is fixed so the example runs on
// its own. Tool handlers read it from the context they are called with.
type Session struct {
	CustomerID     string
	ConversationID string
}

type sessionKey struct{}

func WithSession(ctx context.Context, s Session) context.Context {
	return context.WithValue(ctx, sessionKey{}, s)
}

func SessionFrom(ctx context.Context) (Session, bool) {
	s, ok := ctx.Value(sessionKey{}).(Session)
	return s, ok
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
		func(ctx context.Context, in orderArgs) (string, error) {
			s, ok := SessionFrom(ctx)
			if !ok {
				return "", errors.New("no session on the context")
			}
			return fmt.Sprintf("Refund issued for order %s to customer %s", in.OrderNumber, s.CustomerID), nil
		})

	a := anthropicprovider.NewAgent(anthropic.NewClient(), anthropicprovider.AgentConfig{
		Model:        model,
		Instructions: "You help customers with their orders.",
		Config: agent.Config{
			Name:  "OrdersAgent",
			Tools: []tool.Tool{lookupOrder, issueRefund},
		},
	})

	session := Session{CustomerID: "cus_8Fq2Rv", ConversationID: "conv_5Kd9Ta"}
	ctx := WithSession(context.Background(), session)
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
