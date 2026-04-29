import { db } from "@/lib/db";
import { hash } from "bcrypt";

export async function POST(req: Request) {
  const { email, password, name } = await req.json();

  // Basic validation
  if (!email || !password) {
    return Response.json(
      { error: "Email and password are required" },
      { status: 400 },
    );
  }

  // Check if user exists
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return Response.json(
      { error: "User already exists" },
      { status: 409 },
    );
  }

  // Create user
  const hashedPassword = await hash(password, 12);
  const user = await db.user.create({
    data: { email, name, password: hashedPassword },
  });

  return Response.json(
    { id: user.id, email: user.email },
    { status: 201 },
  );
}
