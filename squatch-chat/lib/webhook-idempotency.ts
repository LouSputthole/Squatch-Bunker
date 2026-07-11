import { prisma } from "@/lib/db";

/**
 * DB-backed idempotency for webhook deliveries (survives restarts and works
 * across multiple nodes, unlike the old in-process Set).
 *
 * Protocol: claimEvent() inserts a "processing" row keyed by the event id —
 * the primary-key constraint makes exactly one concurrent delivery win.
 * After the handler succeeds, completeEvent() flips it to "done"; if the
 * handler fails, releaseEvent() deletes the claim so the sender's retry can
 * reprocess. A "processing" claim older than STALE_CLAIM_MS is treated as a
 * crashed worker and taken over.
 */
const STALE_CLAIM_MS = 5 * 60 * 1000;

export type ClaimResult = "claimed" | "duplicate" | "in-flight";

export async function claimEvent(eventId: string): Promise<ClaimResult> {
  try {
    await prisma.webhookEvent.create({ data: { id: eventId } });
    return "claimed";
  } catch (err: unknown) {
    // P2002 = unique violation → someone already claimed this event id.
    if ((err as { code?: string })?.code !== "P2002") throw err;
  }

  const existing = await prisma.webhookEvent.findUnique({ where: { id: eventId } });
  if (!existing) {
    // Claim vanished between insert-conflict and read: a failed handler just
    // released it. Tell the sender to retry rather than racing to re-claim.
    return "in-flight";
  }
  if (existing.status === "done") return "duplicate";
  if (Date.now() - existing.updatedAt.getTime() < STALE_CLAIM_MS) return "in-flight";

  // Stale "processing" claim — the worker died mid-handler. Take it over,
  // gated on the exact stale row we just observed so two concurrent takeovers
  // can't both win.
  const takeover = await prisma.webhookEvent.updateMany({
    where: { id: eventId, status: "processing", updatedAt: existing.updatedAt },
    data: { updatedAt: new Date() },
  });
  return takeover.count === 1 ? "claimed" : "in-flight";
}

export async function completeEvent(eventId: string): Promise<void> {
  await prisma.webhookEvent.update({ where: { id: eventId }, data: { status: "done" } });
}

export async function releaseEvent(eventId: string): Promise<void> {
  try {
    await prisma.webhookEvent.delete({ where: { id: eventId } });
  } catch {
    // Already gone — nothing to release.
  }
}
