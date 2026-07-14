import { NextResponse } from "next/server";
import { hashPassword, createToken, setTokenCookie } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rateLimit";
import { parseAccountCredentials } from "@/lib/accountCredentials";
import { clientIp } from "@/lib/clientIp";

export async function POST(request: Request) {
  const { allowed, remaining, resetAt } = checkRateLimit(`register:${clientIp(request)}`);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again later." },
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = parseAccountCredentials(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { email, username, password } = parsed.value;

  try {
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
    const code = err && typeof err === "object" && "code" in err ? err.code : null;
    if (code === "P2002") {
      return NextResponse.json({ error: "Email or username already taken" }, { status: 409 });
    }
    console.error("[Campfire] Register error:", err);
    return NextResponse.json(
      { error: "Database not available. Try continuing as a guest." },
      { status: 503 }
    );
  }
}
