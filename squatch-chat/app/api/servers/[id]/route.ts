import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  const { name, regenerateInvite } = body;

  try {
    const { prisma } = await import("@/lib/db");

    const server = await prisma.server.findUnique({ where: { id } });
    if (!server) return NextResponse.json({ error: "Server not found" }, { status: 404 });
    if (server.ownerId !== session.userId) {
      return NextResponse.json({ error: "Only the server owner can do this" }, { status: 403 });
    }

    const updates: { name?: string; inviteCode?: string } = {};
    if (name && name.trim()) updates.name = name.trim();
    if (regenerateInvite) updates.inviteCode = crypto.randomUUID();

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const updated = await prisma.server.update({ where: { id }, data: updates });
    return NextResponse.json({ server: updated });
  } catch (err) {
    console.error("[Campfire] Failed to update server:", err);
    return NextResponse.json({ error: "Database error" }, { status: 503 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;

  try {
    const { prisma } = await import("@/lib/db");

    const server = await prisma.server.findUnique({ where: { id } });
    if (!server) return NextResponse.json({ error: "Server not found" }, { status: 404 });
    if (server.ownerId !== session.userId) {
      return NextResponse.json({ error: "Only the server owner can do this" }, { status: 403 });
    }

    // Cascade-delete manually (schema has no onDelete:Cascade on server relations)
    await prisma.$transaction(async (tx) => {
      const channels = await tx.channel.findMany({
        where: { serverId: id },
        select: { id: true },
      });
      const channelIds = channels.map((c) => c.id);

      if (channelIds.length > 0) {
        await tx.reaction.deleteMany({
          where: { message: { channelId: { in: channelIds } } },
        });
        await tx.message.deleteMany({ where: { channelId: { in: channelIds } } });
        await tx.channel.deleteMany({ where: { serverId: id } });
      }

      await tx.serverMember.deleteMany({ where: { serverId: id } });
      await tx.server.delete({ where: { id } });
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Campfire] Failed to delete server:", err);
    return NextResponse.json({ error: "Database error" }, { status: 503 });
  }
}
