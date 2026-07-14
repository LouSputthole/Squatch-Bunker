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

/**
 * The complete access decision for one user and one channel.
 *
 * A missing result means the channel does not exist or the user is not an
 * active member of its server. Channel overrides are keyed by the member's
 * legacy role; no override means the channel keeps its default open behavior.
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

  const permission = await database.channelPermission.findUnique({
    where: {
      channelId_role: {
        channelId,
        role: context.membership.role,
      },
    },
    select: { canView: true, canSend: true },
  });

  const canView = permission?.canView ?? true;
  const canSend = canView && (permission?.canSend ?? true);

  return { ...context, canView, canSend };
}

/**
 * Remove servers without an active membership and channels denied to the
 * viewer's legacy role. One membership query and one override query cover the
 * complete hydrated list, avoiding per-channel access lookups.
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
    select: { serverId: true, role: true },
  });
  const roleByServer = new Map(
    memberships.map((membership) => [membership.serverId, membership.role]),
  );

  const activeServers = servers.filter((server) => roleByServer.has(server.id));
  const channelIds = activeServers.flatMap((server) =>
    server.channels.map((channel) => channel.id),
  );
  if (channelIds.length === 0) return activeServers;

  const deniedOverrides = await database.channelPermission.findMany({
    where: {
      channelId: { in: channelIds },
      role: { in: [...new Set(roleByServer.values())] },
      canView: false,
    },
    select: { channelId: true, role: true },
  });
  const denied = new Set(
    deniedOverrides.map((permission) =>
      `${permission.channelId}:${permission.role}`,
    ),
  );

  return activeServers.map((server) => {
    const role = roleByServer.get(server.id)!;
    return {
      ...server,
      channels: server.channels.filter(
        (channel) => !denied.has(`${channel.id}:${role}`),
      ),
    };
  });
}
