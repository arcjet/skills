# JavaScript/TypeScript request protection

## Contents

- [What request protection is](#what-request-protection-is)
- [Installation](#installation)
- [Architecture: why things go where they do](#architecture-why-things-go-where-they-do)
- [Framework-specific setup](#framework-specific-setup)
- [Choose rules](#choose-rules)
- [Framework-specific `protect()` calls](#framework-specific-protect-calls)
- [Decision handling](#decision-handling)
- [Deprecations](#deprecations)
- [Key patterns](#key-patterns)

## What request protection is

Request protection inspects HTTP requests – headers, IP, body – to enforce security rules on API routes, form handlers, and server-rendered pages. Each web framework has a dedicated Arcjet adapter that knows how to extract the request metadata.

## Installation

Pick the adapter for the project's framework, then install it with whichever package manager the project already uses (`npm install`, `pnpm add`, `yarn add`, `bun add`). Don't hand-edit `package.json` – a typed version is usually stale, and the lockfile won't update. Read the installed package's types and doc comments for the full API surface.

**Runtime baseline:** **Node.js `>=22.21.0 <23 || >=24.5.0`**, **Bun ≥ 1.3.0**, **Deno** `stable` / `lts`. Node 20 is end-of-life and is no longer supported by the SDK. If the project is below any of these, the install will fail or runtime behavior will misbehave – bump the runtime first.

> _Version info last verified against the published `@arcjet/*` **v1.10.0** on **August 11, 2026**. The 2000&nbsp;ms Decide timeout (every adapter, same as Guard) is on `main` ([arcjet-js#6236](https://github.com/arcjet/arcjet-js/pull/6236)). Numbers in the following table may drift – before relying on them, check the `package.json` of the relevant `@arcjet/*` package at https://github.com/arcjet/arcjet-js (or the published release at https://github.com/arcjet/arcjet-js/releases). Minimums tend to creep upward over time._

| Framework         | Package                                                   | Min framework version                                |
| ----------------- | --------------------------------------------------------- | ---------------------------------------------------- |
| Next.js           | `@arcjet/next`                                            | Next.js 15 or 16 (supported target; SDK peer range is broader) |
| Express / Node.js | `@arcjet/node`                                            | Node `>=22.21.0 <23 \|\| >=24.5.0` (no framework peer) |
| Fastify           | `@arcjet/fastify`                                         | Fastify ≥ 5                                          |
| NestJS            | `@arcjet/nest`                                            | `@nestjs/common` ^10 \|\| ^11                        |
| SvelteKit         | `@arcjet/sveltekit`                                       | Svelte ^3.54 \|\| ^4 \|\| ^5                         |
| Remix             | `@arcjet/remix`                                           | Remix v2 (v3 was renamed to React Router 7 – use `@arcjet/react-router`) |
| React Router      | `@arcjet/react-router`                                    | react-router ≥ 7                                     |
| Astro             | `@arcjet/astro`                                           | Astro ^5.9.3 \|\| ^6 \|\| ^7                         |
| Nuxt              | `@arcjet/nuxt`                                            | `@nuxt/kit` ≥ 4, `@nuxt/schema` ≥ 4                  |
| Bun               | `@arcjet/bun`                                             | Bun ≥ 1.3.0                                          |
| Deno              | `@arcjet/deno` (install with `deno add npm:@arcjet/deno`) | Deno `stable` / `lts`                                |
| Hono              | `@arcjet/node` (on Node) or `@arcjet/bun` (on Bun)        | runtime-dependent (see Node/Bun rows)                |

If the project is below a listed minimum, warn the user and stop – installing anyway produces confusing errors.

**Some frameworks don't fit the generic patterns.** Check [Framework-specific setup](#framework-specific-setup) first:

- **Astro, Nuxt, NestJS** – replace the "shared client file" pattern entirely (Astro integration / Nuxt module / NestJS DI).
- **Bun, Deno, Hono on Node** – use the shared client file, but with a runtime quirk (`aj.handler()` wrapping for Bun/Deno; `HttpBindings` type for Hono on Node).

Everything else (Next.js, Express/Node, Fastify, SvelteKit, Remix, React Router, Hono on Bun) follows the generic patterns directly.

## Architecture: why things go where they do

### Shared client file (standard pattern)

Create a **separate file** (for example `src/lib/arcjet.ts` or `lib/arcjet.ts`) that exports the Arcjet instance. Do not define the client inline in route handlers – it must be importable from any route.

Always include `shield({ mode: "LIVE" })` as a base rule, even when using combined rules like `protectSignup()`. Omitted `mode` is `DRY_RUN` (log only) – Shield does not enforce unless you pass `LIVE`. Shield helps against common attacks (SQLi, XSS) and costs nothing to add.

```typescript
// src/lib/arcjet.ts
import arcjet, { shield } from "@arcjet/next"; // or @arcjet/node, etc.

export const aj = arcjet({
  key: process.env.ARCJET_KEY!,
  rules: [shield({ mode: "LIVE" })],
});
```

On `main`, JS adapters default the Decide API timeout to 2000 ms – same as Guard, same in production and development. An explicit `timeout` on `createRemoteClient()` still wins.

### Use `withRule()` for per-route rules

Use `withRule()` to add route-specific rules without modifying the shared instance. Clones share the parent decision cache. Sibling `arcjet()` constructors do not – prefer `withRule()` for route extras. This keeps the base protection (`shield`) everywhere while layering additional rules per endpoint.

```typescript
import aj from "@/lib/arcjet";
import { slidingWindow } from "@arcjet/next";

const protect = aj.withRule(slidingWindow({ mode: "LIVE", interval: 60, max: 100 }));
```

### Call `protect()` in route handlers, not middleware

Call `protect()` inside each route handler, once per request. Don't call it in Express middleware (`app.use()`) or Next.js middleware – these run on every request including static assets, and you lose the ability to apply different rules to different routes.

## Framework-specific setup

Five frameworks don't fit the "shared client file" pattern. Use the following structure for the affected framework, then read the installed package's types and README for the full API.

### Astro

Astro registers Arcjet as a build-time **integration** in `astro.config.mjs`. The configured client is exposed as a virtual module – there is no `lib/arcjet.ts` file and no `withRule()`. Rules are global to the integration; per-route variation isn't supported.

If an existing config still has `detectPromptInjection({ threshold })`, drop `threshold`. `@arcjet/astro` validates with Zod `.strict()`, so leftover `threshold` throws at startup. Core adapters ignore leftover `threshold`; Astro does not.

```typescript
// astro.config.mjs
import arcjet, { shield } from "@arcjet/astro";
import { defineConfig } from "astro/config";

export default defineConfig({
  integrations: [arcjet({ rules: [shield({ mode: "LIVE" })] })],
});

// src/pages/api/hello.ts
import aj from "arcjet:client";
import type { APIRoute } from "astro";

export const GET: APIRoute = async ({ request }) => {
  const decision = await aj.protect(request);
  // ...
};
```

### Nuxt

Nuxt registers Arcjet as a Nuxt **module**. The key goes in `nuxt.config.ts`, not in the `arcjet()` call, and the SDK is imported from the auto-generated alias `#arcjet`. Each `arcjet()` call is its own client and cache – put a shared client in one server module and import it, rather than constructing a new client in every route file.

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ["@arcjet/nuxt"],
  arcjet: { key: process.env.ARCJET_KEY },
});

// server/routes/hello.get.ts
import arcjet, { shield } from "#arcjet";

const aj = arcjet({ rules: [shield({ mode: "LIVE" })] }); // no `key` – module provides it

export default defineEventHandler(async (event) => {
  const decision = await aj.protect(event);
  // ...
});
```

### NestJS

NestJS uses dependency injection. Register `ArcjetModule.forRoot()` in your app module, then inject the client in controllers with `@InjectArcjet()`.

```typescript
// app.module.ts
import { ArcjetModule, shield } from "@arcjet/nest";

@Module({
  imports: [
    ArcjetModule.forRoot({
      isGlobal: true,
      key: process.env.ARCJET_KEY!,
      rules: [shield({ mode: "LIVE" })],
    }),
  ],
})
export class AppModule {}

// app.controller.ts
import { ArcjetNest, InjectArcjet } from "@arcjet/nest";

@Controller()
export class AppController {
  constructor(@InjectArcjet() private readonly arcjet: ArcjetNest) {}

  @Get("/")
  async index(@Req() req: Request) {
    const decision = await this.arcjet.protect(req);
    // ...
  }
}
```

### Bun and Deno

Both expose `aj.handler()` to wrap the server's fetch handler. Wrapping is for accurate client IP detection – `protect()` still needs to be called inside.

```typescript
// Bun
import arcjet, { shield } from "@arcjet/bun";
import { env } from "bun";

const aj = arcjet({ key: env.ARCJET_KEY!, rules: [shield({ mode: "LIVE" })] });

Bun.serve({
  port: 3000,
  fetch: aj.handler(async (req) => {
    const decision = await aj.protect(req);
    // ...
    return new Response("ok");
  }),
});

// Deno
import arcjet, { shield } from "npm:@arcjet/deno";

const aj = arcjet({ key: Deno.env.get("ARCJET_KEY")!, rules: [shield({ mode: "LIVE" })] });

Deno.serve(aj.handler(async (request) => {
  const decision = await aj.protect(request);
  // ...
  return new Response("ok");
}));
```

On Deno, imports use the `npm:` prefix (`npm:@arcjet/deno`, `npm:@arcjet/inspect`). On Bun, env comes from `import { env } from "bun"` rather than `process.env`.

### Hono

Hono on **Bun** is straightforward – install `@arcjet/bun`, create the client per the standard pattern, and pass `c.req.raw` to `protect()`.

Hono on **Node.js** needs the type-bindings dance so the underlying `IncomingMessage` is reachable. Install `@arcjet/node` and type the app with `HttpBindings` from `@hono/node-server`:

```typescript
import arcjet, { shield } from "@arcjet/node";
import { serve, type HttpBindings } from "@hono/node-server";
import { Hono } from "hono";

const aj = arcjet({ key: process.env.ARCJET_KEY!, rules: [shield({ mode: "LIVE" })] });
const app = new Hono<{ Bindings: HttpBindings }>();

app.get("/", async (c) => {
  const decision = await aj.protect(c.env.incoming);
  // ...
});
```

Without the `Bindings` type, `c.env.incoming` won't typecheck.

## Choose rules

For rule selection and rate-limiting strategy comparisons, see [Choose protections](choosing_protections.md). Key framework-specific notes:

- **`shield`** – always include, and pass `mode: "LIVE"` to enforce. Omitted `mode` is `DRY_RUN`.
- **`detectBot`** – pass exactly one of `allow` or `deny`. Neither or both throws. Empty `allow: []` blocks every detected bot.
- **Rate limits** – use `characteristics: ["userId"]` to key by something other than IP.
- **`validateEmail`** – for signup/login forms.
- **`protectSignup`** – combined bot + email + rate limit, purpose-built for registration flows. One composite rule (unlike Python's tuple or Go's `[]Rule`).
- **`sensitiveInfo`** – blocks PII in request bodies. Default backend is WASM (card, email, phone, IP). For names, addresses, and government / financial identifiers, install `@arcjet/sensitive-info-rampart` and pass `backend: rampart()`.
- **`detectPromptInjection`** – for AI endpoints receiving user prompts. On `main` the only option is `mode`; do not pass `threshold`.
- **`filter`** – block by IP metadata (VPN, Tor, country, IP range).

## Framework-specific `protect()` calls

The request object to pass differs by framework:

| Framework                           | What to pass to `protect()`                                       |
| ----------------------------------- | ----------------------------------------------------------------- |
| Express / Node.js                   | `req` (IncomingMessage)                                           |
| Next.js App Router                  | `req` (Request)                                                   |
| Next.js Server Components / actions | `await request()` from `@arcjet/next`                             |
| Fastify                             | `request` (Fastify request, not raw Node)                         |
| NestJS                              | `req` (`@Req() req: Request`)                                     |
| SvelteKit                           | `event`                                                           |
| Remix / React Router                | `args` (the loader/action args)                                   |
| Nuxt                                | `event` (H3 event)                                                |
| Astro                               | `request` (the Web `Request`)                                     |
| Hono on Node.js                     | `c.env.incoming` (requires `Hono<{ Bindings: HttpBindings }>`)    |
| Hono on Bun                         | `c.req.raw`                                                       |
| Bun                                 | `request` (Web `Request`), wrap `fetch` with `aj.handler()`       |
| Deno                                | `request` (Web `Request`), wrap `Deno.serve` body with `aj.handler()` |

`aj.handler()` on Bun and Deno wraps the user's fetch handler so Arcjet has access to the underlying socket / connection info for accurate IP detection – Bun and Deno don't expose that on the `Request` object alone. The wrapping is for IP detection only; you still need to call `aj.protect(request)` yourself inside the handler.

## Decision handling

`decision.isDenied()` means a LIVE rule triggered a denial. Map denial reasons to HTTP status codes, but **only branch on reasons that produce a different response** – skip arms that would just return the same status as the default 403:

- `decision.reason.isRateLimit()` → 429
- `decision.reason.isEmail()` → 400
- `decision.reason.isSensitiveInfo()` → 400
- `decision.reason.isPromptInjection()` → 400 (`injectionDetected` is the binary verdict; there is no `score`)
- everything else (bot, shield, filter) → default 403

Writing an explicit `else if (reason.isShield())` arm that returns 403 just adds noise when the default already returns 403.

`decision.isErrored()` means something went wrong during rule evaluation but the SDK failed open. Log it and allow the request.

### Correlation IDs

Available from **`@arcjet/*` 1.6.0**: pass `correlationId` to `protect()` when the Arcjet decision must be correlated with another request, guard call, workflow run, or agent trace. It is a dedicated field, not `extra` or `metadata`, and it does not affect fingerprinting or the decision cache key.

```typescript
const decision = await aj.protect(request, {
  correlationId: requestId,
});
```

### Explicit client IP

Available from **`@arcjet/*` 1.10.0**: if the application has already determined the client IP from a trusted source, pass it as `ipSrc` on `protect()`. A non-empty value takes precedence over automatic detection, including the development-only `x-arcjet-ip` header. An empty string falls through to automatic detection.

```typescript
const decision = await aj.protect(request, {
  ipSrc: getClientIpFromTrustedSource(request),
});
```

The SDK trusts `ipSrc` without validating it. Do not pass a client-controlled header. Validate the value first.

### Metadata

Available from **`@arcjet/*` 1.10.0**: `protect()` accepts `metadata` – nested JSON, not a flat string map. It is attached to the decision for analytics and does not affect fingerprinting or the cache key. Do not put secrets or PII in it.

### IP threat intelligence

When present, `decision.ip.threat` is optional threat metadata (`riskLevel`, `confidence`, `reputation`, `isSafe`, `activities`, …). Older responses and IPs without an assessment omit it – always check before reading.

### Outbound HTTP proxy

Available from **`@arcjet/*` 1.6.0**: SDK transports honor standard `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` environment variables. Node.js proxy support depends on the Node runtime baseline in the installation table. Prefer env vars over custom code; do not log proxy URLs because they may include credentials. Advanced Node deployments can set `proxyHttpVersion: "2"` on lower-level transport options; most app integrations don't need it.

## Deprecations

As of `@arcjet/*` 1.6.0, the request-based SDK still carries a couple of deprecated bits. Don't use them in new code; migrate existing uses when convenient.

- **`experimental_detectPromptInjection`** – the legacy `experimental_` alias is deprecated. Import `detectPromptInjection` directly from `@arcjet/node` / `@arcjet/next` or the adapter in use.
- **`ArcjetEdgeRuleReason`** – unused; ignore it in reason-handling switches.

On `main` ([arcjet-js#6238](https://github.com/arcjet/arcjet-js/pull/6238)), `detectPromptInjection({ threshold })` and `PromptInjectionReason.score` are **removed**, not deprecated. Only `mode` remains. Do not pass `threshold` in new code, and drop it from existing configs when you see it – especially Astro, where leftover `threshold` throws (see [Astro](#astro)). Core adapters ignore leftover `threshold` (no throw, no effect on rule id). Don't read `score`; branch on `decision.reason.isPromptInjection()` / `injectionDetected`. Published `@arcjet/*` 1.10.0 still lists them as `@deprecated`.

> _Deprecations last verified against the `@arcjet/*` v1.10.0 release on **August 11, 2026**. `threshold` / `score` removal is on `main` ([arcjet-js#6238](https://github.com/arcjet/arcjet-js/pull/6238)). Before relying on these items, grep the installed package for `@deprecated` markers – see [`protocol/index.ts`](https://github.com/arcjet/arcjet-js/blob/main/protocol/index.ts) and [`arcjet/index.ts`](https://github.com/arcjet/arcjet-js/blob/main/arcjet/index.ts)._

## Key patterns

- Rules that need extra input at `protect()` time: `tokenBucket` needs `{ requested: N }`, `validateEmail`/`protectSignup` needs `{ email }`, `sensitiveInfo` needs `{ sensitiveInfoValue }`, `detectPromptInjection` needs `{ detectPromptInjectionMessage }`.
- Every rule accepts `mode: "LIVE" | "DRY_RUN"`. **Omitted `mode` is `DRY_RUN`** – the request is allowed and the match is logged. Pass `mode: "LIVE"` to enforce. Start with `DRY_RUN` to verify rules match expected traffic before enforcing.
- `detectBot` requires exactly one of `allow` or `deny`.
- For projects that already have an Arcjet client file, extend it with `withRule()` instead of constructing a second `arcjet()`. Clones share the decision cache; sibling constructors do not.
