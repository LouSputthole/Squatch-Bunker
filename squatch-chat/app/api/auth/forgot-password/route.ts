import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/rateLimit";

function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function POST(request: Request) {
  const rl = checkRateLimit(`forgot:${clientIp(request)}`);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
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
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json(
        { message: "If that email exists, a reset link has been sent." }
      );
    }

    const user = await prisma.user.findUnique({ where: { email } });

    if (user) {
      const token = crypto.randomUUID();
      const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

      await prisma.user.update({
        where: { id: user.id },
        data: {
          resetToken: token,
          resetExpiry: expiry,
        },
      });
    }

    return NextResponse.json({
      message: "If that email exists, a reset link has been sent.",
    });
  } catch (err) {
    console.error("[Campfire] Forgot password error:", err);
    return NextResponse.json(
      { message: "If that email exists, a reset link has been sent." }
    );
  }
}
