import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getPermContext } from "@/lib/serverRoles";
import { hasPermission, effectivePermissions, parsePermissions } from "@/lib/permissions";
import {
  actorOutranksTarget,
  getMemberHierarchyIdentity,
} from "@/lib/memberHierarchy";
import { notifyRealtimeAuthorizationChange } from "@/lib/realtimeControl";

// PUT — set the full list of custom roles assigned to a member (requires MANAGE_ROLES).
// Body: { roleIds: string[] }
export async function PUT(req: NextRequest, { params }: { params: Promise<{ serverId: string; userId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { serverId, userId } = await params;

  const ctx = await getPermContext(serverId, session.userId);
  if (!hasPermission("MANAGE_ROLES", ctx)) return NextResponse.json({ error: "Missing permission: Manage Roles" }, { status: 403 });

  const [actor, target] = await Promise.all([
    getMemberHierarchyIdentity(serverId, session.userId),
    getMemberHierarchyIdentity(serverId, userId),
  ]);
  if (!target) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }
  if (!actor || !actorOutranksTarget(actor, target)) {
    return NextResponse.json({ error: "Cannot manage this member" }, { status: 403 });
  }
  if (!target.member) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }
  const targetMemberId = target.member.id;

  const body = await req.json();
  const requested: string[] = Array.isArray(body.roleIds) ? body.roleIds.filter((r: unknown) => typeof r === "string") : [];

  // Only roles that actually belong to this server.
  const validRoles = await prisma.role.findMany({
    where: { serverId, id: { in: requested } },
    select: { id: true, permissions: true, position: true },
  });
  const validIds = validRoles.map((r) => r.id);
  if (!actor.isOwner) {
    const tooHigh = validRoles.find(
      (role) => role.position >= actor.position,
    );
    if (tooHigh) {
      return NextResponse.json({ error: "Cannot assign this role" }, { status: 403 });
    }
  }

  // Can't assign a role that grants permissions you don't have yourself.
  if (!ctx.isOwner) {
    const mine = effectivePermissions(ctx);
    const granted = new Set(validRoles.flatMap((r) => parsePermissions(r.permissions)));
    const denied = [...granted].filter((p) => !mine.has(p));
    if (denied.length) {
      return NextResponse.json({ error: `That role grants permissions you don't have: ${denied.join(", ")}` }, { status: 403 });
    }
  }

  // Replace the member's role set atomically.
  await prisma.$transaction([
    prisma.serverMemberRole.deleteMany({ where: { memberId: targetMemberId } }),
    ...validIds.map((roleId) => prisma.serverMemberRole.create({ data: { memberId: targetMemberId, roleId } })),
  ]);

  await notifyRealtimeAuthorizationChange({
    scope: "server",
    serverId,
    userId,
  });

  return NextResponse.json({ ok: true, roleIds: validIds });
}
