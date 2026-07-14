import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveChannelAccess } from "@/lib/channelAccess";
import { requireMembership } from "@/lib/membership";
import { memberHasPermission } from "@/lib/serverRoles";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ serverId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { serverId } = await params;

  const server = await prisma.server.findUnique({
    where: { id: serverId },
    select: { welcomeMessage: true, welcomeChannelIds: true, name: true, icon: true, ownerId: true },
  });
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await requireMembership(serverId, session.userId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  let welcomeChannelIds = server.welcomeChannelIds;
  if (welcomeChannelIds) {
    try {
      const parsed = JSON.parse(welcomeChannelIds) as unknown;
      const channelIds = Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === "string")
        : [];
      const visibleIds = (
        await Promise.all(
          channelIds.map(async (channelId) => {
            const access = await resolveChannelAccess(channelId, session.userId);
            return access?.serverId === serverId && access.canView ? channelId : null;
          }),
        )
      ).filter((channelId): channelId is string => channelId !== null);
      welcomeChannelIds = JSON.stringify(visibleIds);
    } catch {
      welcomeChannelIds = JSON.stringify([]);
    }
  }

  return NextResponse.json({
    welcome: { welcomeMessage: server.welcomeMessage, welcomeChannelIds, name: server.name, icon: server.icon },
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ serverId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { serverId } = await params;

  const server = await prisma.server.findUnique({ where: { id: serverId } });
  if (!server || !(await memberHasPermission(serverId, session.userId, "MANAGE_SERVER"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  const data: Record<string, unknown> = {};
  if ("welcomeMessage" in b) data.welcomeMessage = typeof b.welcomeMessage === "string" ? b.welcomeMessage.slice(0, 2000) : null;
  if ("welcomeChannelIds" in b) {
    if (!Array.isArray(b.welcomeChannelIds)) {
      return NextResponse.json({ error: "welcomeChannelIds must be an array" }, { status: 400 });
    }
    const ids = b.welcomeChannelIds;
    if (!ids.every((id): id is string => typeof id === "string")) {
      return NextResponse.json({ error: "welcomeChannelIds must contain strings" }, { status: 400 });
    }
    const uniqueIds = [...new Set(ids)];
    const ownedChannelCount = await prisma.channel.count({
      where: { serverId, id: { in: uniqueIds } },
    });
    if (ownedChannelCount !== uniqueIds.length) {
      return NextResponse.json({ error: "Welcome channels must belong to this server" }, { status: 400 });
    }
    data.welcomeChannelIds = JSON.stringify(ids);
  }

  const updated = await prisma.server.update({ where: { id: serverId }, data });
  return NextResponse.json({ server: updated });
}
