import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

async function isMember(serverId: string, userId: string): Promise<boolean> {
  const m = await prisma.serverMember.findUnique({ where: { serverId_userId: { serverId, userId } }, select: { id: true } });
  return !!m;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ serverId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { serverId } = await params;

  const server = await prisma.server.findUnique({
    where: { id: serverId },
    select: { welcomeMessage: true, welcomeChannelIds: true, name: true, icon: true, ownerId: true },
  });
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (server.ownerId !== session.userId && !(await isMember(serverId, session.userId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json({ welcome: { welcomeMessage: server.welcomeMessage, welcomeChannelIds: server.welcomeChannelIds, name: server.name, icon: server.icon } });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ serverId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { serverId } = await params;

  const server = await prisma.server.findUnique({ where: { id: serverId } });
  if (!server || server.ownerId !== session.userId) {
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
    const ids = Array.isArray(b.welcomeChannelIds) ? b.welcomeChannelIds.filter((x) => typeof x === "string") : [];
    data.welcomeChannelIds = JSON.stringify(ids);
  }

  const updated = await prisma.server.update({ where: { id: serverId }, data });
  return NextResponse.json({ server: updated });
}
