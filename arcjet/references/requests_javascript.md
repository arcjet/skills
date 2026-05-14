# JavaScript/TypeScript Request Protection Reference

## Packages

| Framework                | Package                | Install                                |
| ------------------------ | ---------------------- | -------------------------------------- |
| Next.js                  | `@arcjet/next`         | `npm i @arcjet/next`                   |
| Node.js / Express / Hono | `@arcjet/node`        | `npm i @arcjet/node`                   |
| Fastify                  | `@arcjet/fastify`      | `npm i @arcjet/fastify`                |
| NestJS                   | `@arcjet/nest`         | `npm i @arcjet/nest`                   |
| SvelteKit                | `@arcjet/sveltekit`    | `npm i @arcjet/sveltekit`              |
| Remix                    | `@arcjet/remix`        | `npm i @arcjet/remix`                  |
| React Router             | `@arcjet/react-router` | `npm i @arcjet/react-router`           |
| Bun                      | `@arcjet/bun`          | `bun add @arcjet/bun`                  |
| Deno                     | `@arcjet/deno`         | `deno add npm:@arcjet/deno`            |
| Astro                    | `@arcjet/astro`        | `npx astro add @arcjet/astro`          |

## Create the Client

```typescript
import arcjet, { shield } from "@arcjet/next"; // or @arcjet/node, etc.

const aj = arcjet({
  key: process.env.ARCJET_KEY!,
  rules: [shield({ mode: "LIVE" })],
});
```

Create once at module scope. Export for reuse across routes with `withRule()`.

## Rules

Every rule accepts `mode: "LIVE" | "DRY_RUN"`.

### shield(options)

Protects against common attacks (SQLi, XSS).

```typescript
shield({ mode: "LIVE" })
```

### detectBot(options)

```typescript
detectBot({
  mode: "LIVE",
  allow: ["CATEGORY:SEARCH_ENGINE", "CATEGORY:MONITOR"], // or deny: [...]
})
```

`allow` and `deny` are mutually exclusive. Bot list: https://arcjet.com/bot-list

### tokenBucket(options)

Best for AI cost control with variable token consumption.

```typescript
tokenBucket({
  mode: "LIVE",
  characteristics: ["userId"], // optional, defaults to IP
  refillRate: 2_000,
  interval: "1h",    // seconds (number) or string: "1s", "1m", "1h", "1d"
  capacity: 5_000,
})
// At protect() time: aj.protect(req, { requested: 50 })
```

### fixedWindow(options)

Hard cap per time window, resets at window boundary.

```typescript
fixedWindow({
  mode: "LIVE",
  window: "60s",  // string: "1s", "10s", "1m", "1h", "1d"
  max: 100,
})
```

### slidingWindow(options)

Smooth rate limiting without burst-at-boundary issues.

```typescript
slidingWindow({
  mode: "LIVE",
  interval: 60,  // seconds (number)
  max: 100,
})
```

### validateEmail(options)

For signup forms.

```typescript
validateEmail({
  mode: "LIVE",
  deny: ["DISPOSABLE", "NO_MX_RECORDS", "INVALID"],
})
// At protect() time: aj.protect(req, { email: "user@example.com" })
```

Valid types: `DISPOSABLE`, `FREE`, `NO_MX_RECORDS`, `NO_GRAVATAR`, `INVALID`

### protectSignup(options)

Combined bot + email + rate limit for signup forms.

```typescript
protectSignup({
  email: { mode: "LIVE", deny: ["DISPOSABLE", "INVALID", "NO_MX_RECORDS"] },
  bots: { mode: "LIVE", allow: [] },
  rateLimit: { mode: "LIVE", interval: 600, max: 5 },
})
// At protect() time: aj.protect(req, { email: "user@example.com" })
```

### sensitiveInfo(options)

```typescript
sensitiveInfo({
  mode: "LIVE",
  deny: ["CREDIT_CARD_NUMBER", "EMAIL", "PHONE_NUMBER"],
})
// At protect() time: aj.protect(req, { sensitiveInfoValue: "text to scan" })
```

### detectPromptInjection(options)

```typescript
detectPromptInjection({ mode: "LIVE" })
// At protect() time: aj.protect(req, { detectPromptInjectionMessage: userMessage })
```

### filter(options)

```typescript
filter({
  mode: "LIVE",
  deny: ["ip.src.vpn", "ip.src.tor"],
})
```

## withRule() Pattern

```typescript
// lib/arcjet.ts — shared base instance
import arcjet, { shield } from "@arcjet/next";
export default arcjet({
  key: process.env.ARCJET_KEY!,
  rules: [shield({ mode: "LIVE" })],
});

// app/api/endpoint/route.ts — add route-specific rules
import aj from "@/lib/arcjet";
import { detectBot, slidingWindow } from "@arcjet/next";

const protect = aj
  .withRule(detectBot({ mode: "LIVE", allow: [] }))
  .withRule(slidingWindow({ mode: "LIVE", interval: 60, max: 100 }));

export async function GET(req: Request) {
  const decision = await protect.protect(req);
  // ...
}
```

## Calling protect()

Call inside the route handler, once per request. Pass the framework's request object.

For Next.js server components / pages: `import { request } from "@arcjet/next"` then `const req = await request()`.

**Express:**
```typescript
app.get("/api/data", async (req, res) => {
  const decision = await aj.protect(req);
  if (decision.isDenied()) {
    if (decision.reason.isRateLimit()) return res.status(429).json({ error: "Too many requests" });
    return res.status(403).json({ error: "Forbidden" });
  }
  // ...
});
```

**Fastify:** pass `request` (Fastify request, not Node.js IncomingMessage).
**SvelteKit:** pass `event`.
**Remix / React Router:** pass `args`.
**Hono on Node.js:** pass `c.env.incoming`.
**Hono on Bun:** pass `c.req.raw`.
**Bun / Deno:** wrap fetch with `aj.handler()`.

## Decision API

```typescript
decision.isDenied()     // any LIVE rule triggered DENY
decision.isAllowed()    // all rules passed
decision.isErrored()    // error evaluating (Arcjet fails open)

if (decision.isDenied()) {
  decision.reason.isRateLimit()       // 429
  decision.reason.isBot()             // 403
  decision.reason.isShield()          // 403
  decision.reason.isEmail()           // 400
  decision.reason.isSensitiveInfo()   // 400
  decision.reason.isPromptInjection() // 400
  decision.reason.isFilterRule()      // 403
}

if (decision.isErrored()) {
  console.warn("Arcjet error:", decision.reason.message);
  // Fail open — allow the request
}
```
