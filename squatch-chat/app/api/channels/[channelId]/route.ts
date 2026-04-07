import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export async function PATCH(
  req: NextRequest,
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
      include: { server: { select: { ownerId: true } } },
    });
    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    // Allow owner, admin, or mod to update channel topic
    const membership = await prisma.serverMember.findUnique({
      where: { serverId_userId: { serverId: channel.serverId, userId: session.userId } },
    });
    if (!membership) {
      return NextResponse.json({ error: "Not a server member" }, { status: 403 });
    }
    const canEdit =
      channel.server.ownerId === session.userId ||
      membership.role === "admin" ||
      membership.role === "mod";
    if (!canEdit) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const data: { topic?: string | null } = {};
    if ("topic" in body) data.topic = typeof body.topic === "string" ? body.topic.trim() || null : null;

    const updated = await prisma.channel.update({ where: { id: channelId }, data });

    return NextResponse.json({ channel: updated });
  } catch (err) {
    console.error("[Campfire] Failed to update channel:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
