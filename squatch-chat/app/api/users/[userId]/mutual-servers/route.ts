import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { userId: targetUserId } = await params;

  const myMemberships = await prisma.serverMember.findMany({
    where: { userId: session.userId },
    select: { serverId: true },
  });

  const myServerIds = myMemberships.map((m) => m.serverId);

  const mutual = await prisma.serverMember.findMany({
    where: { userId: targetUserId, serverId: { in: myServerIds } },
    include: { server: { select: { id: true, name: true, icon: true } } },
  });

  return NextResponse.json({ servers: mutual.map((m) => m.server) });
}
