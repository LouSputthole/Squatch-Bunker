import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";

const authMock = vi.hoisted(() => ({ getSession: vi.fn() }));
const stripeMock = vi.hoisted(() => ({
  isStripeEnabled: vi.fn(),
  createCheckoutSession: vi.fn(),
  PRICE_IDS: {
    monthly: "price_checkout_monthly",
    yearly: "price_checkout_yearly",
  },
}));

vi.mock("@/lib/auth", () => authMock);
vi.mock("@/lib/stripe", () => stripeMock);

import { POST } from "@/app/api/billing/checkout/route";

let userId: string;
let guestId: string;

function checkout(body: string) {
  return POST(
    new Request("http://test.local/api/billing/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    }),
  );
}

function checkoutPlan(plan: unknown) {
  return checkout(JSON.stringify({ plan }));
}

beforeAll(async () => {
  const [user, guest] = await Promise.all([
    prisma.user.create({
      data: {
        email: "billing-checkout-user@t.local",
        username: "billing_checkout_user",
        passwordHash: "x",
      },
    }),
    prisma.user.create({
      data: {
        email: "billing-checkout-guest@t.local",
        username: "billing_checkout_guest",
        passwordHash: "x",
        isGuest: true,
        guestExpiresAt: new Date(Date.now() + 60_000),
      },
    }),
  ]);
  userId = user.id;
  guestId = guest.id;
});

beforeEach(async () => {
  stripeMock.isStripeEnabled.mockReset();
  stripeMock.isStripeEnabled.mockReturnValue(true);
  stripeMock.createCheckoutSession.mockReset();
  stripeMock.createCheckoutSession.mockResolvedValue({
    url: "https://checkout.stripe.test/session",
  });
  authMock.getSession.mockReset();
  authMock.getSession.mockResolvedValue({
    userId,
    username: "billing_checkout_user",
  });

  await prisma.user.update({
    where: { id: userId },
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
  await prisma.user.update({
    where: { id: guestId },
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

describe("POST /api/billing/checkout", () => {
  it("is unavailable unless Cloud billing is fully configured", async () => {
    stripeMock.isStripeEnabled.mockReturnValue(false);
    expect((await checkoutPlan("monthly")).status).toBe(404);
    expect(authMock.getSession).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    authMock.getSession.mockResolvedValue(null);
    expect((await checkoutPlan("monthly")).status).toBe(401);
    expect(stripeMock.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON and unknown plans", async () => {
    expect((await checkout("{")).status).toBe(400);
    expect((await checkoutPlan("weekly")).status).toBe(400);
    expect((await checkoutPlan(null)).status).toBe(400);
    expect(stripeMock.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("requires guests to create a permanent account", async () => {
    authMock.getSession.mockResolvedValue({
      userId: guestId,
      username: "billing_checkout_guest",
    });
    expect((await checkoutPlan("monthly")).status).toBe(403);
    expect(stripeMock.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("rejects users who already have premium or subscription state", async () => {
    await prisma.user.update({
      where: { id: userId },
      data: {
        stripeSubscriptionId: "sub_existing_checkout",
        subscriptionStatus: "active",
      },
    });
    expect((await checkoutPlan("yearly")).status).toBe(409);
    expect(stripeMock.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("rejects a second checkout while a recent claim is pending", async () => {
    await prisma.user.update({
      where: { id: userId },
      data: { billingCheckoutPendingAt: new Date() },
    });
    expect((await checkoutPlan("monthly")).status).toBe(409);
    expect(stripeMock.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("reuses an existing Stripe customer and creates an idempotent claim", async () => {
    await prisma.user.update({
      where: { id: userId },
      data: { stripeCustomerId: "cus_reused_checkout" },
    });

    const response = await checkoutPlan("yearly");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      url: "https://checkout.stripe.test/session",
    });
    expect(stripeMock.createCheckoutSession).toHaveBeenCalledWith(
      userId,
      "billing-checkout-user@t.local",
      "price_checkout_yearly",
      expect.objectContaining({
        customerId: "cus_reused_checkout",
        idempotencyKey: expect.stringMatching(
          new RegExp(`^campfire:${userId}:yearly:\\d+$`),
        ),
      }),
    );
    expect(
      (
        await prisma.user.findUniqueOrThrow({
          where: { id: userId },
          select: { billingCheckoutPendingAt: true },
        })
      ).billingCheckoutPendingAt,
    ).not.toBeNull();
  });

  it("allows a stale checkout claim to be reclaimed", async () => {
    await prisma.user.update({
      where: { id: userId },
      data: {
        billingCheckoutPendingAt: new Date(Date.now() - 16 * 60 * 1_000),
      },
    });
    expect((await checkoutPlan("monthly")).status).toBe(200);
    expect(stripeMock.createCheckoutSession).toHaveBeenCalledOnce();
  });

  it("clears its exact claim when Stripe session creation fails", async () => {
    stripeMock.createCheckoutSession.mockRejectedValue(
      new Error("Stripe unavailable"),
    );
    expect((await checkoutPlan("monthly")).status).toBe(502);
    await expect(
      prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { billingCheckoutPendingAt: true },
      }),
    ).resolves.toMatchObject({ billingCheckoutPendingAt: null });
  });
});
