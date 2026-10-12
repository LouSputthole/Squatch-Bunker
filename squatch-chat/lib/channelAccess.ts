import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import {
  requireChannelMembership,
  type MembershipDatabase,
  type ServerMember,
} from "@/lib/membership";

type ChannelAccessDatabase = MembershipDatabase &
  Pick<Prisma.TransactionClient, "channelPermission">;

interface ProjectableChannel {
  id: string;
}

interface ProjectableServer<TChannel extends ProjectableChannel> {
  id: string;
  channels: TChannel[];
}

/** Legacy tiers that can carry a channel override. Owners are never restricted. */
export const CHANNEL_OVERRIDE_TIERS = ["member", "mod", "admin"] as const;

const CUSTOM_ROLE_OVERRIDE_PREFIX = "role:";

/**
 * ChannelPermission.role key for a custom server role. The prefix keeps custom
 * role ids from ever colliding with the legacy tier names.
 */
export function customRoleOverrideKey(roleId: string): string {
  return `${CUSTOM_ROLE_OVERRIDE_PREFIX}${roleId}`;
}

/** The custom role id behind an override key, or null for a legacy tier key. */
export function customRoleIdFromOverrideKey(key: string): string | null {
  return key.startsWith(CUSTOM_ROLE_OVERRIDE_PREFIX)
    ? key.slice(CUSTOM_ROLE_OVERRIDE_PREFIX.length) || null
    : null;
}

interface ChannelOverride {
  role: string;
  canView: boolean;
  canSend: boolean;
}

/** 0 = hidden, 1 = read-only, 2 = view + send. A hidden row never grants send. */
function overrideLevel(override: Pick<ChannelOverride, "canView" | "canSend">): number {
  if (!override.canView) return 0;
  return override.canSend ? 2 : 1;
}

/**
 * The single channel access rule shared by every caller:
 * - overrides for custom roles the member holds are more specific than the
 *   legacy tier override and replace it; across several held roles the most
 *   permissive override wins (Discord-style role precedence);
 * - otherwise the member's tier override applies;
 * - with no applicable override the channel stays open.
 * The server owner is never subject to custom-role overrides, and the API
 * never writes an "owner" tier override, so the owner keeps full access.
 */
export function decideChannelAccess(input: {
  tier: string;
  heldRoleIds: readonly string[];
  overrides: readonly ChannelOverride[];
}): { canView: boolean; canSend: boolean } {
  const heldKeys = new Set(
    input.tier === "owner" ? [] : input.heldRoleIds.map(customRoleOverrideKey),
  );
  const roleOverrides = input.overrides.filter((override) => heldKeys.has(override.role));
  let level: number;
  if (roleOverrides.length > 0) {
    level = Math.max(...roleOverrides.map(overrideLevel));
  } else {
    const tierOverride = input.overrides.find((override) => override.role === input.tier);
    level = tierOverride ? overrideLevel(tierOverride) : 2;
  }
  return { canView: level >= 1, canSend: level >= 2 };
}

/**
 * The complete access decision for one user and one channel.
 *
 * A missing result means the channel does not exist or the user is not an
 * active member of its server. See decideChannelAccess for override rules.
 */
export interface ChannelAccess {
  membership: ServerMember;
  serverId: string;
  canView: boolean;
  canSend: boolean;
}

/**
 * Resolve channel visibility and send access in one place so HTTP and realtime
 * callers cannot drift. A hidden channel is never writable, even if a malformed
 * database row were to contain canView=false and canSend=true.
 */
export async function resolveChannelAccess(
  channelId: string,
  userId: string,
  database: ChannelAccessDatabase = prisma,
): Promise<ChannelAccess | null> {
  const context = await requireChannelMembership(channelId, userId, database);
  if (!context) return null;
  const { membership } = context;

  const overrides = await database.channelPermission.findMany({
    where: { channelId },
    select: { role: true, canView: true, canSend: true },
  });
  // Custom-role lookups only when this channel actually has a custom-role
  // override, so the common no-override path stays a single query.
  let heldRoleIds: string[] = [];
  if (
    membership.role !== "owner" &&
    overrides.some((override) => customRoleIdFromOverrideKey(override.role))
  ) {
    const held = await database.serverMember.findUnique({
      where: { id: membership.id },
      select: { memberRoles: { select: { roleId: true } } },
    });
    heldRoleIds = held?.memberRoles.map((memberRole) => memberRole.roleId) ?? [];
  }

  return {
    ...context,
    ...decideChannelAccess({ tier: membership.role, heldRoleIds, overrides }),
  };
}

/**
 * Remove servers without an active membership and channels the viewer cannot
 * see. One membership query and one override query cover the complete hydrated
 * list, avoiding per-channel access lookups.
 */
export async function projectVisibleServerChannels<
  TChannel extends ProjectableChannel,
  TServer extends ProjectableServer<TChannel>,
>(
  servers: TServer[],
  userId: string,
  database: ChannelAccessDatabase = prisma,
): Promise<TServer[]> {
  if (servers.length === 0) return [];

  const serverIds = [...new Set(servers.map((server) => server.id))];
  const memberships = await database.serverMember.findMany({
    where: {
      serverId: { in: serverIds },
      userId,
      banned: false,
    },
    select: {
      serverId: true,
      role: true,
      memberRoles: { select: { roleId: true } },
    },
  });
  const membershipByServer = new Map(
    memberships.map((membership) => [
      membership.serverId,
      {
        tier: membership.role,
        heldRoleIds: membership.memberRoles.map((memberRole) => memberRole.roleId),
      },
    ]),
  );

  const activeServers = servers.filter((server) => membershipByServer.has(server.id));
  const channelIds = activeServers.flatMap((server) =>
    server.channels.map((channel) => channel.id),
  );
  if (channelIds.length === 0) return activeServers;

  const overrideKeys = new Set<string>();
  for (const membership of membershipByServer.values()) {
    overrideKeys.add(membership.tier);
    for (const roleId of membership.heldRoleIds) overrideKeys.add(customRoleOverrideKey(roleId));
  }
  const overrides = await database.channelPermission.findMany({
    where: {
      channelId: { in: channelIds },
      role: { in: [...overrideKeys] },
    },
    select: { channelId: true, role: true, canView: true, canSend: true },
  });
  const overridesByChannel = new Map<string, ChannelOverride[]>();
  for (const override of overrides) {
    const list = overridesByChannel.get(override.channelId) ?? [];
    list.push(override);
    overridesByChannel.set(override.channelId, list);
  }

  return activeServers.map((server) => {
    const membership = membershipByServer.get(server.id)!;
    return {
      ...server,
      channels: server.channels.filter(
        (channel) =>
          decideChannelAccess({
            ...membership,
            overrides: overridesByChannel.get(channel.id) ?? [],
          }).canView,
      ),
    };
  });
}
