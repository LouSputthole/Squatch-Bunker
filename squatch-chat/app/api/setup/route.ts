import { NextResponse } from "next/server";
import { hashPassword, createToken, setTokenCookie } from "@/lib/auth";

export async function GET() {
  try {
    const { prisma } = await import("@/lib/db");
    const userCount = await prisma.user.count();
    return NextResponse.json({ needsSetup: userCount === 0 });
  } catch {
    return NextResponse.json({ needsSetup: true });
  }
}

export async function POST(req: Request) {
  try {
    const { prisma } = await import("@/lib/db");
    const userCount = await prisma.user.count();
    if (userCount > 0) {
      return NextResponse.json({ error: "Setup already complete" }, { status: 400 });
    }

    const { username, email, password } = await req.json();
    if (!username?.trim() || !email?.trim() || !password?.trim()) {
      return NextResponse.json({ error: "All fields required" }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }

    const passwordHash = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        username: username.trim(),
        email: email.trim().toLowerCase(),
        passwordHash,
      },
    });

    const token = createToken({ userId: user.id, username: user.username });
    const response = NextResponse.json({ success: true, userId: user.id });
    setTokenCookie(response, token);
    return response;
  } catch (err: unknown) {
    const prismaErr = err as { code?: string };
    if (prismaErr?.code === "P2002") {
      return NextResponse.json({ error: "Username or email already taken" }, { status: 400 });
    }
    console.error("[Campfire] Setup error:", err);
    return NextResponse.json({ error: "Setup failed" }, { status: 500 });
  }
}
