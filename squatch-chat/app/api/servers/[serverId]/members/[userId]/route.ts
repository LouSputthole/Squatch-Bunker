import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { canAssignRole, canManageMembers, roleLevel } from "@/lib/permissions";

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

  // Get assigner's membership
  const assigner = await prisma.serverMember.findUnique({
    where: { serverId_userId: { serverId, userId: session.userId } },
  });
  if (!assigner || !canManageMembers(assigner.role)) {
    return NextResponse.json({ error: "No permission" }, { status: 403 });
  }

  // Get target's membership
  const target = await prisma.serverMember.findUnique({
    where: { serverId_userId: { serverId, userId } },
  });
  if (!target) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  // Can't change role of someone equal or higher
  if (!canAssignRole(assigner.role, target.role)) {
    return NextResponse.json({ error: "Cannot modify this member's role" }, { status: 403 });
  }

  // Can't assign role equal or higher than own
  if (roleLevel(role) >= roleLevel(assigner.role)) {
    return NextResponse.json({ error: "Cannot assign this role" }, { status: 403 });
  }

  const updated = await prisma.serverMember.update({
    where: { id: target.id },
    data: { role },
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

  const actor = await prisma.serverMember.findUnique({
    where: { serverId_userId: { serverId, userId: session.userId } },
  });
  if (!actor || !canManageMembers(actor.role)) {
    return NextResponse.json({ error: "No permission" }, { status: 403 });
  }

  const target = await prisma.serverMember.findUnique({
    where: { serverId_userId: { serverId, userId } },
  });
  if (!target) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  if (!canAssignRole(actor.role, target.role)) {
    return NextResponse.json({ error: "Cannot ban this member" }, { status: 403 });
  }

  const updated = await prisma.serverMember.update({
    where: { id: target.id },
    data: { banned: !!banned, bannedAt: banned ? new Date() : null },
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

  const kicker = await prisma.serverMember.findUnique({
    where: { serverId_userId: { serverId, userId: session.userId } },
  });
  if (!kicker || !canManageMembers(kicker.role)) {
    return NextResponse.json({ error: "No permission" }, { status: 403 });
  }

  const target = await prisma.serverMember.findUnique({
    where: { serverId_userId: { serverId, userId } },
  });
  if (!target) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  if (!canAssignRole(kicker.role, target.role)) {
    return NextResponse.json({ error: "Cannot kick this member" }, { status: 403 });
  }

  await prisma.serverMember.delete({ where: { id: target.id } });

  return NextResponse.json({ kicked: true });
}
