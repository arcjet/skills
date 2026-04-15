import aj from "@/lib/arcjet";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const decision = await aj.protect(req);

  if (decision.isDenied()) {
    if (decision.reason.isRateLimit()) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429 }
      );
    }
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403 }
    );
  }

  const { email, password } = await req.json();
  // TODO: create user account
  return NextResponse.json({ success: true });
}
