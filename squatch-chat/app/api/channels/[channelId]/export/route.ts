import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { assertFeature } from "@/lib/features";
import { resolveChannelAccess } from "@/lib/channelAccess";
import { memberHasPermission } from "@/lib/serverRoles";
import { checkWeightedLimit } from "@/lib/rateLimit";

const EXPORT_MAX_MESSAGES = 50_000;
const EXPORTS_PER_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;

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

    if (!checkWeightedLimit(`export:${session.userId}`, 1, EXPORTS_PER_HOUR, HOUR_MS).allowed) {
      return NextResponse.json({ error: "Too many exports. Try again later." }, { status: 429 });
    }

    // ponytail: one response holds the export, so only the newest
    // EXPORT_MAX_MESSAGES; page it if real channels outgrow that.
    const newest = await prisma.message.findMany({
      where: { channelId },
      include: { author: { select: { username: true, id: true } } },
      orderBy: { createdAt: "desc" },
      take: EXPORT_MAX_MESSAGES + 1,
    });
    const truncated = newest.length > EXPORT_MAX_MESSAGES;

    return NextResponse.json({
      channel: { id: channel.id, name: channel.name },
      messages: newest.slice(0, EXPORT_MAX_MESSAGES).reverse(),
      truncated,
    });
  } catch (err) {
    console.error("[Campfire] Failed to export channel messages:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
