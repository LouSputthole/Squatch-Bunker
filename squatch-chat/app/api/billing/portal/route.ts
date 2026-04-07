import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createPortalSession, isStripeEnabled } from "@/lib/stripe";

export async function POST() {
  if (!isStripeEnabled()) {
    return NextResponse.json({ error: "Billing not available" }, { status: 404 });
  }

  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { prisma } = await import("@/lib/db");
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { stripeCustomerId: true },
    });

    if (!user?.stripeCustomerId) {
      return NextResponse.json({ error: "No billing account" }, { status: 404 });
    }

    const portalSession = await createPortalSession(user.stripeCustomerId);
    if (!portalSession) {
      return NextResponse.json({ error: "Failed to create portal" }, { status: 500 });
    }

    return NextResponse.json({ url: portalSession.url });
  } catch (err) {
    console.error("[Campfire] Portal error:", err);
    return NextResponse.json({ error: "Billing error" }, { status: 500 });
  }
}
