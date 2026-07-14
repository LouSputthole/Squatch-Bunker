import Stripe from "stripe";
import { billingConfiguration } from "@/lib/edition";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export const PRICE_IDS = {
  monthly: process.env.STRIPE_PRICE_MONTHLY || "",
  yearly: process.env.STRIPE_PRICE_YEARLY || "",
};

export function isStripeEnabled(): boolean {
  return billingConfiguration().enabled;
}

let stripeClient: Stripe | null = null;

function getStripe(): Stripe | null {
  if (!isStripeEnabled() || !STRIPE_SECRET_KEY) return null;
  stripeClient ??= new Stripe(STRIPE_SECRET_KEY);
  return stripeClient;
}

export async function createCheckoutSession(
  userId: string,
  email: string,
  priceId: string,
  options: { customerId?: string | null; idempotencyKey: string },
) {
  const stripe = getStripe();
  if (!stripe) return null;
  if (!Object.values(PRICE_IDS).includes(priceId)) throw new Error("Unknown Stripe price");

  return stripe.checkout.sessions.create({
    mode: "subscription",
    payment_method_types: ["card"],
    ...(options.customerId ? { customer: options.customerId } : { customer_email: email }),
    client_reference_id: userId,
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: { userId },
    subscription_data: { metadata: { userId } },
    success_url: `${APP_URL}/billing?upgraded=true`,
    cancel_url: `${APP_URL}/billing?upgraded=false`,
  }, {
    idempotencyKey: options.idempotencyKey,
  });
}

export async function createPortalSession(customerId: string) {
  const stripe = getStripe();
  if (!stripe) return null;
  return stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${APP_URL}/billing`,
  });
}

export async function constructWebhookEvent(body: string, signature: string) {
  const stripe = getStripe();
  if (!stripe || !STRIPE_WEBHOOK_SECRET) return null;
  return stripe.webhooks.constructEvent(body, signature, STRIPE_WEBHOOK_SECRET);
}

export interface BillingEvent {
  id?: string;
  created?: number;
  type: string;
  data: { object: unknown };
}

export interface SubscriptionItemShape {
  current_period_end?: number;
  price?: { id?: string };
  plan?: { id?: string };
}

export interface SubscriptionShape {
  id?: string;
  customer?: string | { id?: string };
  status?: string;
  current_period_end?: number;
  items?: { data?: SubscriptionItemShape[] };
  metadata?: { userId?: string };
}

interface InvoiceShape {
  subscription?: unknown;
  parent?: {
    subscription_details?: {
      subscription?: unknown;
      metadata?: { userId?: string };
    };
  };
}

function objectId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value && typeof value.id === "string") return value.id;
  return null;
}

function eventDate(event: BillingEvent): Date {
  return event.created ? new Date(event.created * 1000) : new Date();
}

function periodEnd(subscription: SubscriptionShape): Date | null {
  const itemEnds = subscription.items?.data
    ?.map((item) => item.current_period_end)
    .filter((value): value is number => typeof value === "number") ?? [];
  const seconds = itemEnds.length ? Math.max(...itemEnds) : subscription.current_period_end;
  return seconds ? new Date(seconds * 1000) : null;
}

export function subscriptionHasApprovedPrice(subscription: SubscriptionShape): boolean {
  const approved = new Set(Object.values(PRICE_IDS).filter(Boolean));
  if (!approved.size) return false;
  return subscription.items?.data?.some((item) => {
    const id = item.price?.id ?? item.plan?.id;
    return !!id && approved.has(id);
  }) ?? false;
}

async function findSubscriptionUser(subscription: SubscriptionShape) {
  const { prisma } = await import("@/lib/db");
  const metadataUserId = subscription.metadata?.userId;
  if (metadataUserId) {
    const user = await prisma.user.findUnique({ where: { id: metadataUserId } });
    if (user) return user;
  }
  if (!subscription.id) return null;
  return prisma.user.findUnique({ where: { stripeSubscriptionId: subscription.id } });
}

async function applySubscriptionState(
  subscription: SubscriptionShape,
  occurredAt: Date,
  forcedStatus: string | null = null,
) {
  const { prisma } = await import("@/lib/db");
  if (!subscription.id) return;
  const user = await findSubscriptionUser(subscription);
  if (!user) return;
  if (user.isGuest) return;

  const expiry = periodEnd(subscription);
  const approvedPrice = subscriptionHasApprovedPrice(subscription);
  const activeStatus = subscription.status === "active" || subscription.status === "trialing";
  const entitled = !forcedStatus && activeStatus && approvedPrice && !!expiry;
  const status = approvedPrice
    ? (forcedStatus ?? subscription.status ?? "unknown")
    : "unrecognized_price";

  await prisma.user.updateMany({
    where: {
      id: user.id,
      OR: [
        { billingEventAt: null },
        { billingEventAt: { lte: occurredAt } },
      ],
    },
    data: {
      stripeSubscriptionId: subscription.id,
      stripeCustomerId: objectId(subscription.customer) ?? user.stripeCustomerId,
      subscriptionStatus: status,
      tier: entitled ? "premium" : "free",
      tierExpiresAt: entitled ? expiry : null,
      billingCheckoutPendingAt: null,
      billingEventAt: occurredAt,
    },
  });
}

function invoiceSubscriptionId(invoice: InvoiceShape): string | null {
  return objectId(invoice.subscription)
    ?? objectId(invoice.parent?.subscription_details?.subscription);
}

async function retrieveSubscription(subscriptionId: string): Promise<SubscriptionShape> {
  const stripe = getStripe();
  if (!stripe) throw new Error("Stripe is unavailable during invoice reconciliation");
  return stripe.subscriptions.retrieve(subscriptionId) as unknown as Promise<SubscriptionShape>;
}

export interface HandleWebhookOptions {
  retrieveSubscription?: (subscriptionId: string) => Promise<SubscriptionShape>;
}

export async function handleWebhookEvent(
  event: BillingEvent,
  options: HandleWebhookOptions = {},
) {
  const { prisma } = await import("@/lib/db");
  const occurredAt = eventDate(event);

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as {
        mode?: string;
        client_reference_id?: string;
        metadata?: { userId?: string };
        customer?: unknown;
        subscription?: unknown;
      };
      if (session.mode && session.mode !== "subscription") break;
      const userId = session.client_reference_id ?? session.metadata?.userId;
      const customerId = objectId(session.customer);
      const subscriptionId = objectId(session.subscription);
      if (!userId || !customerId || !subscriptionId) break;
      // Link objects only. Subscription events are authoritative for access.
      await prisma.user.updateMany({
        where: {
          id: userId,
          isGuest: false,
          OR: [
            { stripeSubscriptionId: null },
            { stripeSubscriptionId: subscriptionId },
          ],
        },
        data: {
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          billingCheckoutPendingAt: null,
        },
      });
      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
      await applySubscriptionState(event.data.object as SubscriptionShape, occurredAt);
      break;

    case "customer.subscription.deleted":
      await applySubscriptionState(
        { ...(event.data.object as SubscriptionShape), status: "canceled" },
        occurredAt,
        "canceled",
      );
      break;

    case "invoice.paid":
    case "invoice.payment_failed": {
      const subscriptionId = invoiceSubscriptionId(event.data.object as InvoiceShape);
      if (!subscriptionId) break;
      const loadSubscription = options.retrieveSubscription ?? retrieveSubscription;
      const subscription = await loadSubscription(subscriptionId);
      await applySubscriptionState(
        subscription,
        occurredAt,
        event.type === "invoice.payment_failed" ? "past_due" : null,
      );
      break;
    }
  }
}
