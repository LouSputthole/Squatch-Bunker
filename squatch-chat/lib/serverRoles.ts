import { prisma } from "@/lib/db";
import { prismaErrorCode } from "@/lib/prismaErrors";
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
 *
 * Seeded roles get deterministic ids, so two concurrent first reads that both
 * see zero roles collide on the primary key instead of seeding duplicates.
 */
export async function ensureDefaultRoles(serverId: string): Promise<void> {
  const count = await prisma.role.count({ where: { serverId } });
  if (count > 0) return;
  for (const seed of DEFAULT_ROLE_SEEDS) {
    await prisma.role.create({
      data: {
        id: `${serverId}-role-${seed.tier}`,
        serverId,
        name: seed.name,
        color: seed.color,
        permissions: JSON.stringify(TIER_PERMISSIONS[seed.tier]),
        position: seed.position,
        isDefault: seed.isDefault,
      },
    }).catch((error: unknown) => {
      if (prismaErrorCode(error) !== "P2002") throw error;
    });
  }
}

export interface MemberPermContext {
  isOwner: boolean;
  isMember: boolean;
  tier?: string;
  rolePermissionJsons: (string | null)[];
}

/**
 * Owner check + legacy tier + permissions of every custom role assigned to the
 * member, plus the server's default (@everyone-style) role, which every active
 * member holds implicitly — it is never assigned through ServerMemberRole.
 */
export async function getPermContext(serverId: string, userId: string): Promise<MemberPermContext> {
  const [server, member] = await Promise.all([
    prisma.server.findUnique({
      where: { id: serverId },
      select: { ownerId: true, roles: { where: { isDefault: true }, select: { permissions: true } } },
    }),
    prisma.serverMember.findUnique({
      where: { serverId_userId: { serverId, userId } },
      select: { banned: true, role: true, memberRoles: { select: { role: { select: { permissions: true } } } } },
    }),
  ]);
  const isOwner = !!server && server.ownerId === userId;
  const activeMember = member?.banned ? null : member;
  const defaultRoles = activeMember ? (server?.roles ?? []) : [];
  return {
    isOwner,
    isMember: isOwner || !!activeMember,
    tier: activeMember?.role,
    rolePermissionJsons: activeMember
      ? [
          ...defaultRoles.map((role) => role.permissions),
          ...activeMember.memberRoles.map((mr) => mr.role.permissions),
        ]
      : [],
  };
}

export async function memberHasPermission(serverId: string, userId: string, perm: PermKey): Promise<boolean> {
  return hasPermission(perm, await getPermContext(serverId, userId));
}
