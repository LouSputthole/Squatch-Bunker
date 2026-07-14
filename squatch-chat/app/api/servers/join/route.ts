import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import {
  getInviteAvailability,
  inviteAvailabilityMessage,
} from "@/lib/invites";
import { projectVisibleServerChannels } from "@/lib/channelAccess";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = (await request.json()) as Record<string, unknown>;
  const inviteCode = typeof body.inviteCode === "string" ? body.inviteCode.trim() : "";
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
    const [visibleServer] = await projectVisibleServerChannels(
      [server],
      session.userId,
    );
    return NextResponse.json({ server: visibleServer, alreadyMember: true });
  }

  const inviteStatus = getInviteAvailability(server);
  if (inviteStatus !== "active") {
    return NextResponse.json(
      {
        error: inviteAvailabilityMessage(inviteStatus),
        inviteStatus,
      },
      { status: 410 },
    );
  }

  try {
    const joined = await prisma.$transaction(async (tx) => {
      // Claim exactly one use before inserting membership. The conditional
      // update is atomic on both SQLite and Postgres, so concurrent joiners
      // cannot push a bounded invite beyond its maximum.
      const claim = await tx.server.updateMany({
        where: {
          id: server.id,
          inviteCode,
          inviteRevokedAt: null,
          ...(server.inviteExpiresAt
            ? { inviteExpiresAt: { gt: new Date() } }
            : {}),
          ...(server.inviteMaxUses !== null
            ? { inviteUseCount: { lt: server.inviteMaxUses } }
            : {}),
        },
        data: { inviteUseCount: { increment: 1 } },
      });

      if (claim.count !== 1) return false;

      await tx.serverMember.create({
        data: { serverId: server.id, userId: session.userId },
      });

      const generalChannel = await tx.channel.findFirst({
        where: { serverId: server.id, type: "text" },
        orderBy: { position: "asc" },
      });
      if (generalChannel) {
        await tx.message.create({
          data: {
            channelId: generalChannel.id,
            authorId: session.userId,
            content: `${session.username} joined the server`,
            isSystem: true,
          },
        });
      }

      return true;
    });

    if (!joined) {
      const latest = await prisma.server.findUnique({ where: { inviteCode } });
      const latestStatus = latest ? getInviteAvailability(latest) : "revoked";
      return NextResponse.json(
        {
          error: inviteAvailabilityMessage(latestStatus),
          inviteStatus: latestStatus,
        },
        { status: 410 },
      );
    }
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
      const [visibleServer] = await projectVisibleServerChannels(
        [server],
        session.userId,
      );
      return NextResponse.json({ server: visibleServer, alreadyMember: true });
    }
    console.error("[Campfire] Failed to join server:", err);
    return NextResponse.json({ error: "Failed to join server" }, { status: 503 });
  }

  const updated = await prisma.server.findUnique({
    where: { id: server.id },
    include: {
      channels: { orderBy: { createdAt: "asc" } },
      _count: { select: { members: true } },
    },
  });

  if (!updated) {
    return NextResponse.json({ error: "Failed to load server" }, { status: 503 });
  }

  const [visibleServer] = await projectVisibleServerChannels(
    [updated],
    session.userId,
  );
  return NextResponse.json({ server: visibleServer }, { status: 201 });
}
