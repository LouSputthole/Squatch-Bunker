import { NextResponse } from "next/server";
import { verifyPassword, createToken, setTokenCookie } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rateLimit";
import { clientIp } from "@/lib/clientIp";

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
    const body: unknown = await request.json().catch(() => null);
    const { email, password } = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

    if (typeof email !== "string" || !email.trim() || typeof password !== "string" || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    // Register and forgot-password store/look up trim().toLowerCase(); fall
    // back to the entered form for accounts created before normalization.
    const enteredEmail = email.trim();
    const normalizedEmail = enteredEmail.toLowerCase();
    const { prisma } = await import("@/lib/db");
    const user = (await prisma.user.findUnique({ where: { email: normalizedEmail } }))
      ?? (enteredEmail !== normalizedEmail
        ? await prisma.user.findUnique({ where: { email: enteredEmail } })
        : null);

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
