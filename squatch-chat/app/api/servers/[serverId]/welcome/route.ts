import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest, { params }: { params: Promise<{ serverId: string }> }) {
  const { serverId } = await params;
  const server = await prisma.server.findUnique({
    where: { id: serverId },
    select: { welcomeMessage: true, welcomeChannelIds: true, name: true, icon: true },
  });
  if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ welcome: server });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ serverId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { serverId } = await params;

  const server = await prisma.server.findUnique({ where: { id: serverId } });
  if (!server || server.ownerId !== session.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const data: Record<string, unknown> = {};
  if ("welcomeMessage" in body) data.welcomeMessage = body.welcomeMessage || null;
  if ("welcomeChannelIds" in body) data.welcomeChannelIds = JSON.stringify(body.welcomeChannelIds ?? []);

  const updated = await prisma.server.update({ where: { id: serverId }, data });
  return NextResponse.json({ server: updated });
}
