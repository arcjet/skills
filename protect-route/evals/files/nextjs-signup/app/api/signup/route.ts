export async function POST(req: Request) {
  const { email, password } = await req.json();
  // TODO: create user account
  return Response.json({ success: true });
}
