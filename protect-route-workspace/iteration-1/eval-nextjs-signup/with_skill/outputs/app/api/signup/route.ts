import aj, { validateEmail, slidingWindow } from "@/lib/arcjet";

const protectedAj = aj
  .withRule(
    validateEmail({
      mode: "LIVE",
      deny: ["DISPOSABLE", "INVALID", "NO_MX_RECORDS"],
    }),
  )
  .withRule(
    slidingWindow({
      mode: "LIVE",
      interval: 60,
      max: 5,
    }),
  );

export async function POST(req: Request) {
  const { email, password } = await req.json();

  const decision = await protectedAj.protect(req, { email });

  if (decision.isDenied()) {
    if (decision.reason.isRateLimit()) {
      return Response.json(
        { error: "Too many requests" },
        { status: 429 },
      );
    }
    if (decision.reason.isEmail()) {
      return Response.json(
        { error: "Invalid email" },
        { status: 400 },
      );
    }
    if (decision.reason.isBot() || decision.reason.isShield() || decision.reason.isFilterRule()) {
      return Response.json(
        { error: "Forbidden" },
        { status: 403 },
      );
    }
    return Response.json(
      { error: "Forbidden" },
      { status: 403 },
    );
  }

  if (decision.isErrored()) {
    console.warn("Arcjet error:", decision.reason.message);
  }

  // TODO: create user account
  return Response.json({ success: true });
}
