import { prisma } from "@/lib/db";
import { resolveChannelAccess } from "@/lib/channelAccess";
import {
  createChannelMessageNotifications,
  type NotificationRecord,
} from "@/lib/notifications";

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
  /** Mention notifications created for delivered messages, for realtime push. */
  notifications: NotificationRecord[];
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

  const result: ScheduledDeliveryResult = {
    delivered: [],
    dropped: [],
    failed: [],
    notifications: [],
  };

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
        const channel = await tx.channel.findUnique({
          where: { id: scheduled.channelId },
          select: { name: true },
        });
        return {
          kind: "delivered" as const,
          message,
          serverId: access.serverId,
          channelName: channel?.name ?? "channel",
        };
      });

      if (outcome?.kind === "dropped") result.dropped.push(outcome.id);
      if (outcome?.kind === "delivered") {
        result.delivered.push(outcome.message);
        // Same mention fan-out a live message gets. The message is already
        // committed, so a notification failure must not mark it failed.
        try {
          result.notifications.push(...await createChannelMessageNotifications({
            messageId: outcome.message.id,
            channelId: outcome.message.channelId,
            channelName: outcome.channelName,
            serverId: outcome.serverId,
            authorId: outcome.message.authorId,
            authorUsername: outcome.message.author.username,
            content: outcome.message.content,
          }));
        } catch (error) {
          console.error("[Campfire] Scheduled message notifications failed:", outcome.message.id, error);
        }
      }
    } catch (error) {
      console.error("[Campfire] Failed to deliver scheduled message:", candidate.id, error);
      result.failed.push(candidate.id);
    }
  }

  return result;
}
