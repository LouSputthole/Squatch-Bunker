import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { claimEvent, completeEvent, releaseEvent } from "@/lib/webhook-idempotency";

// Integration tests for the DB-backed webhook idempotency claim protocol —
// this is what stops a replayed Stripe delivery from granting/revoking
// premium twice across restarts and nodes.

describe("webhook idempotency", () => {
  beforeEach(async () => {
    await prisma.webhookEvent.deleteMany();
  });

  it("first claim wins; in-flight claims block; completed events are duplicates", async () => {
    expect(await claimEvent("evt_1")).toBe("claimed");
    expect(await claimEvent("evt_1")).toBe("in-flight");
    await completeEvent("evt_1");
    expect(await claimEvent("evt_1")).toBe("duplicate");
  });

  it("released events can be re-claimed (handler-failure retry path)", async () => {
    await claimEvent("evt_2");
    await releaseEvent("evt_2");
    expect(await claimEvent("evt_2")).toBe("claimed");
  });

  it("releasing a never-claimed event is a no-op", async () => {
    await expect(releaseEvent("evt_never")).resolves.toBeUndefined();
  });

  it("stale processing claims are taken over (crashed worker)", async () => {
    await claimEvent("evt_3");
    await prisma.webhookEvent.update({
      where: { id: "evt_3" },
      data: { updatedAt: new Date(Date.now() - 6 * 60 * 1000) },
    });
    expect(await claimEvent("evt_3")).toBe("claimed");
  });

  it("concurrent claims of the same event: exactly one wins", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => claimEvent("evt_4")));
    expect(results.filter((r) => r === "claimed")).toHaveLength(1);
    expect(results.filter((r) => r === "in-flight")).toHaveLength(4);
  });
});
