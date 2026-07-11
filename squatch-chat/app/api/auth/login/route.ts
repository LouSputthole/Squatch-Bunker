import { NextResponse } from "next/server";
import { verifyPassword, createToken, setTokenCookie } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rateLimit";

function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function POST(request: Request) {
  const { allowed, remaining, resetAt } = checkRateLimit(`login:${clientIp(request)}`);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many login attempts. Please try again later." },
      {
        status: 429,
        headers: {
          "X-RateLimit-Remaining": String(remaining),
          "X-RateLimit-Reset": String(Math.ceil(resetAt / 1000)),
          "Retry-After": String(Math.ceil((resetAt - Date.now()) / 1000)),
        },
      }
    );
  }

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

    const token = createToken({ userId: user.id, username: user.username, tokenVersion: user.tokenVersion });
    const response = NextResponse.json({
      user: { id: user.id, username: user.username, email: user.email },
    });
    setTokenCookie(response, token);
    return response;
  } catch (err) {
    console.error("[Campfire] Login error:", err);
    return NextResponse.json(
      { error: "Database not available. Try continuing as a guest." },
      { status: 503 }
    );
  }
}
