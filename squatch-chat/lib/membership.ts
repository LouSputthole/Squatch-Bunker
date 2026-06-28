import { prisma } from "@/lib/db";

/**
 * A server membership row, including the legacy `role` string and ban state.
 * Inferred from the Prisma query so it stays in sync with the schema.
 */
export type ServerMember = NonNullable<
  Awaited<ReturnType<typeof prisma.serverMember.findUnique>>
>;

/**
 * Returns the user's membership for a server if they are an active member,
 * or null if they are not a member OR have been banned.
 *
 * Authorization gate: all DB access is service-role (no RLS), so callers MUST
 * use this to confirm a user actually belongs to a server before letting them
 * read/write its channels.
 */
export async function requireMembership(
  serverId: string,
  userId: string,
): Promise<ServerMember | null> {
  const member = await prisma.serverMember.findUnique({
    where: { serverId_userId: { serverId, userId } },
  });
  if (!member) return null;
  if (member.banned) return null;
  return member;
}

/**
 * Resolves a channel to its parent server, then confirms the user is an active
 * (non-banned) member of that server.
 *
 * Returns `{ membership, serverId }` on success, or null if the channel does
 * not exist or the user is not a member / is banned.
 */
export async function requireChannelMembership(
  channelId: string,
  userId: string,
): Promise<{ membership: ServerMember; serverId: string } | null> {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { serverId: true },
  });
  if (!channel) return null;

  const membership = await requireMembership(channel.serverId, userId);
  if (!membership) return null;

  return { membership, serverId: channel.serverId };
}
