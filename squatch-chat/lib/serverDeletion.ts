import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  removeUnreferencedPrivateUpload,
  removeUnreferencedUpload,
} from "@/lib/messageRetention";
import { notifyRealtimeAuthorizationChange } from "@/lib/realtimeControl";

/**
 * Delete a camp with everything in it: channels, messages, Journal entries,
 * emoji, audit log, memberships, and the files nothing else uses. Used by the
 * owner (DELETE /api/servers/:id) and the instance operator
 * (lib/instanceModeration.ts), who passes `alsoInTransaction` to record the
 * action atomically. Callers authorize. Returns false if the camp is gone.
 */
export async function deleteServerWithContent(
  serverId: string,
  alsoInTransaction?: (tx: Prisma.TransactionClient) => Promise<unknown>,
): Promise<boolean> {
  const deleted = await prisma.$transaction(async (tx) => {
    const serverMedia = await tx.server.findUnique({
      where: { id: serverId },
      select: { icon: true, banner: true },
    });
    if (!serverMedia) return null;
    const channels = await tx.channel.findMany({
      where: { serverId },
      select: { id: true },
    });
    const channelIds = channels.map((c) => c.id);
    const messages = channelIds.length
      ? await tx.message.findMany({
          where: { channelId: { in: channelIds } },
          select: { attachmentUrl: true, privateUploadId: true },
        })
      : [];
    const journalEntries = await tx.journalEntry.findMany({
      where: { serverId },
      select: { attachmentUrl: true, privateUploadId: true },
    });
    const customEmojis = await tx.customEmoji.findMany({
      where: { serverId },
      select: { url: true },
    });

    await tx.notificationPreference.deleteMany({
      where: {
        OR: [
          { serverId },
          { channelId: { in: channelIds } },
        ],
      },
    });
    if (channelIds.length > 0) {
      await tx.reaction.deleteMany({
        where: { message: { channelId: { in: channelIds } } },
      });
      // ScheduledMessage and Webhook FK channels but have no onDelete cascade,
      // so they must be removed before their channels.
      await tx.scheduledMessage.deleteMany({ where: { channelId: { in: channelIds } } });
      await tx.webhook.deleteMany({ where: { channelId: { in: channelIds } } });
      await tx.message.deleteMany({ where: { channelId: { in: channelIds } } });
      await tx.channel.deleteMany({ where: { serverId } });
    }

    // Server-scoped records without an onDelete cascade: remove explicitly or
    // they FK-block the server delete (Postgres) / orphan it (SQLite).
    await tx.customEmoji.deleteMany({ where: { serverId } });
    await tx.auditLog.deleteMany({ where: { serverId } });

    await tx.serverMember.deleteMany({ where: { serverId } });
    await tx.server.delete({ where: { id: serverId } });
    await alsoInTransaction?.(tx);

    return {
      channelIds,
      attachmentUrls: [
        ...new Set(
          [
            ...messages.map((message) => message.attachmentUrl),
            ...journalEntries.map((entry) => entry.attachmentUrl),
            serverMedia.icon,
            serverMedia.banner,
            ...customEmojis.map((emoji) => emoji.url),
          ].filter(
            (url): url is string => Boolean(url),
          ),
        ),
      ],
      privateUploadIds: [
        ...new Set(
          [...messages, ...journalEntries]
            .map((record) => record.privateUploadId)
            .filter((id): id is string => Boolean(id)),
        ),
      ],
    };
  });
  if (!deleted) return false;

  const sideEffects = await Promise.allSettled([
    ...deleted.channelIds.map((channelId) =>
      notifyRealtimeAuthorizationChange({ scope: "channel", channelId }),
    ),
    notifyRealtimeAuthorizationChange({ scope: "server", serverId }),
    ...deleted.attachmentUrls.map(removeUnreferencedUpload),
    ...deleted.privateUploadIds.map(removeUnreferencedPrivateUpload),
  ]);
  for (const result of sideEffects) {
    if (result.status === "rejected") {
      console.error("[Campfire] Post-delete server cleanup failed:", result.reason);
    }
  }
  return true;
}
