import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "data-tools",
  version: "1.0.0",
});

server.tool(
  "query_database",
  "Run a read-only SQL query against the analytics database",
  { query: z.string().describe("The SQL query to execute") },
  async ({ query }) => {
    // Simulated database query
    const rows = [{ id: 1, name: "Example", value: 42 }];
    return {
      content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
    };
  },
);

server.tool(
  "send_notification",
  "Send a notification to a user or channel",
  {
    recipient: z.string().describe("User ID or channel name"),
    message: z.string().describe("The notification message"),
  },
  async ({ recipient, message }) => {
    // Simulated notification send
    console.log(`Notifying ${recipient}: ${message}`);
    return {
      content: [{ type: "text", text: `Notification sent to ${recipient}` }],
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main();
