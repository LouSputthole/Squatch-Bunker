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
    // A banned member must not be able to re-enter the server.
    if (existing.banned) {
      return NextResponse.json(
        { error: "You are banned from this server" },
        { status: 403 }
      );
    }
    return NextResponse.json({ server, alreadyMember: true });
  }

  try {
    await prisma.serverMember.create({
      data: { serverId: server.id, userId: session.userId },
    });
  } catch (err) {
    const prismaErr = err as { code?: string };
    if (prismaErr?.code === "P2002") {
      // Concurrent join won the unique-constraint race — idempotent success,
      // but re-check the now-existing row so a banned user can't slip through.
      const member = await prisma.serverMember.findUnique({
        where: {
          serverId_userId: { serverId: server.id, userId: session.userId },
        },
      });
      if (member?.banned) {
        return NextResponse.json(
          { error: "You are banned from this server" },
          { status: 403 }
        );
      }
      return NextResponse.json({ server, alreadyMember: true });
    }
    console.error("[Campfire] Failed to join server:", err);
    return NextResponse.json({ error: "Failed to join server" }, { status: 503 });
  }

  // Find first text channel and post a join system message
  const generalChannel = await prisma.channel.findFirst({
    where: {
      serverId: server.id,
      type: "text",
    },
    orderBy: { position: "asc" },
  });

  if (generalChannel) {
    await prisma.message.create({
      data: {
        channelId: generalChannel.id,
        authorId: session.userId,
        content: `${session.username} joined the server`,
        isSystem: true,
      },
    });
  }

  const updated = await prisma.server.findUnique({
    where: { id: server.id },
    include: {
      channels: { orderBy: { createdAt: "asc" } },
      _count: { select: { members: true } },
    },
  });

  return NextResponse.json({ server: updated }, { status: 201 });
}
