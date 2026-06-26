import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ensureDefaultRoles, getPermContext } from "@/lib/serverRoles";
import { hasPermission, effectivePermissions, ALL_PERMISSIONS, type PermKey } from "@/lib/permissions";

function sanitizePerms(input: unknown): PermKey[] {
  if (!Array.isArray(input)) return [];
  return input.filter((p): p is PermKey => typeof p === "string" && (ALL_PERMISSIONS as string[]).includes(p));
}

// You can't grant a permission you don't hold yourself (prevents self-escalation).
function ungrantable(ctx: Parameters<typeof effectivePermissions>[0], perms: PermKey[]): PermKey[] {
  if (ctx.isOwner) return [];
  const mine = effectivePermissions(ctx);
  return perms.filter((p) => !mine.has(p));
}

// GET — list a server's roles (any member). Seeds defaults on first read.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ serverId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { serverId } = await params;

  const ctx = await getPermContext(serverId, session.userId);
  if (!ctx.isMember) return NextResponse.json({ error: "Not a server member" }, { status: 403 });

  await ensureDefaultRoles(serverId);
  const roles = await prisma.role.findMany({ where: { serverId }, orderBy: { position: "desc" } });
  return NextResponse.json({ roles, canManageRoles: hasPermission("MANAGE_ROLES", ctx) });
}

// POST — create a role (requires MANAGE_ROLES).
export async function POST(req: NextRequest, { params }: { params: Promise<{ serverId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { serverId } = await params;

  await ensureDefaultRoles(serverId);
  const ctx = await getPermContext(serverId, session.userId);
  if (!hasPermission("MANAGE_ROLES", ctx)) return NextResponse.json({ error: "Missing permission: Manage Roles" }, { status: 403 });

  const body = await req.json();
  const name = (body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Role name is required" }, { status: 400 });

  const perms = sanitizePerms(body.permissions);
  const denied = ungrantable(ctx, perms);
  if (denied.length) return NextResponse.json({ error: `You can't grant permissions you don't have: ${denied.join(", ")}` }, { status: 403 });

  const max = await prisma.role.aggregate({ where: { serverId }, _max: { position: true } });
  const role = await prisma.role.create({
    data: {
      serverId,
      name: name.slice(0, 40),
      color: typeof body.color === "string" && /^#[0-9a-fA-F]{6}$/.test(body.color) ? body.color : "#99aab5",
      permissions: JSON.stringify(perms),
      position: (max._max.position ?? 0) + 1,
    },
  });
  return NextResponse.json({ role }, { status: 201 });
}
