import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { inviteCode } = await request.json();
  if (!inviteCode) {
    return NextResponse.json(
      { error: "Invite code is required" },
      { status: 400 }
    );
  }

  const server = await prisma.server.findUnique({
    where: { inviteCode },
    include: {
      channels: { orderBy: { createdAt: "asc" } },
      _count: { select: { members: true } },
    },
  });

  if (!server) {
    return NextResponse.json(
      { error: "Invalid invite code" },
      { status: 404 }
    );
  }

  // Check if already a member
  const existing = await prisma.serverMember.findUnique({
    where: {
      serverId_userId: { serverId: server.id, userId: session.userId },
    },
  });

  if (existing) {
    return NextResponse.json({ server, alreadyMember: true });
  }

  await prisma.serverMember.create({
    data: { serverId: server.id, userId: session.userId },
  });

  const updated = await prisma.server.findUnique({
    where: { id: server.id },
    include: {
      channels: { orderBy: { createdAt: "asc" } },
      _count: { select: { members: true } },
    },
  });

  return NextResponse.json({ server: updated }, { status: 201 });
}
