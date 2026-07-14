import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { config } from "@/lib/config";
import { checkRateLimit } from "@/lib/rateLimit";
import { clientIp } from "@/lib/clientIp";
import { betaAccessAllowed } from "@/lib/betaAccess";

const JWT_SECRET = config.jwtSecret;
const COOKIE_NAME = config.cookieName;

export async function POST(request: Request) {
  const rl = checkRateLimit(`guest:${clientIp(request)}`);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again later." },
      {
        status: 429,
        headers: {
          "X-RateLimit-Remaining": String(rl.remaining),
          "X-RateLimit-Reset": String(Math.ceil(rl.resetAt / 1000)),
          "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)),
        },
      }
    );
  }

  try {
    const parsedBody: unknown = await request.json();
    const body = typeof parsedBody === "object" && parsedBody !== null
      ? parsedBody as Record<string, unknown>
      : {};
    const username = body.username;

    if (!betaAccessAllowed(body.betaAccessCode)) {
      return NextResponse.json(
        { error: "Access denied" },
        { status: 403 },
      );
    }

    if (typeof username !== "string" || !username.trim()) {
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
    // Every authenticated guest must map to a revocable database record.
    // Fail closed instead of issuing a phantom identity when persistence fails.
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
      const errorCode =
        typeof dbErr === "object" && dbErr !== null && "code" in dbErr
          ? String((dbErr as { code?: unknown }).code ?? "")
          : "";
      console.error(
        `[Campfire] Guest database persistence failed${errorCode ? ` (${errorCode})` : ""}.`,
      );
      return NextResponse.json(
        { error: "Guest sessions are temporarily unavailable" },
        { status: 503 },
      );
    }

    const userId = persistedUser.id;
    const token = jwt.sign({ userId, username: guestUsername }, JWT_SECRET, { expiresIn: "7d" });

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
    response.headers.append("Set-Cookie", `${COOKIE_NAME}=${token}; ${config.cookieFlags}`);
    return response;
  } catch (err) {
    console.error("[Campfire] Guest auth error:", err);
    return NextResponse.json(
      { error: "Failed to create guest session" },
      { status: 500 }
    );
  }
}
