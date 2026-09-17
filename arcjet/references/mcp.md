# Arcjet MCP Server

The MCP server connects AI coding tools to the Arcjet API over HTTP with OAuth authentication. Use it when the CLI isn't available or the client has built-in MCP support.

**Endpoint:** `https://api.arcjet.com/mcp`

## Setup

### VS Code

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "arcjet": {
      "type": "http",
      "url": "https://api.arcjet.com/mcp"
    }
  }
}
```

Or via Command Palette: `MCP: Add Server` → HTTP → `https://api.arcjet.com/mcp` → name `Arcjet`.

### Claude Code

```bash
claude mcp add arcjet --transport http https://api.arcjet.com/mcp
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "arcjet": {
      "type": "streamable-http",
      "url": "https://api.arcjet.com/mcp"
    }
  }
}
```

### Windsurf

Add to `mcp_config.json`:

```json
{
  "mcpServers": {
    "arcjet": {
      "serverUrl": "https://api.arcjet.com/mcp"
    }
  }
}
```

### Claude Desktop

Settings → Connectors → Add custom connector → Name: `Arcjet`, URL: `https://api.arcjet.com/mcp`

### ChatGPT

Settings → Connectors → Add connection → URL: `https://api.arcjet.com/mcp` → OAuth

## Authentication

OAuth-based. On first connection, you'll be redirected to sign in with your Arcjet account. Subsequent calls authenticate automatically.

## Available tools

Once connected, the MCP server exposes tools for managing teams, sites, keys, requests, decisions, traffic analysis, anomaly detection, IP investigation, security briefings, remote rules, and Guard policies. The agent can discover available tools through the MCP protocol directly. Guard policy authoring is MCP-only — the CLI has no policy commands.

## Common workflows

**Bootstrap a project:** `list-teams` → `list-sites` → `get-site-key` → write to `.env` as `ARCJET_KEY`

**Investigate suspicious traffic:** `analyze-traffic` → `list-requests` (filter DENY) → `investigate-ip` → `create-rule` (DRY_RUN) → `get-dry-run-impact` → `promote-rule`

**Daily security briefing:** `get-security-briefing`

**Add protection without redeploying:** `create-rule` (bot/filter in DRY_RUN) → `get-dry-run-impact` → `promote-rule`

**Author a Guard policy:** `list-guard-policies` → `describe-guard-policy` → `validate-guard-policy` → `put-guard-policy`. Application policies select by `label` / wrapper `action`. Coding-agent policies attach by **Execute on** (Tool call or Prompt), not by label; publishing turns them on. Install Claude Code / Copilot HTTP hooks from https://docs.arcjet.com/coding-agents — copy the templates. The hook URL must not name a policy and must omit `?surface=` (managed settings reach CLI, IDE, Desktop, and cloud; a hard-coded `cli` mislabels most traffic).

## Security notes

- Verify the endpoint is `https://api.arcjet.com/mcp`
- Enable confirmation prompts in your AI client for write operations
- Only connect from trusted AI clients
