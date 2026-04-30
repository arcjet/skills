<a href="https://arcjet.com" target="_arcjet-home">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://arcjet.com/logo/arcjet-dark-lockup-voyage-horizontal.svg">
    <img src="https://arcjet.com/logo/arcjet-light-lockup-voyage-horizontal.svg" alt="Arcjet Logo" height="128" width="auto">
  </picture>
</a>

# Arcjet Skills

[Agent Skills](https://agentskills.io/) for [Arcjet](https://arcjet.com/) —
the runtime security platform that ships with your code.

These skills give AI coding agents the knowledge to add Arcjet security
protections to any project. They work in VS Code (GitHub Copilot), Claude Code,
Cursor, and any other [compatible agent](https://agentskills.io/clients).

## Installation

```sh
npx skills add arcjet/skills
```

## Skills

| Skill | Description |
| ----- | ----------- |
| `add-request-protection` | Add security protection to a server-side route or endpoint — rate limiting, bot detection, email validation, and abuse prevention. Works across Next.js, Express, Fastify, SvelteKit, Remix, Bun, Deno, NestJS, FastAPI, and Flask. |
| `add-guard-protection` | Add Arcjet Guard protection to AI agent tool calls, background jobs, queue workers, and other non-HTTP code paths — rate limiting, prompt injection detection, sensitive information blocking, and custom rules. |

## Related

These skills are also bundled by the
[Arcjet plugin](https://github.com/arcjet/arcjet-plugin), which packages them
as `/arcjet:add-request-protection` and `/arcjet:add-guard-protection` slash
commands for Claude Code and Cursor (alongside MCP integration and a
security-analyst agent). Choose the plugin if you want the bundled experience;
choose the direct skill install (`npx skills add arcjet/skills`) for
portability across any [agentskills.io](https://agentskills.io/)-compatible
client.

## Links

- [Arcjet Documentation](https://docs.arcjet.com/)
- [Agent Skills Specification](https://agentskills.io/specification)
- [Arcjet Plugin](https://github.com/arcjet/arcjet-plugin)
- [Arcjet JS SDK](https://github.com/arcjet/arcjet-js)
- [Arcjet Python SDK](https://github.com/arcjet/arcjet-py)
- [Arcjet MCP Server](https://docs.arcjet.com/mcp-server)
- [Arcjet CLI](https://github.com/arcjet/cli) ([npm](https://www.npmjs.com/package/@arcjet/cli))

## License

Licensed under the [Apache License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0).
