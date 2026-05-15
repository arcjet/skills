# JavaScript/TypeScript Request Protection

## What Request Protection Is

Request protection inspects HTTP requests — headers, IP, body — to enforce security rules on API routes, form handlers, and server-rendered pages. Each web framework has a dedicated Arcjet adapter that knows how to extract the request metadata.

## Installation

Pick the adapter for the project's framework, then install it with whichever package manager the project already uses (`npm install`, `pnpm add`, `yarn add`, `bun add`). Don't hand-edit `package.json` — a typed version is usually stale, and the lockfile won't update. Read the installed package's types and doc comments for the full API surface.

| Framework                | Package                |
| ------------------------ | ---------------------- |
| Next.js                  | `@arcjet/next`         |
| Express / Node.js / Hono | `@arcjet/node`         |
| Fastify                  | `@arcjet/fastify`      |
| NestJS                   | `@arcjet/nest`         |
| SvelteKit                | `@arcjet/sveltekit`    |
| Remix                    | `@arcjet/remix`        |
| React Router             | `@arcjet/react-router` |
| Astro                    | `@arcjet/astro`        |
| Bun                      | `@arcjet/bun`          |
| Deno                     | `npm:@arcjet/deno`     |

## Architecture: Why Things Go Where They Do

### Shared client file

Create a **separate file** (e.g. `src/lib/arcjet.ts` or `lib/arcjet.ts`) that exports the Arcjet instance. Do NOT define the client inline in route handlers — it should be importable from any route.

Always include `shield({ mode: "LIVE" })` as a base rule, even when using combined rules like `protectSignup()`. Shield protects against common attacks (SQLi, XSS) and costs nothing to add.

```typescript
// src/lib/arcjet.ts
import arcjet, { shield } from "@arcjet/next"; // or @arcjet/node, etc.

export const aj = arcjet({
  key: process.env.ARCJET_KEY!,
  rules: [shield({ mode: "LIVE" })],
});
```

### withRule() for per-route rules

Use `withRule()` to add route-specific rules without modifying the shared instance. This keeps the base protection (shield) everywhere while layering additional rules per endpoint.

```typescript
import aj from "@/lib/arcjet";
import { slidingWindow } from "@arcjet/next";

const protect = aj.withRule(slidingWindow({ mode: "LIVE", interval: 60, max: 100 }));
```

### protect() in route handlers, not middleware

Call `protect()` inside each route handler, once per request. Don't call it in Express middleware (`app.use()`) or Next.js middleware — these run on every request including static assets, and you lose the ability to apply different rules to different routes.

## Choosing Rules

See the "Choosing the Right Rules" section in the main skill for rule selection guidance and rate limiting strategy comparisons. Key framework-specific notes:

- **shield** — always include. No configuration needed.
- **detectBot** — use `allow` for a safelist or `deny` for specific categories. They're mutually exclusive.
- **Rate limits** — use `characteristics: ["userId"]` to key by something other than IP.
- **validateEmail** — for signup/login forms.
- **protectSignup** — combined bot + email + rate limit, purpose-built for registration flows.
- **sensitiveInfo** — blocks PII in request bodies.
- **detectPromptInjection** — for AI endpoints receiving user prompts.
- **filter** — block by IP metadata (VPN, Tor, country, IP range).

## Framework-Specific protect() Calls

The request object to pass differs by framework:

| Framework | What to pass to protect() |
|-----------|--------------------------|
| Express / Node.js | `req` (IncomingMessage) |
| Next.js App Router | `req` (Request) |
| Next.js Server Components | `await request()` from `@arcjet/next` |
| Fastify | `request` (Fastify request, not raw Node) |
| SvelteKit | `event` |
| Remix / React Router | `args` |
| Hono on Node.js | `c.env.incoming` |
| Hono on Bun | `c.req.raw` |
| Bun / Deno | wrap fetch with `aj.handler()` |

## Decision Handling

`decision.isDenied()` means a LIVE rule triggered a denial. Map denial reasons to HTTP status codes, but **only branch on reasons that produce a different response** — skip arms that would just return the same status as the default 403:

- `decision.reason.isRateLimit()` → 429
- `decision.reason.isEmail()` → 400
- `decision.reason.isSensitiveInfo()` → 400
- `decision.reason.isPromptInjection()` → 400
- everything else (bot, shield, filter) → default 403

Writing an explicit `else if (reason.isShield())` arm that returns 403 just adds noise when the default already returns 403.

`decision.isErrored()` means something went wrong during rule evaluation but the SDK failed open. Log it and allow the request.

## Key Patterns

- Rules that need extra input at protect() time: `tokenBucket` needs `{ requested: N }`, `validateEmail`/`protectSignup` needs `{ email }`, `sensitiveInfo` needs `{ sensitiveInfoValue }`, `detectPromptInjection` needs `{ detectPromptInjectionMessage }`.
- Every rule accepts `mode: "LIVE" | "DRY_RUN"`. Start with DRY_RUN to verify rules match expected traffic before enforcing.
- For existing projects, check for an existing Arcjet client file before creating a new one — extend with `withRule()` instead.
