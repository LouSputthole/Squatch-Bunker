// Campfire Stripe Integration
// Gracefully no-ops when STRIPE_SECRET_KEY is not set (self-hosted mode)

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export const PRICE_IDS = {
  monthly: process.env.STRIPE_PRICE_MONTHLY || "",
  yearly: process.env.STRIPE_PRICE_YEARLY || "",
};

export function isStripeEnabled(): boolean {
  return !!STRIPE_SECRET_KEY;
}

async function getStripe() {
  if (!STRIPE_SECRET_KEY) return null;
  const Stripe = (await import("stripe")).default;
  return new Stripe(STRIPE_SECRET_KEY);
}

export async function createCheckoutSession(userId: string, email: string, priceId: string) {
  const stripe = await getStripe();
  if (!stripe) return null;

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    payment_method_types: ["card"],
    customer_email: email,
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: { userId },
    success_url: `${APP_URL}/chat?upgraded=true`,
    cancel_url: `${APP_URL}/chat?upgraded=false`,
  });

  return session;
}

export async function createPortalSession(customerId: string) {
  const stripe = await getStripe();
  if (!stripe) return null;

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${APP_URL}/chat`,
  });

  return session;
}

export async function constructWebhookEvent(body: string, signature: string) {
  if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) return null;
  const stripe = await getStripe();
  if (!stripe) return null;

  return stripe.webhooks.constructEvent(body, signature, STRIPE_WEBHOOK_SECRET);
}

export async function handleWebhookEvent(event: { type: string; data: { object: Record<string, unknown> } }) {
  const { prisma } = await import("@/lib/db");

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as { metadata?: { userId?: string }; customer?: string; subscription?: string };
      const userId = session.metadata?.userId;
      if (!userId) break;

      await prisma.user.update({
        where: { id: userId },
        data: {
          tier: "premium",
          stripeCustomerId: session.customer as string,
          stripeSubscriptionId: session.subscription as string,
          subscriptionStatus: "active",
        },
      });
      break;
    }

    case "customer.subscription.updated": {
      const sub = event.data.object as { id?: string; status?: string; current_period_end?: number };
      if (!sub.id) break;

      const user = await prisma.user.findFirst({
        where: { stripeSubscriptionId: sub.id },
      });
      if (!user) break;

      const isActive = sub.status === "active" || sub.status === "trialing";
      await prisma.user.update({
        where: { id: user.id },
        data: {
          subscriptionStatus: sub.status,
          tier: isActive ? "premium" : "free",
          tierExpiresAt: sub.current_period_end ? new Date(sub.current_period_end * 1000) : null,
        },
      });
      break;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as { id?: string };
      if (!sub.id) break;

      const user = await prisma.user.findFirst({
        where: { stripeSubscriptionId: sub.id },
      });
      if (!user) break;

      await prisma.user.update({
        where: { id: user.id },
        data: {
          tier: "free",
          subscriptionStatus: "canceled",
          stripeSubscriptionId: null,
        },
      });
      break;
    }
  }
}
