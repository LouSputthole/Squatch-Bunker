import { NextResponse } from "next/server";
import { createToken, setTokenCookie } from "@/lib/auth";
import crypto from "crypto";

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

    // Generate a unique guest ID — no database needed
    const guestId = crypto.randomBytes(4).toString("hex");
    const guestUsername = `${cleanUsername}#${guestId}`;
    const guestUserId = `guest-${crypto.randomUUID()}`;

    // Try to persist the guest in the database if available
    let persistedUser = null;
    try {
      const { prisma } = await import("@/lib/db");
      const { hashPassword } = await import("@/lib/auth");
      const guestEmail = `guest-${guestId}@campfire.local`;
      const guestPassword = crypto.randomBytes(16).toString("hex");
      const passwordHash = await hashPassword(guestPassword);

      persistedUser = await prisma.user.create({
        data: {
          email: guestEmail,
          username: guestUsername,
          passwordHash,
          isGuest: true,
          guestExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
    } catch {
      // Database not available — that's fine, guest still gets a session
      console.log("[Campfire] Database not available, creating guest session without persistence");
    }

    const userId = persistedUser?.id || guestUserId;
    const token = createToken({ userId, username: guestUsername });

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
    setTokenCookie(response, token);
    return response;
  } catch (err) {
    console.error("[Campfire] Guest auth error:", err);
    return NextResponse.json(
      { error: "Failed to create guest session" },
      { status: 500 }
    );
  }
}
