import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { assertFeature } from "@/lib/features";
import { resolveChannelAccess } from "@/lib/channelAccess";
import { memberHasPermission } from "@/lib/serverRoles";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { channelId } = await params;

  try {
    const { prisma } = await import("@/lib/db");

    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { id: true, name: true, serverId: true },
    });

    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    // Manage Channels (owner included) may export, but only channels they
    // can read: a hidden channel's history stays hidden from its exporter.
    const access = await resolveChannelAccess(channelId, session.userId);
    if (
      !access?.canView
      || !(await memberHasPermission(channel.serverId, session.userId, "MANAGE_CHANNELS"))
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Premium feature gate (export/backup)
    if (!(await assertFeature(session.userId, "backup_restore"))) {
      return NextResponse.json({ error: "Upgrade required" }, { status: 403 });
    }

    const messages = await prisma.message.findMany({
      where: { channelId },
      include: { author: { select: { username: true, id: true } } },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({
      channel: { id: channel.id, name: channel.name },
      messages,
    });
  } catch (err) {
    console.error("[Campfire] Failed to export channel messages:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
