import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "campfire-secret-change-me";
const COOKIE_NAME = process.env.COOKIE_NAME || "squatch-token";

export async function POST(request: Request) {
  try {
    const { username } = await request.json();

    if (!username || !username.trim()) {
      return NextResponse.json(
        { error: "Username is required" },
        { status: 400 }
      );
    }

    const cleanUsername = username.trim();

    if (cleanUsername.length < 2 || cleanUsername.length > 24) {
      return NextResponse.json(
        { error: "Username must be 2-24 characters" },
        { status: 400 }
      );
    }

    // Generate a unique guest ID
    const guestId = Math.random().toString(36).slice(2, 10);
    const guestUsername = `${cleanUsername}#${guestId}`;
    const guestUserId = `guest-${crypto.randomUUID()}`;

    // Try to persist the guest in the database if available
    let persistedUser = null;
    try {
      const { prisma } = await import("@/lib/db");
      const bcrypt = await import("bcryptjs");
      const guestEmail = `guest-${guestId}@campfire.local`;
      const passwordHash = await bcrypt.hash(crypto.randomUUID(), 10);

      persistedUser = await prisma.user.create({
        data: {
          email: guestEmail,
          username: guestUsername,
          passwordHash,
          isGuest: true,
          guestExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
    } catch (dbErr) {
      console.log("[Campfire] Guest DB fallback:", dbErr instanceof Error ? dbErr.message : dbErr);
    }

    const userId = persistedUser?.id || guestUserId;
    const token = jwt.sign({ userId, username: guestUsername }, JWT_SECRET, { expiresIn: "7d" });

    const isProduction = process.env.NODE_ENV === "production";
    const secure = isProduction ? " Secure;" : "";
    const sameSite = isProduction ? "None" : "Lax";
    const cookieFlags = `Path=/; HttpOnly; SameSite=${sameSite};${secure} Max-Age=${60 * 60 * 24 * 7}`;

    const response = NextResponse.json(
      {
        user: {
          id: userId,
          username: guestUsername,
          email: null,
          isGuest: true,
        },
      },
      { status: 201 }
    );
    response.headers.append("Set-Cookie", `${COOKIE_NAME}=${token}; ${cookieFlags}`);
    return response;
  } catch (err) {
    console.error("[Campfire] Guest auth error:", err);
    return NextResponse.json(
      { error: "Failed to create guest session" },
      { status: 500 }
    );
  }
}
