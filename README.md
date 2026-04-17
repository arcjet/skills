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
| `protect-route` | Add security protection to a server-side route or endpoint — rate limiting, bot detection, email validation, and abuse prevention. Works across Next.js, Express, Fastify, SvelteKit, Remix, Bun, Deno, NestJS, FastAPI, and Flask. |
| `add-ai-protection` | Secure AI/LLM endpoints with layered protection — prompt injection detection, PII blocking, and token budget rate limiting. |

## Links

- [Arcjet Documentation](https://docs.arcjet.com/)
- [Agent Skills Specification](https://agentskills.io/specification)
- [Arcjet JS SDK](https://github.com/arcjet/arcjet-js)
- [Arcjet Python SDK](https://github.com/arcjet/arcjet-py)
- [Arcjet MCP Server](https://docs.arcjet.com/mcp-server)

## License

Licensed under the [Apache License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0).
