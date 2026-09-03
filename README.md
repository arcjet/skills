<a href="https://arcjet.com" target="_arcjet-home">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://arcjet.com/logo/arcjet-dark-lockup-voyage-horizontal.svg">
    <img src="https://arcjet.com/logo/arcjet-light-lockup-voyage-horizontal.svg" alt="Arcjet Logo" height="128" width="auto">
  </picture>
</a>

# Arcjet Skill

An [Agent Skill](https://agentskills.io/) for [Arcjet](https://arcjet.com/) —
the runtime security platform that ships with your code.

Gives AI coding agents the knowledge to add Arcjet security protection to any
project. Works in VS Code (GitHub Copilot), Claude Code, Cursor, and any other
[compatible agent](https://agentskills.io/clients).

## Install the `arcjet` skill

```sh
npx skills add arcjet/skills
```

The Arcjet skill for AI coding agents. Adds protection across HTTP route handlers, AI agent tool calls, MCP servers, background jobs, and queue workers — rate limiting, bot detection, email validation, prompt injection detection, sensitive information blocking, content moderation, and abuse prevention — and verifies decisions via the Arcjet CLI, MCP server, and Console. Works in JavaScript/TypeScript, Python, and Go across Next.js, Express, Fastify, SvelteKit, Remix, Bun, Deno, NestJS, FastAPI, Flask, `net/http`, and non-HTTP contexts.

Dedicated Guard integration skills cover official Python LangChain, CrewAI, OpenAI Agents, Claude Agent SDK, Claude Managed Agents, Strands Agents, and Google ADK adapters, plus JS Cloudflare Think. Shared fundamentals stay in the `arcjet` skill.

| Skill | When to load |
| --- | --- |
| `arcjet` | HTTP routes, core Guard, and routing to a dedicated adapter skill |
| `integrate-arcjet-guard-langchain-py` | Python LangChain `BaseTool` / `create_agent` |
| `integrate-arcjet-guard-crewai` | Official CrewAI |
| `integrate-arcjet-guard-openai-agents-py` | Python OpenAI Agents |
| `integrate-arcjet-guard-claude-agent-sdk-py` | Python Claude Agent SDK |
| `integrate-arcjet-guard-claude-managed-agents-py` | Python Claude Managed Agents |
| `integrate-arcjet-guard-strands-agents-py` | Python Strands Agents |
| `integrate-arcjet-guard-google-adk-py` | Python Google ADK (`guard_tool` / `guard_plugin`, `google-adk>=2.0.0,<3`) |
| `integrate-arcjet-guard-cloudflare-think` | JS Cloudflare Think (`@cloudflare/think`) |

## Related

This skill is also bundled by the
[Arcjet plugin](https://github.com/arcjet/arcjet-plugin), which packages it as
a slash command for Claude Code and Cursor (alongside MCP integration and a
security-analyst agent). Choose the plugin if you want the bundled experience;
choose the direct skill install (`npx skills add arcjet/skills`) for
portability across any [agentskills.io](https://agentskills.io/)-compatible
client.

## Links

- [Arcjet Documentation](https://docs.arcjet.com/)
- [Arcjet docs for LLMs](https://docs.arcjet.com/llms.txt) ([full](https://docs.arcjet.com/llms-full.txt))
- [Agent Skills Specification](https://agentskills.io/specification)
- [Arcjet Plugin](https://github.com/arcjet/arcjet-plugin)
- [Arcjet JS SDK](https://github.com/arcjet/arcjet-js)
- [Arcjet Python SDK](https://github.com/arcjet/arcjet-py)
- [Arcjet Go SDK](https://github.com/arcjet/arcjet-go)
- [Arcjet MCP Server](https://docs.arcjet.com/mcp-server)
- [Arcjet CLI](https://github.com/arcjet/cli) ([npm](https://www.npmjs.com/package/@arcjet/cli))

## License

Licensed under the [Apache License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0).
