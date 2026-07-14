import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import type {
  BillingEvent,
  SubscriptionShape,
} from "@/lib/stripe";

let handleWebhookEvent: typeof import("@/lib/stripe").handleWebhookEvent;
let normalUserId: string;
let guestUserId: string;

const APPROVED_PRICE = "price_test_monthly";
const PERIOD_END = 2_100_000_000;

function subscription(
  userId: string,
  overrides: Partial<SubscriptionShape> = {},
): SubscriptionShape {
  return {
    id: "sub_test",
    customer: "cus_test",
    status: "active",
    metadata: { userId },
    items: {
      data: [
        {
          price: { id: APPROVED_PRICE },
          current_period_end: PERIOD_END,
        },
      ],
    },
    ...overrides,
  };
}

function event(
  type: string,
  object: unknown,
  created = 2_000_000_000,
): BillingEvent {
  return {
    id: `evt_${type}_${created}`,
    created,
    type,
    data: { object },
  };
}

beforeAll(async () => {
  process.env.CAMPFIRE_EDITION = "cloud";
  process.env.SELF_HOSTED = "false";
  process.env.STRIPE_SECRET_KEY = "sk_test_billing_state";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_billing_state";
  process.env.STRIPE_PRICE_MONTHLY = APPROVED_PRICE;
  process.env.STRIPE_PRICE_YEARLY = "price_test_yearly";

  ({ handleWebhookEvent } = await import("@/lib/stripe"));

  const [normalUser, guestUser] = await Promise.all([
    prisma.user.create({
      data: {
        email: "billing-state-user@t.local",
        username: "billing_state_user",
        passwordHash: "x",
      },
    }),
    prisma.user.create({
      data: {
        email: "billing-state-guest@t.local",
        username: "billing_state_guest",
        passwordHash: "x",
        isGuest: true,
        guestExpiresAt: new Date(Date.now() + 60_000),
      },
    }),
  ]);
  normalUserId = normalUser.id;
  guestUserId = guestUser.id;
});

beforeEach(async () => {
  await prisma.user.updateMany({
    where: { id: { in: [normalUserId, guestUserId] } },
    data: {
      tier: "free",
      tierExpiresAt: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      subscriptionStatus: null,
      billingCheckoutPendingAt: null,
      billingEventAt: null,
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Stripe subscription entitlement reconciliation", () => {
  it("links checkout objects without granting premium access", async () => {
    await prisma.user.update({
      where: { id: normalUserId },
      data: { billingCheckoutPendingAt: new Date() },
    });

    await handleWebhookEvent(
      event("checkout.session.completed", {
        mode: "subscription",
        client_reference_id: normalUserId,
        customer: "cus_checkout",
        subscription: "sub_checkout",
      }),
    );

    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: normalUserId } }),
    ).resolves.toMatchObject({
      tier: "free",
      tierExpiresAt: null,
      stripeCustomerId: "cus_checkout",
      stripeSubscriptionId: "sub_checkout",
      billingCheckoutPendingAt: null,
    });
  });

  it("does not let a stale checkout relink a different subscription", async () => {
    await prisma.user.update({
      where: { id: normalUserId },
      data: {
        stripeCustomerId: "cus_current",
        stripeSubscriptionId: "sub_current",
        subscriptionStatus: "active",
      },
    });

    await handleWebhookEvent(
      event("checkout.session.completed", {
        mode: "subscription",
        client_reference_id: normalUserId,
        customer: "cus_old",
        subscription: "sub_old",
      }),
    );

    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: normalUserId } }),
    ).resolves.toMatchObject({
      stripeCustomerId: "cus_current",
      stripeSubscriptionId: "sub_current",
    });
  });

  it("grants an approved active subscription using Stripe v22 item expiry", async () => {
    await handleWebhookEvent(
      event(
        "customer.subscription.created",
        subscription(normalUserId, { current_period_end: undefined }),
      ),
    );

    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: normalUserId } }),
    ).resolves.toMatchObject({
      tier: "premium",
      subscriptionStatus: "active",
      stripeSubscriptionId: "sub_test",
      stripeCustomerId: "cus_test",
      tierExpiresAt: new Date(PERIOD_END * 1_000),
      billingEventAt: new Date(2_000_000_000 * 1_000),
    });
  });

  it("never grants an unapproved Stripe price", async () => {
    await handleWebhookEvent(
      event(
        "customer.subscription.updated",
        subscription(normalUserId, {
          id: "sub_wrong_price",
          items: {
            data: [
              {
                price: { id: "price_attacker_controlled" },
                current_period_end: PERIOD_END,
              },
            ],
          },
        }),
      ),
    );

    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: normalUserId } }),
    ).resolves.toMatchObject({
      tier: "free",
      tierExpiresAt: null,
      subscriptionStatus: "unrecognized_price",
    });
  });

  it("ignores older events and applies newer cancellation events", async () => {
    const active = subscription(normalUserId, { id: "sub_ordered" });
    await handleWebhookEvent(
      event("customer.subscription.updated", active, 2_000_000_000),
    );
    await handleWebhookEvent(
      event("customer.subscription.deleted", active, 1_999_999_999),
    );

    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: normalUserId } }),
    ).resolves.toMatchObject({ tier: "premium", subscriptionStatus: "active" });

    await handleWebhookEvent(
      event("customer.subscription.deleted", active, 2_000_000_001),
    );
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: normalUserId } }),
    ).resolves.toMatchObject({
      tier: "free",
      tierExpiresAt: null,
      subscriptionStatus: "canceled",
    });
  });

  it("reconciles invoice payment events from the current subscription", async () => {
    const loadSubscription = vi.fn().mockResolvedValue(
      subscription(normalUserId, { id: "sub_invoice" }),
    );

    await handleWebhookEvent(
      event("invoice.paid", {
        parent: {
          subscription_details: { subscription: "sub_invoice" },
        },
      }),
      { retrieveSubscription: loadSubscription },
    );

    expect(loadSubscription).toHaveBeenCalledWith("sub_invoice");
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: normalUserId } }),
    ).resolves.toMatchObject({
      tier: "premium",
      stripeSubscriptionId: "sub_invoice",
    });

    await handleWebhookEvent(
      event(
        "invoice.payment_failed",
        { subscription: "sub_invoice" },
        2_000_000_001,
      ),
      { retrieveSubscription: loadSubscription },
    );
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: normalUserId } }),
    ).resolves.toMatchObject({
      tier: "free",
      tierExpiresAt: null,
      subscriptionStatus: "past_due",
    });
  });

  it("does not grant or link entitlements to expiring guest accounts", async () => {
    await handleWebhookEvent(
      event("customer.subscription.created", subscription(guestUserId)),
    );
    await handleWebhookEvent(
      event("checkout.session.completed", {
        mode: "subscription",
        client_reference_id: guestUserId,
        customer: "cus_guest",
        subscription: "sub_guest",
      }),
    );

    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: guestUserId } }),
    ).resolves.toMatchObject({
      tier: "free",
      tierExpiresAt: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    });
  });

  it("safely ignores events whose user no longer exists", async () => {
    await expect(
      handleWebhookEvent(
        event(
          "customer.subscription.updated",
          subscription("missing-user-id", { id: "sub_missing" }),
        ),
      ),
    ).resolves.toBeUndefined();
  });
});
