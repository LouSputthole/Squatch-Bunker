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

    // Allow owner, admin, or mod to update channel topic/name/category
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

    let name: string | undefined;
    if ("name" in body) {
      if (typeof body.name !== "string" || !body.name.trim()) {
        return NextResponse.json({ error: "Channel name cannot be empty" }, { status: 400 });
      }
      name = body.name.trim().toLowerCase().replace(/\s+/g, "-");
    }

    const updated = await prisma.channel.update({
      where: { id: channelId },
      data: {
        topic: "topic" in body
          ? (typeof body.topic === "string" ? body.topic.trim() || null : null)
          : undefined,
        name,
        category: "category" in body
          ? (typeof body.category === "string" && body.category.trim() ? body.category.trim() : null)
          : undefined,
      },
    });

    return NextResponse.json({ channel: updated });
  } catch (err) {
    console.error("[Campfire] Failed to update channel:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
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
      select: { id: true, serverId: true },
    });
    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    const membership = await prisma.serverMember.findUnique({
      where: { serverId_userId: { serverId: channel.serverId, userId: session.userId } },
    });
    if (!membership) {
      return NextResponse.json({ error: "Not a server member" }, { status: 403 });
    }

    // Requires the Manage Channels permission (same gate as channel creation).
    const { memberHasPermission } = await import("@/lib/serverRoles");
    if (!(await memberHasPermission(channel.serverId, session.userId, "MANAGE_CHANNELS"))) {
      return NextResponse.json({ error: "You need the Manage Channels permission to delete channels" }, { status: 403 });
    }

    // No DB-level cascade from Channel — clear dependents explicitly.
    // (Reactions/pins cascade off Message at the DB level.)
    await prisma.$transaction([
      prisma.scheduledMessage.deleteMany({ where: { channelId } }),
      prisma.webhook.deleteMany({ where: { channelId } }),
      prisma.message.deleteMany({ where: { channelId } }),
      prisma.channel.delete({ where: { id: channelId } }),
    ]);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Campfire] Failed to delete channel:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
