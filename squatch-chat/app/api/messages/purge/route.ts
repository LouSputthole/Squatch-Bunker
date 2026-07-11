import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

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

    // Check admin/mod permissions
    const member = await prisma.serverMember.findUnique({
      where: { serverId_userId: { serverId: channel.serverId, userId: session.userId } },
    });
    if (!member || !["owner", "admin", "mod"].includes(member.role)) {
      return NextResponse.json({ error: "Mod access required" }, { status: 403 });
    }

    // Find messages to delete
    const where: { channelId: string; authorId?: string } = { channelId };
    if (filterUserId) where.authorId = filterUserId;

    const messages = await prisma.message.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: deleteCount,
      select: { id: true },
    });

    if (messages.length === 0) {
      return NextResponse.json({ deleted: 0 });
    }

    const ids = messages.map((m) => m.id);

    // Delete reactions first, then messages
    await prisma.reaction.deleteMany({ where: { messageId: { in: ids } } });
    await prisma.bookmark.deleteMany({ where: { messageId: { in: ids } } });
    const result = await prisma.message.deleteMany({ where: { id: { in: ids } } });

    // Audit log
    await prisma.auditLog.create({
      data: {
        serverId: channel.serverId,
        actorId: session.userId,
        action: "message_purge",
        detail: `Purged ${result.count} messages in channel ${channelId}${filterUserId ? ` (user: ${filterUserId})` : ""}`,
      },
    });

    return NextResponse.json({ deleted: result.count, messageIds: ids });
  } catch (err) {
    console.error("[Campfire] Purge error:", err);
    return NextResponse.json({ error: "Database error" }, { status: 503 });
  }
}
