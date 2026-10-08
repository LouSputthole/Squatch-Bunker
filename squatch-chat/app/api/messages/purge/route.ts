import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { resolveChannelAccess } from "@/lib/channelAccess";
import {
  cleanupDeletedMessageUploads,
  collectThreadReplies,
  type DeletableMessage,
} from "@/lib/messageRetention";
import { memberHasPermission } from "@/lib/serverRoles";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { channelId, count, userId: filterUserId } = await req.json();
  if (!channelId) return NextResponse.json({ error: "channelId required" }, { status: 400 });

  const deleteCount = Math.min(Math.max(parseInt(count) || 10, 1), 100);

  try {
    const { prisma } = await import("@/lib/db");

    // Get channel's server
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { serverId: true },
    });
    if (!channel) return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    const access = await resolveChannelAccess(channelId, session.userId);
    if (!access?.canView) {
      return NextResponse.json({ error: "Mod access required" }, { status: 403 });
    }


    if (!(await memberHasPermission(access.serverId, session.userId, "MANAGE_MESSAGES"))) {
      return NextResponse.json({ error: "Mod access required" }, { status: 403 });
    }

    const where: { channelId: string; authorId?: string } = { channelId };
    if (filterUserId) where.authorId = filterUserId;

    const deletion = await prisma.$transaction(async (tx) => {
      const messages = await tx.message.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: deleteCount,
        select: { id: true, attachmentUrl: true, privateUploadId: true },
      });

      if (messages.length === 0) {
        return { deleted: 0, messages: [] as DeletableMessage[] };
      }

      // Purged thread parents take their replies with them; otherwise the
      // replies would surface in the main timeline (thread FK is SET NULL).
      const replies = await collectThreadReplies(tx, messages.map((message) => message.id));
      const doomed = [...messages, ...replies];
      const messageIds = doomed.map((message) => message.id);
      await Promise.all([
        tx.reaction.deleteMany({ where: { messageId: { in: messageIds } } }),
        tx.bookmark.deleteMany({ where: { messageId: { in: messageIds } } }),
      ]);
      const result = await tx.message.deleteMany({
        where: { id: { in: messageIds }, channelId },
      });
      await tx.auditLog.create({
        data: {
          serverId: channel.serverId,
          actorId: session.userId,
          action: "message_purge",
          detail: `Purged ${result.count} messages in channel ${channelId}${filterUserId ? ` (user: ${filterUserId})` : ""}`,
        },
      });

      return { deleted: result.count, messages: doomed };
    });

    await cleanupDeletedMessageUploads(deletion.messages);
    return NextResponse.json({
      deleted: deletion.deleted,
      messageIds: deletion.messages.map((message) => message.id),
    });
  } catch (err) {
    console.error("[Campfire] Purge error:", err);
    return NextResponse.json({ error: "Database error" }, { status: 503 });
  }
}
