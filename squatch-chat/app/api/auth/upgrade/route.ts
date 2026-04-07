import { NextResponse } from "next/server";
import { getSession, hashPassword, createToken, setTokenCookie } from "@/lib/auth";

// POST — upgrade a guest account to a real account
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { email, username, password } = await request.json();

  if (!email?.trim() || !username?.trim() || !password) {
    return NextResponse.json({ error: "Email, username, and password required" }, { status: 400 });
  }

  if (password.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
  }

  try {
    const { prisma } = await import("@/lib/db");

    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
    if (!user.isGuest) return NextResponse.json({ error: "Account is not a guest" }, { status: 400 });

    // Check for conflicts
    const emailTaken = await prisma.user.findUnique({ where: { email: email.trim() } });
    if (emailTaken && emailTaken.id !== user.id) {
      return NextResponse.json({ error: "Email already in use" }, { status: 409 });
    }

    const usernameTaken = await prisma.user.findUnique({ where: { username: username.trim() } });
    if (usernameTaken && usernameTaken.id !== user.id) {
      return NextResponse.json({ error: "Username already taken" }, { status: 409 });
    }

    const passwordHash = await hashPassword(password);

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        email: email.trim(),
        username: username.trim(),
        passwordHash,
        isGuest: false,
        guestExpiresAt: null,
      },
    });

    // Issue new token with updated username
    const token = createToken({ userId: updated.id, username: updated.username });
    const response = NextResponse.json({
      user: { id: updated.id, username: updated.username, email: updated.email, isGuest: false },
    });
    setTokenCookie(response, token);
    return response;
  } catch (err) {
    console.error("[Campfire] Guest upgrade error:", err);
    return NextResponse.json({ error: "Database error" }, { status: 503 });
  }
}
