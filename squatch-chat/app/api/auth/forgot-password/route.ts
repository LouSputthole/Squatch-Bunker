import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/rateLimit";
import { sendPasswordResetEmail } from "@/lib/email";
import { createPasswordResetToken } from "@/lib/passwordReset";
import { MAX_EMAIL_LENGTH } from "@/lib/accountCredentials";
import { clientIp } from "@/lib/clientIp";

const GENERIC_RESPONSE = {
  message: "If that email exists, a reset link has been sent.",
};

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
    const body: unknown = await request.json();
    const email = body && typeof body === "object" && "email" in body
      ? body.email
      : null;
    if (typeof email !== "string" || !email.trim()) {
      return NextResponse.json(GENERIC_RESPONSE);
    }

    const enteredEmail = email.trim();
    if (enteredEmail.length > MAX_EMAIL_LENGTH) {
      return NextResponse.json(GENERIC_RESPONSE);
    }
    const normalizedEmail = enteredEmail.toLowerCase();
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: enteredEmail },
          ...(normalizedEmail === enteredEmail ? [] : [{ email: normalizedEmail }]),
        ],
      },
    });

    if (user && !user.isGuest) {
      const reset = createPasswordResetToken();
      await prisma.user.update({
        where: { id: user.id },
        data: {
          resetToken: reset.digest,
          resetExpiry: reset.expiresAt,
        },
      });
      try {
        const delivery = await sendPasswordResetEmail({
          to: user.email,
          username: user.username,
          token: reset.token,
        });
        if (!delivery.delivered) {
          throw new Error("Password reset email is not configured");
        }
      } catch (deliveryError) {
        await prisma.user.updateMany({
          where: { id: user.id, resetToken: reset.digest },
          data: { resetToken: null, resetExpiry: null },
        });
        console.error("[Campfire] Password reset delivery failed:", deliveryError);
      }
    }

    return NextResponse.json(GENERIC_RESPONSE);
  } catch (err) {
    console.error("[Campfire] Forgot password error:", err);
    return NextResponse.json(
      GENERIC_RESPONSE
    );
  }
}
