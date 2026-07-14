import { prisma } from "@/lib/db";
import { resolveChannelAccess } from "@/lib/channelAccess";

export interface DeliveredScheduledMessage {
  id: string;
  channelId: string;
  authorId: string;
  content: string;
  attachmentUrl: string | null;
  attachmentName: string | null;
  replyToId: string | null;
  parentMessageId: string | null;
  pinned: boolean;
  isSystem: boolean;
  editedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  author: { id: string; username: string; avatar: string | null };
}

export interface ScheduledDeliveryResult {
  delivered: DeliveredScheduledMessage[];
  dropped: string[];
  failed: string[];
}

/**
 * Claim and deliver due messages atomically. The sent flag and Message insert
 * share one transaction, so an insert failure rolls the claim back and a later
 * pass can retry it. updateMany is the compare-and-set that prevents two
 * workers from publishing the same scheduled message.
 */
export async function deliverDueMessages(
  limit = 100,
  now = new Date(),
): Promise<ScheduledDeliveryResult> {
  const candidates = await prisma.scheduledMessage.findMany({
    where: { sent: false, sendAt: { lte: now } },
    select: { id: true },
    orderBy: { sendAt: "asc" },
    take: Math.max(1, Math.min(limit, 100)),
  });

  const result: ScheduledDeliveryResult = { delivered: [], dropped: [], failed: [] };

  for (const candidate of candidates) {
    try {
      const outcome = await prisma.$transaction(async (tx) => {
        const scheduled = await tx.scheduledMessage.findUnique({ where: { id: candidate.id } });
        if (!scheduled || scheduled.sent || scheduled.sendAt > now) return null;

        const claim = await tx.scheduledMessage.updateMany({
          where: { id: scheduled.id, sent: false },
          data: { sent: true },
        });
        if (claim.count === 0) return null;

        // Access can change between scheduling and delivery. Re-evaluate it
        // inside the same transaction that owns the claim and message insert.
        const access = await resolveChannelAccess(
          scheduled.channelId,
          scheduled.authorId,
          tx,
        );
        if (!access?.canSend) {
          await tx.scheduledMessage.delete({ where: { id: scheduled.id } });
          return { kind: "dropped" as const, id: scheduled.id };
        }

        const message = await tx.message.create({
          data: {
            channelId: scheduled.channelId,
            authorId: scheduled.authorId,
            content: scheduled.content,
          },
          include: { author: { select: { id: true, username: true, avatar: true } } },
        });
        return { kind: "delivered" as const, message };
      });

      if (outcome?.kind === "delivered") result.delivered.push(outcome.message);
      if (outcome?.kind === "dropped") result.dropped.push(outcome.id);
    } catch (error) {
      console.error("[Campfire] Failed to deliver scheduled message:", candidate.id, error);
      result.failed.push(candidate.id);
    }
  }

  return result;
}
