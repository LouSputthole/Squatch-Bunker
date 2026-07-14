import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

export const MIN_ROLE_POSITION = 0;
export const MAX_ROLE_POSITION = 10_000;

const LEGACY_ROLE_POSITION: Record<string, number> = {
  owner: 100,
  admin: 80,
  mod: 50,
  member: 0,
};

export const hierarchyMemberSelect = {
  id: true,
  userId: true,
  role: true,
  banned: true,
  memberRoles: {
    select: {
      role: {
        select: {
          position: true,
        },
      },
    },
  },
} satisfies Prisma.ServerMemberSelect;

export type HierarchyMember = Prisma.ServerMemberGetPayload<{
  select: typeof hierarchyMemberSelect;
}>;

type HierarchyDatabase = Pick<
  Prisma.TransactionClient,
  "server" | "serverMember"
>;

export interface MemberHierarchyIdentity {
  isOwner: boolean;
  member: HierarchyMember | null;
  position: number;
}

export function legacyHierarchyPosition(role: string): number {
  return LEGACY_ROLE_POSITION[role] ?? MIN_ROLE_POSITION;
}

export function memberHierarchyPosition(
  member: Pick<HierarchyMember, "role" | "memberRoles">,
  roleOverride = member.role,
  customRolePositions = member.memberRoles.map(
    (assignment) => assignment.role.position,
  ),
): number {
  return Math.max(
    legacyHierarchyPosition(roleOverride),
    MIN_ROLE_POSITION,
    ...customRolePositions,
  );
}

export async function getMemberHierarchyIdentity(
  serverId: string,
  userId: string,
  database: HierarchyDatabase = prisma,
): Promise<MemberHierarchyIdentity | null> {
  const [server, member] = await Promise.all([
    database.server.findUnique({
      where: { id: serverId },
      select: { ownerId: true },
    }),
    database.serverMember.findUnique({
      where: { serverId_userId: { serverId, userId } },
      select: hierarchyMemberSelect,
    }),
  ]);
  if (!server) return null;

  const isOwner = server.ownerId === userId;
  if (!isOwner && !member) return null;

  return {
    isOwner,
    member,
    position: isOwner
      ? Number.POSITIVE_INFINITY
      : memberHierarchyPosition(member as HierarchyMember),
  };
}

export function actorOutranksTarget(
  actor: MemberHierarchyIdentity,
  target: MemberHierarchyIdentity,
): boolean {
  if (target.isOwner) return false;
  if (actor.isOwner) return true;
  return actor.position > target.position;
}

export function isValidRolePosition(value: unknown): value is number {
  return Number.isInteger(value)
    && (value as number) >= MIN_ROLE_POSITION
    && (value as number) <= MAX_ROLE_POSITION;
}
