import { NextResponse } from "next/server";
import { hashPassword, createToken, setTokenCookie } from "@/lib/auth";
import { parseAccountCredentials } from "@/lib/accountCredentials";

class SetupAlreadyCompleteError extends Error {}

export async function GET() {
  try {
    const { prisma } = await import("@/lib/db");
    const userCount = await prisma.user.count();
    return NextResponse.json({ needsSetup: userCount === 0 });
  } catch (error) {
    console.error("[Campfire] Setup status error:", error);
    return NextResponse.json(
      { needsSetup: false, error: "Database unavailable" },
      { status: 503 },
    );
  }
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = parseAccountCredentials(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { username, email, password } = parsed.value;

  try {
    const { prisma } = await import("@/lib/db");
    const passwordHash = await hashPassword(password);
    const user = await prisma.$transaction(
      async (tx) => {
        if (await tx.user.count()) {
          throw new SetupAlreadyCompleteError();
        }
        return tx.user.create({
          data: { username, email, passwordHash },
        });
      },
      { isolationLevel: "Serializable" },
    );

    const token = createToken({ userId: user.id, username: user.username });
    const response = NextResponse.json({ success: true, userId: user.id });
    setTokenCookie(response, token);
    return response;
  } catch (err: unknown) {
    if (err instanceof SetupAlreadyCompleteError) {
      return NextResponse.json({ error: "Setup already complete" }, { status: 409 });
    }
    const prismaErr = err as { code?: string };
    if (prismaErr?.code === "P2002") {
      return NextResponse.json({ error: "Username or email already taken" }, { status: 409 });
    }
    if (prismaErr?.code === "P2034") {
      return NextResponse.json({ error: "Setup is already being completed" }, { status: 409 });
    }
    console.error("[Campfire] Setup error:", err);
    return NextResponse.json({ error: "Setup failed" }, { status: 500 });
  }
}
