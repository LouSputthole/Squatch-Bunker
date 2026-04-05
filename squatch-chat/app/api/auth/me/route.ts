import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Try to fetch from database first
    try {
      const { prisma } = await import("@/lib/db");
      const user = await prisma.user.findUnique({
        where: { id: session.userId },
        select: { id: true, username: true, email: true, avatar: true },
      });

      if (user) {
        return NextResponse.json({ user });
      }
    } catch {
      // Database not available — fall through to JWT-based response
    }

    // Guest or DB-unavailable: return session data from JWT
    return NextResponse.json({
      user: {
        id: session.userId,
        username: session.username,
        email: null,
        isGuest: session.userId.startsWith("guest-"),
      },
    });
  } catch (err) {
    console.error("[Campfire] Auth/me error:", err);
    return NextResponse.json({ error: "Auth check failed" }, { status: 500 });
  }
}
