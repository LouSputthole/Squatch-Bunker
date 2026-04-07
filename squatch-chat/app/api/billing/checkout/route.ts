import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createCheckoutSession, isStripeEnabled, PRICE_IDS } from "@/lib/stripe";

export async function POST(request: Request) {
  if (!isStripeEnabled()) {
    return NextResponse.json({ error: "Billing not available (self-hosted mode)" }, { status: 404 });
  }

  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { plan } = await request.json();
  const priceId = plan === "yearly" ? PRICE_IDS.yearly : PRICE_IDS.monthly;

  if (!priceId) {
    return NextResponse.json({ error: "Price not configured" }, { status: 500 });
  }

  try {
    const { prisma } = await import("@/lib/db");
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { email: true, tier: true },
    });

    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
    if (user.tier === "premium") {
      return NextResponse.json({ error: "Already premium" }, { status: 409 });
    }

    const checkoutSession = await createCheckoutSession(session.userId, user.email, priceId);
    if (!checkoutSession) {
      return NextResponse.json({ error: "Failed to create checkout" }, { status: 500 });
    }

    return NextResponse.json({ url: checkoutSession.url });
  } catch (err) {
    console.error("[Campfire] Checkout error:", err);
    return NextResponse.json({ error: "Billing error" }, { status: 500 });
  }
}
