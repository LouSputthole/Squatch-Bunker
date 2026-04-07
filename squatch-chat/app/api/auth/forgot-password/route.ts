import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
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
