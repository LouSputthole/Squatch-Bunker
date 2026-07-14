import { NextResponse } from "next/server";
import { hashPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/rateLimit";
import { hashPasswordResetToken } from "@/lib/passwordReset";
import { passwordValidationError } from "@/lib/accountCredentials";
import { notifyRealtimeAuthorizationChange } from "@/lib/realtimeControl";
import { clientIp } from "@/lib/clientIp";


export async function POST(request: Request) {
  const rl = checkRateLimit(`reset:${clientIp(request)}`);
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
    const { token, password } = await request.json();

    if (typeof token !== "string" || typeof password !== "string" || !token || !password) {
      return NextResponse.json(
        { error: "Token and password are required" },
        { status: 400 }
      );
    }

    const passwordError = passwordValidationError(password);
    if (passwordError) {
      return NextResponse.json(
        { error: passwordError },
        { status: 400 },
      );
    }

    if (token.length > 512) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 400 },
      );
    }

    const user = await prisma.user.findFirst({
      where: {
        resetToken: hashPasswordResetToken(token),
        resetExpiry: { gt: new Date() },
      },
      select: { id: true },
    });

    if (!user) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 400 }
      );
    }

    const passwordHash = await hashPassword(password);

    const consumed = await prisma.user.updateMany({
      where: {
        id: user.id,
        resetToken: hashPasswordResetToken(token),
        resetExpiry: { gt: new Date() },
      },
      data: {
        passwordHash,
        resetToken: null,
        resetExpiry: null,
        // Invalidate any existing JWTs issued before the password reset
        tokenVersion: { increment: 1 },
      },
    });

    if (!consumed.count) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 400 },
      );
    }

    await notifyRealtimeAuthorizationChange({
      scope: "session",
      userId: user.id,
    });

    return NextResponse.json({ message: "Password updated successfully" });
  } catch (err) {
    console.error("[Campfire] Reset password error:", err);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
