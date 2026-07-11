import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { claimEvent, completeEvent } from "@/lib/webhook-idempotency";

// Route-level tests for the Stripe webhook: the HTTP status codes ARE the
// contract with Stripe's retry machinery (2xx stops retries, everything else
// keeps them coming), so each branch gets pinned here with the Stripe lib
// stubbed out.

const stripeMock = vi.hoisted(() => ({
  isStripeEnabled: vi.fn(() => true),
  constructWebhookEvent: vi.fn(),
  handleWebhookEvent: vi.fn(),
}));
vi.mock("@/lib/stripe", () => stripeMock);

import { POST } from "@/app/api/billing/webhook/route";

function post(body = "{}") {
  return POST(
    new Request("http://test.local/api/billing/webhook", {
      method: "POST",
      headers: { "stripe-signature": "sig" },
      body,
    }),
  );
}

const EVENT = { id: "evt_route", type: "checkout.session.completed", data: { object: {} } };

describe("billing webhook route", () => {
  beforeEach(async () => {
    await prisma.webhookEvent.deleteMany();
    stripeMock.isStripeEnabled.mockReturnValue(true);
    stripeMock.constructWebhookEvent.mockResolvedValue(EVENT);
    stripeMock.handleWebhookEvent.mockReset();
    stripeMock.handleWebhookEvent.mockResolvedValue(undefined);
  });

  it("missing signature → 400, handler never runs", async () => {
    const res = await POST(new Request("http://test.local/x", { method: "POST", body: "{}" }));
    expect(res.status).toBe(400);
    expect(stripeMock.handleWebhookEvent).not.toHaveBeenCalled();
  });

  it("success → 200 and the event is recorded done", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(stripeMock.handleWebhookEvent).toHaveBeenCalledOnce();
    const row = await prisma.webhookEvent.findUnique({ where: { id: EVENT.id } });
    expect(row?.status).toBe("done");
  });

  it("duplicate delivery → 200 with duplicate flag, handler NOT re-run", async () => {
    await claimEvent(EVENT.id);
    await completeEvent(EVENT.id);
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ duplicate: true });
    expect(stripeMock.handleWebhookEvent).not.toHaveBeenCalled();
  });

  it("concurrent delivery (fresh processing claim) → 409, handler NOT run", async () => {
    await claimEvent(EVENT.id);
    const res = await post();
    expect(res.status).toBe(409);
    expect(stripeMock.handleWebhookEvent).not.toHaveBeenCalled();
  });

  it("handler failure → 500 and the claim is released for Stripe's retry", async () => {
    stripeMock.handleWebhookEvent.mockRejectedValue(new Error("boom"));
    const res = await post();
    expect(res.status).toBe(500);
    // Claim released → the retry can claim and process it.
    expect(await claimEvent(EVENT.id)).toBe("claimed");
  });

  it("bad signature → 400", async () => {
    stripeMock.constructWebhookEvent.mockRejectedValue(new Error("bad sig"));
    const res = await post();
    expect(res.status).toBe(400);
    expect(stripeMock.handleWebhookEvent).not.toHaveBeenCalled();
  });
});
