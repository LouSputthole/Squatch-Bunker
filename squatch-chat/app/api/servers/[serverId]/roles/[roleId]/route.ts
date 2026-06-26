import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getPermContext } from "@/lib/serverRoles";
import { hasPermission, ALL_PERMISSIONS, type PermKey } from "@/lib/permissions";

function sanitizePerms(input: unknown): PermKey[] {
  if (!Array.isArray(input)) return [];
  return input.filter((p): p is PermKey => typeof p === "string" && (ALL_PERMISSIONS as string[]).includes(p));
}

// PATCH — edit a role's name / color / permissions / position (requires MANAGE_ROLES).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ serverId: string; roleId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { serverId, roleId } = await params;

  const ctx = await getPermContext(serverId, session.userId);
  if (!hasPermission("MANAGE_ROLES", ctx)) return NextResponse.json({ error: "Missing permission: Manage Roles" }, { status: 403 });

  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role || role.serverId !== serverId) return NextResponse.json({ error: "Role not found" }, { status: 404 });

  const body = await req.json();
  const data: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim().slice(0, 40);
  if (typeof body.color === "string" && /^#[0-9a-fA-F]{6}$/.test(body.color)) data.color = body.color;
  if ("permissions" in body) data.permissions = JSON.stringify(sanitizePerms(body.permissions));
  if (typeof body.position === "number") data.position = body.position;

  const updated = await prisma.role.update({ where: { id: roleId }, data });
  return NextResponse.json({ role: updated });
}

// DELETE — remove a role (requires MANAGE_ROLES). The default base role can't be deleted.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ serverId: string; roleId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { serverId, roleId } = await params;

  const ctx = await getPermContext(serverId, session.userId);
  if (!hasPermission("MANAGE_ROLES", ctx)) return NextResponse.json({ error: "Missing permission: Manage Roles" }, { status: 403 });

  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role || role.serverId !== serverId) return NextResponse.json({ error: "Role not found" }, { status: 404 });
  if (role.isDefault) return NextResponse.json({ error: "The default role can't be deleted" }, { status: 400 });

  await prisma.role.delete({ where: { id: roleId } }); // cascades ServerMemberRole
  return NextResponse.json({ ok: true });
}
