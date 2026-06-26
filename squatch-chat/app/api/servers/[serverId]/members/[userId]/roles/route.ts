import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getPermContext } from "@/lib/serverRoles";
import { hasPermission } from "@/lib/permissions";

// PUT — set the full list of custom roles assigned to a member (requires MANAGE_ROLES).
// Body: { roleIds: string[] }
export async function PUT(req: NextRequest, { params }: { params: Promise<{ serverId: string; userId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { serverId, userId } = await params;

  const ctx = await getPermContext(serverId, session.userId);
  if (!hasPermission("MANAGE_ROLES", ctx)) return NextResponse.json({ error: "Missing permission: Manage Roles" }, { status: 403 });

  const member = await prisma.serverMember.findUnique({ where: { serverId_userId: { serverId, userId } } });
  if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });

  const body = await req.json();
  const requested: string[] = Array.isArray(body.roleIds) ? body.roleIds.filter((r: unknown) => typeof r === "string") : [];

  // Only roles that actually belong to this server.
  const validRoles = await prisma.role.findMany({ where: { serverId, id: { in: requested } }, select: { id: true } });
  const validIds = validRoles.map((r) => r.id);

  // Replace the member's role set.
  await prisma.serverMemberRole.deleteMany({ where: { memberId: member.id } });
  if (validIds.length > 0) {
    await prisma.serverMemberRole.createMany({ data: validIds.map((roleId) => ({ memberId: member.id, roleId })) });
  }

  return NextResponse.json({ ok: true, roleIds: validIds });
}
