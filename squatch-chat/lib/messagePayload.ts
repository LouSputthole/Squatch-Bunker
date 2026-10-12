import type { Prisma } from "@/generated/prisma/client";

/**
 * The channel-message shape the chat client renders. GET /api/messages and
 * the edit/pin PATCH both return it so a client can replace a row in place.
 */
export const channelMessageInclude = {
  author: { select: { id: true, username: true, avatar: true } },
  reactions: {
    select: { emoji: true, userId: true, user: { select: { username: true } } },
  },
  replyTo: {
    select: {
      id: true,
      content: true,
      author: { select: { id: true, username: true } },
    },
  },
  poll: {
    include: {
      options: { orderBy: { position: "asc" }, include: { votes: { select: { userId: true } } } },
      votes: { select: { userId: true, optionId: true } },
    },
  },
  _count: { select: { children: true } },
} satisfies Prisma.MessageInclude;

type ChannelMessageRow = Prisma.MessageGetPayload<{ include: typeof channelMessageInclude }>;

export type GroupedReactions = Record<string, { count: number; users: string[]; userIds: string[] }>;

export function groupReactions(
  reactions: { emoji: string; userId: string; user: { username: string } }[],
): GroupedReactions {
  const grouped: GroupedReactions = {};
  for (const r of reactions) {
    if (!grouped[r.emoji]) grouped[r.emoji] = { count: 0, users: [], userIds: [] };
    grouped[r.emoji].count++;
    grouped[r.emoji].users.push(r.user.username);
    grouped[r.emoji].userIds.push(r.userId);
  }
  return grouped;
}

export function toChannelMessagePayload(message: ChannelMessageRow) {
  const { _count, reactions, ...rest } = message;
  return { ...rest, reactions: groupReactions(reactions), replyCount: _count.children };
}
