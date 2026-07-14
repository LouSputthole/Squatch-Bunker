import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  getInviteAvailability,
  inviteAvailabilityMessage,
  remainingInviteUses,
} from "@/lib/invites";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const inviteCode = new URL(request.url).searchParams.get("inviteCode")?.trim();
  if (!inviteCode) {
    return NextResponse.json({ error: "Invite code is required" }, { status: 400 });
  }

  const server = await prisma.server.findUnique({
    where: { inviteCode },
    select: {
      id: true,
      name: true,
      icon: true,
      inviteExpiresAt: true,
      inviteMaxUses: true,
      inviteUseCount: true,
      inviteRevokedAt: true,
      members: {
        where: { userId: session.userId },
        select: { banned: true },
        take: 1,
      },
      _count: {
        select: { members: { where: { banned: false } } },
      },
    },
  });

  if (!server) {
    return NextResponse.json({ error: "Invalid invite code" }, { status: 404 });
  }

  const membership = server.members[0];
  if (membership?.banned) {
    return NextResponse.json(
      { error: "You are banned from this server" },
      { status: 403 },
    );
  }

  const alreadyMember = Boolean(membership);
  const status = getInviteAvailability(server);
  if (!alreadyMember && status !== "active") {
    return NextResponse.json(
      { error: inviteAvailabilityMessage(status), inviteStatus: status },
      { status: 410 },
    );
  }

  return NextResponse.json({
    server: {
      id: server.id,
      name: server.name,
      icon: server.icon,
      _count: server._count,
    },
    alreadyMember,
    invite: {
      status,
      expiresAt: server.inviteExpiresAt,
      maxUses: server.inviteMaxUses,
      useCount: server.inviteUseCount,
      remainingUses: remainingInviteUses(server),
    },
  });
}
