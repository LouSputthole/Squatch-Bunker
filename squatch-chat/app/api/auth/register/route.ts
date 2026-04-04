import { NextResponse } from "next/server";
import { hashPassword, createToken, setTokenCookie } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const { email, username, password } = await request.json();

    if (!email || !username || !password) {
      return NextResponse.json(
        { error: "Email, username, and password are required" },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters" },
        { status: 400 }
      );
    }

    const { prisma } = await import("@/lib/db");

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { username }] },
    });

    if (existing) {
      return NextResponse.json(
        { error: "Email or username already taken" },
        { status: 409 }
      );
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: { email, username, passwordHash },
    });

    const token = createToken({ userId: user.id, username: user.username });
    const response = NextResponse.json(
      { user: { id: user.id, username: user.username, email: user.email } },
      { status: 201 }
    );
    setTokenCookie(response, token);
    return response;
  } catch (err) {
    console.error("[SquatchChat] Register error:", err);
    return NextResponse.json(
      { error: "Database not available. Try continuing as a guest." },
      { status: 503 }
    );
  }
}
