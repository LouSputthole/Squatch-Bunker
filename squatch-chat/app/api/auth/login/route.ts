import { NextResponse } from "next/server";
import { verifyPassword, createToken, setTokenCookie } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    const { prisma } = await import("@/lib/db");
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    const token = createToken({ userId: user.id, username: user.username });
    const response = NextResponse.json({
      user: { id: user.id, username: user.username, email: user.email },
    });
    setTokenCookie(response, token);
    return response;
  } catch (err) {
    console.error("[SquatchChat] Login error:", err);
    return NextResponse.json(
      { error: "Database not available. Try continuing as a guest." },
      { status: 503 }
    );
  }
}
