import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createCheckoutSession, isStripeEnabled, PRICE_IDS } from "@/lib/stripe";

const CHECKOUT_CLAIM_MS = 15 * 60 * 1000;
const ACTIVE_SUBSCRIPTION_STATES = new Set([
  "active",
  "trialing",
  "pending",
  "incomplete",
  "past_due",
]);

export async function POST(request: Request) {
  if (!isStripeEnabled()) {
    return NextResponse.json({ error: "Billing is not configured for this edition" }, { status: 404 });
  }

  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let plan: "monthly" | "yearly";
  try {
    const body = await request.json();
    if (body?.plan !== "monthly" && body?.plan !== "yearly") {
      return NextResponse.json({ error: "plan must be monthly or yearly" }, { status: 400 });
    }
    plan = body.plan;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const priceId = PRICE_IDS[plan];
  if (!priceId) return NextResponse.json({ error: "Price not configured" }, { status: 503 });

  const { prisma } = await import("@/lib/db");
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      email: true,
      tier: true,
      isGuest: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      subscriptionStatus: true,
    },
  });

  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
  if (user.isGuest) {
    return NextResponse.json({ error: "Create a permanent account before subscribing" }, { status: 403 });
  }
  if (
    user.tier === "premium"
    || !!user.stripeSubscriptionId
    || ACTIVE_SUBSCRIPTION_STATES.has(user.subscriptionStatus ?? "")
  ) {
    return NextResponse.json({ error: "A subscription already exists; use Manage billing" }, { status: 409 });
  }

  const now = new Date();
  const staleBefore = new Date(now.getTime() - CHECKOUT_CLAIM_MS);
  const claim = await prisma.user.updateMany({
    where: {
      id: session.userId,
      OR: [
        { billingCheckoutPendingAt: null },
        { billingCheckoutPendingAt: { lte: staleBefore } },
      ],
    },
    data: { billingCheckoutPendingAt: now },
  });
  if (!claim.count) {
    return NextResponse.json({ error: "Checkout is already being created" }, { status: 409 });
  }

  try {
    const checkout = await createCheckoutSession(session.userId, user.email, priceId, {
      customerId: user.stripeCustomerId,
      idempotencyKey: `campfire:${session.userId}:${plan}:${Math.floor(now.getTime() / CHECKOUT_CLAIM_MS)}`,
    });
    if (!checkout?.url) throw new Error("Stripe did not return a checkout URL");
    return NextResponse.json({ url: checkout.url });
  } catch (error) {
    await prisma.user.updateMany({
      where: { id: session.userId, billingCheckoutPendingAt: now },
      data: { billingCheckoutPendingAt: null },
    });
    console.error("[Campfire] Checkout error:", error);
    return NextResponse.json({ error: "Billing checkout could not be created" }, { status: 502 });
  }
}
