import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { getPermContext } from "@/lib/serverRoles";
import {
  actorOutranksTarget,
  getMemberHierarchyIdentity,
  memberHierarchyPosition,
} from "@/lib/memberHierarchy";
import { notifyRealtimeAuthorizationChange } from "@/lib/realtimeControl";

// PATCH: update member role
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ serverId: string; userId: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { serverId, userId } = await params;
  const { role } = await req.json();

  if (!["admin", "mod", "member"].includes(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  const permissionContext = await getPermContext(serverId, session.userId);
  if (!hasPermission("MANAGE_ROLES", permissionContext)) {
    return NextResponse.json({ error: "No permission" }, { status: 403 });
  }

  const [actor, target] = await Promise.all([
    getMemberHierarchyIdentity(serverId, session.userId),
    getMemberHierarchyIdentity(serverId, userId),
  ]);
  if (!target) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }
  if (!actor || !actorOutranksTarget(actor, target)) {
    return NextResponse.json({ error: "Cannot modify this member's role" }, { status: 403 });
  }
  if (!target.member) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }
  if (
    !actor.isOwner
    && memberHierarchyPosition(target.member, role) >= actor.position
  ) {
    return NextResponse.json({ error: "Cannot assign this role" }, { status: 403 });
  }

  const previousRole = target.member.role;
  const [updated] = await prisma.$transaction([
    prisma.serverMember.update({
      where: { id: target.member.id },
      data: { role },
    }),
    prisma.auditLog.create({
      data: {
        serverId,
        actorId: session.userId,
        targetId: userId,
        action: "member_role_change",
        detail: `Role changed from ${previousRole} to ${role}`,
      },
    }),
  ]);
  await notifyRealtimeAuthorizationChange({
    scope: "server",
    serverId,
    userId,
  });

  return NextResponse.json({ role: updated.role });
}

// PUT: ban or unban member
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ serverId: string; userId: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { serverId, userId } = await params;
  const { banned } = await req.json();
  if (typeof banned !== "boolean") {
    return NextResponse.json({ error: "banned must be a boolean" }, { status: 400 });
  }

  const permissionContext = await getPermContext(serverId, session.userId);
  if (!hasPermission("BAN_MEMBERS", permissionContext)) {
    return NextResponse.json({ error: "No permission" }, { status: 403 });
  }

  const [actor, target] = await Promise.all([
    getMemberHierarchyIdentity(serverId, session.userId),
    getMemberHierarchyIdentity(serverId, userId),
  ]);
  if (!target) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }
  if (!actor || !actorOutranksTarget(actor, target)) {
    return NextResponse.json({ error: "Cannot ban this member" }, { status: 403 });
  }
  if (!target.member) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  const [updated] = await prisma.$transaction([
    prisma.serverMember.update({
      where: { id: target.member.id },
      data: { banned, bannedAt: banned ? new Date() : null },
    }),
    prisma.auditLog.create({
      data: {
        serverId,
        actorId: session.userId,
        targetId: userId,
        action: banned ? "member_ban" : "member_unban",
      },
    }),
  ]);
  await notifyRealtimeAuthorizationChange({
    scope: "member",
    serverId,
    userId,
  });

  return NextResponse.json({ banned: updated.banned });
}

// DELETE: kick member
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ serverId: string; userId: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { serverId, userId } = await params;

  const permissionContext = await getPermContext(serverId, session.userId);
  if (!hasPermission("KICK_MEMBERS", permissionContext)) {
    return NextResponse.json({ error: "No permission" }, { status: 403 });
  }

  const [actor, target] = await Promise.all([
    getMemberHierarchyIdentity(serverId, session.userId),
    getMemberHierarchyIdentity(serverId, userId),
  ]);
  if (!target) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }
  if (!actor || !actorOutranksTarget(actor, target)) {
    return NextResponse.json({ error: "Cannot kick this member" }, { status: 403 });
  }
  if (!target.member) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  // The ServerMember row is the only ban record, so kicking a banned member
  // would silently lift the ban. The banned check is part of the delete so a
  // concurrent ban cannot slip between the read and the write.
  const kicked = await prisma.$transaction(async (tx) => {
    const removed = await tx.serverMember.deleteMany({
      where: { id: target.member!.id, banned: false },
    });
    if (removed.count === 0) return false;
    await tx.auditLog.create({
      data: { serverId, actorId: session.userId, targetId: userId, action: "member_kick" },
    });
    return true;
  });
  if (!kicked) {
    return NextResponse.json({ error: "Member is banned — unban first" }, { status: 409 });
  }
  await notifyRealtimeAuthorizationChange({
    scope: "member",
    serverId,
    userId,
  });

  return NextResponse.json({ kicked: true });
}
