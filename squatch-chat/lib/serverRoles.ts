import { prisma } from "@/lib/db";
import {
  DEFAULT_ROLE_SEEDS,
  TIER_PERMISSIONS,
  hasPermission,
  type PermKey,
} from "@/lib/permissions";

/**
 * Seed a server's 4 default roles (Owner/Admin/Mod/Member) if it has none.
 * Lazy migration — runs the first time a server's roles are read or managed,
 * so existing servers get roles without a data migration step.
 */
export async function ensureDefaultRoles(serverId: string): Promise<void> {
  const count = await prisma.role.count({ where: { serverId } });
  if (count > 0) return;
  for (const seed of DEFAULT_ROLE_SEEDS) {
    await prisma.role.create({
      data: {
        serverId,
        name: seed.name,
        color: seed.color,
        permissions: JSON.stringify(TIER_PERMISSIONS[seed.tier]),
        position: seed.position,
        isDefault: seed.isDefault,
      },
    });
  }
}

export interface MemberPermContext {
  isOwner: boolean;
  isMember: boolean;
  tier?: string;
  rolePermissionJsons: (string | null)[];
}

/** Owner check + legacy tier + permissions of every custom role assigned to the member. */
export async function getPermContext(serverId: string, userId: string): Promise<MemberPermContext> {
  const server = await prisma.server.findUnique({ where: { id: serverId }, select: { ownerId: true } });
  const isOwner = !!server && server.ownerId === userId;
  const member = await prisma.serverMember.findUnique({
    where: { serverId_userId: { serverId, userId } },
    select: { banned: true, role: true, memberRoles: { select: { role: { select: { permissions: true } } } } },
  });
  const activeMember = member?.banned ? null : member;
  return {
    isOwner,
    isMember: isOwner || !!activeMember,
    tier: activeMember?.role,
    rolePermissionJsons: activeMember?.memberRoles.map((mr) => mr.role.permissions) ?? [],
  };
}

export async function memberHasPermission(serverId: string, userId: string, perm: PermKey): Promise<boolean> {
  return hasPermission(perm, await getPermContext(serverId, userId));
}
