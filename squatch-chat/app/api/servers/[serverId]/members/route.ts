import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ serverId: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { serverId } = await params;

  // Verify membership
  const membership = await prisma.serverMember.findUnique({
    where: {
      serverId_userId: { serverId, userId: session.userId },
    },
  });

  if (!membership) {
    return NextResponse.json({ error: "Not a server member" }, { status: 403 });
  }

  const members = await prisma.serverMember.findMany({
    where: { serverId },
    include: {
      user: { select: { id: true, username: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  // Get the server to include inviteCode for the owner
  const server = await prisma.server.findUnique({
    where: { id: serverId },
    select: { ownerId: true, inviteCode: true },
  });

  return NextResponse.json({
    members: members.map((m) => ({
      id: m.user.id,
      username: m.user.username,
      joinedAt: m.createdAt,
    })),
    inviteCode: server?.inviteCode,
  });
}
