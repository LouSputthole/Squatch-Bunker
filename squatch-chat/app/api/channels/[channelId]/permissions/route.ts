import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { channelId } = await params;

  try {
    const { prisma } = await import("@/lib/db");

    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { serverId: true },
    });
    if (!channel) return NextResponse.json({ error: "Channel not found" }, { status: 404 });

    const member = await prisma.serverMember.findUnique({
      where: { serverId_userId: { serverId: channel.serverId, userId: session.userId } },
    });
    if (!member || !["owner", "admin"].includes(member.role)) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const permissions = await prisma.channelPermission.findMany({
      where: { channelId },
      orderBy: { role: "asc" },
    });

    return NextResponse.json({ permissions });
  } catch (err) {
    console.error("[Campfire] Channel permissions error:", err);
    return NextResponse.json({ error: "Database error" }, { status: 503 });
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ channelId: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { channelId } = await params;
  const { role, canView, canSend } = await req.json();

  if (!role || !["member", "mod", "admin"].includes(role)) {
    return NextResponse.json({ error: "Valid role required" }, { status: 400 });
  }

  try {
    const { prisma } = await import("@/lib/db");

    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { serverId: true },
    });
    if (!channel) return NextResponse.json({ error: "Channel not found" }, { status: 404 });

    const member = await prisma.serverMember.findUnique({
      where: { serverId_userId: { serverId: channel.serverId, userId: session.userId } },
    });
    if (!member || !["owner", "admin"].includes(member.role)) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const permission = await prisma.channelPermission.upsert({
      where: { channelId_role: { channelId, role } },
      update: {
        canView: canView ?? true,
        canSend: canSend ?? true,
      },
      create: {
        channelId,
        role,
        canView: canView ?? true,
        canSend: canSend ?? true,
      },
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        serverId: channel.serverId,
        actorId: session.userId,
        action: "channel_permission_update",
        detail: `Updated permissions for role "${role}" in channel ${channelId}: view=${canView}, send=${canSend}`,
      },
    });

    return NextResponse.json({ permission });
  } catch (err) {
    console.error("[Campfire] Channel permission update error:", err);
    return NextResponse.json({ error: "Database error" }, { status: 503 });
  }
}
