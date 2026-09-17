import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { resolveChannelAccess } from "@/lib/channelAccess";
import { displayName } from "@/lib/utils";

/**
 * Ember Inbox — durable, per-user notifications.
 *
 * Rows are created server-side at the moment the triggering mutation is
 * authoritative (realtime message fan-out, DM fan-out, friend-request route)
 * and pushed to connected clients over the `user:<id>` room as
 * `notification:new`. The inbox is persistence plus unread state; sound and
 * desktop toasts remain a client decision (quiet hours, focus mode).
 */

export const NOTIFICATION_TYPES = ["mention", "reply", "dm", "friend_request"] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const MAX_MENTION_TARGETS = 10;
const BODY_PREVIEW_LENGTH = 140;
// Guests are stored as "Name#tag" and the composer inserts the full username,
// so the optional tag must be part of the token.
const MENTION_PATTERN = /@(\w{1,32}(?:#\w{1,16})?)/g;

type NotificationDatabase = Pick<
  Prisma.TransactionClient,
  "notification" | "notificationPreference" | "serverMember" | "user"
  | "userBlock" | "channelPermission" | "channel" | "server"
>;

export interface NotificationRecord {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  serverId: string | null;
  channelId: string | null;
  conversationId: string | null;
  messageId: string | null;
  actorId: string | null;
  readAt: Date | null;
  createdAt: Date;
}

export function extractMentionedUsernames(content: string): string[] {
  const seen = new Set<string>();
  for (const match of content.matchAll(MENTION_PATTERN)) {
    seen.add(match[1].toLowerCase());
    if (seen.size >= MAX_MENTION_TARGETS) break;
  }
  return [...seen];
}

function previewOf(content: string): string {
  const collapsed = content.replace(/\s+/g, " ").trim();
  return collapsed.length > BODY_PREVIEW_LENGTH
    ? `${collapsed.slice(0, BODY_PREVIEW_LENGTH - 1)}…`
    : collapsed;
}

/**
 * Channel > server > global precedence, defaulting to "all". Mention and reply
 * notifications are delivered at "all" and "mentions"; "none" silences the
 * scope entirely.
 */
export async function resolveNotificationLevel(
  userId: string,
  serverId: string,
  channelId: string,
  database: NotificationDatabase = prisma,
): Promise<"all" | "mentions" | "none"> {
  const preferences = await database.notificationPreference.findMany({
    where: {
      userId,
      OR: [
        { serverId, channelId },
        { serverId, channelId: null },
        { serverId: null, channelId: null },
      ],
    },
    select: { serverId: true, channelId: true, level: true },
  });

  const ranked = preferences
    .map((preference) => ({
      level: preference.level,
      rank: preference.channelId ? 2 : preference.serverId ? 1 : 0,
    }))
    .sort((a, b) => b.rank - a.rank);
  const level = ranked[0]?.level;
  return level === "mentions" || level === "none" ? level : "all";
}

async function isBlockedEitherWay(
  userA: string,
  userB: string,
  database: NotificationDatabase,
): Promise<boolean> {
  const block = await database.userBlock.findFirst({
    where: {
      OR: [
        { blockerId: userA, blockedId: userB },
        { blockerId: userB, blockedId: userA },
      ],
    },
    select: { id: true },
  });
  return block !== null;
}

export interface ChannelMessageNotificationInput {
  messageId: string;
  channelId: string;
  channelName: string;
  serverId: string;
  authorId: string;
  authorUsername: string;
  content: string;
  replyToAuthorId?: string | null;
}

/**
 * Create mention and reply notifications for one authoritative channel
 * message. Every candidate is re-authorized: they must be an active member,
 * able to view the channel, not silenced by their notification policy, and
 * not in a block relationship with the author.
 */
export async function createChannelMessageNotifications(
  input: ChannelMessageNotificationInput,
  database: NotificationDatabase = prisma,
): Promise<NotificationRecord[]> {
  const candidates = new Map<string, NotificationType>();

  const usernames = extractMentionedUsernames(input.content);
  if (usernames.length > 0) {
    // Match in JS, not SQL: usernames keep their case and guests carry a #tag,
    // and case-insensitive equality is not portable across SQLite/PostgreSQL.
    // "@name#tag" is exact; a bare "@name" matches by display name.
    // ponytail: loads the server's member list per mentioning message; add a
    // normalized-username column if large servers make this hot.
    const members = await database.serverMember.findMany({
      where: { serverId: input.serverId, banned: false },
      select: { user: { select: { id: true, username: true } } },
    });
    const wanted = new Set(usernames);
    for (const { user } of members) {
      if (user.id === input.authorId) continue;
      const full = user.username.toLowerCase();
      if (wanted.has(full) || wanted.has(displayName(user.username).toLowerCase())) {
        candidates.set(user.id, "mention");
      }
    }
  }

  if (input.replyToAuthorId && input.replyToAuthorId !== input.authorId) {
    // A reply that also mentions the target stays a mention.
    if (!candidates.has(input.replyToAuthorId)) {
      candidates.set(input.replyToAuthorId, "reply");
    }
  }
  if (candidates.size === 0) return [];

  const created: NotificationRecord[] = [];
  for (const [recipientId, type] of candidates) {
    const access = await resolveChannelAccess(input.channelId, recipientId, database);
    if (!access?.canView || access.serverId !== input.serverId) continue;

    const level = await resolveNotificationLevel(
      recipientId,
      input.serverId,
      input.channelId,
      database,
    );
    if (level === "none") continue;
    if (await isBlockedEitherWay(recipientId, input.authorId, database)) continue;

    // Deterministic id: the primary key makes "one notification per recipient
    // per message" atomic, so a replayed `message:send` for an existing message
    // cannot stack inbox rows or re-fire desktop alerts.
    const record = await database.notification.create({
      data: {
        id: `msg:${recipientId}:${input.messageId}`,
        userId: recipientId,
        type,
        title: type === "mention"
          ? `${displayName(input.authorUsername)} mentioned you in #${input.channelName}`
          : `${displayName(input.authorUsername)} replied to you in #${input.channelName}`,
        body: previewOf(input.content),
        serverId: input.serverId,
        channelId: input.channelId,
        messageId: input.messageId,
        actorId: input.authorId,
      },
    }).catch((error: unknown) => {
      // P2002 = unique violation: this recipient was already notified.
      if ((error as { code?: string })?.code === "P2002") return null;
      throw error;
    });
    if (record) created.push(record);
  }
  return created;
}

export interface DmNotificationInput {
  conversationId: string;
  authorId: string;
  authorUsername: string;
  recipientId: string;
  content: string;
}

/**
 * One inbox entry per conversation: a fresh DM refreshes that entry (and
 * re-opens it as unread) instead of stacking a row per message. The
 * deterministic id lets the primary key make this atomic, so two DMs handled
 * concurrently cannot create two entries.
 */
export async function upsertDmNotification(
  input: DmNotificationInput,
  database: NotificationDatabase = prisma,
): Promise<NotificationRecord> {
  const fresh = {
    title: `New message from ${displayName(input.authorUsername)}`,
    body: previewOf(input.content),
    actorId: input.authorId,
    createdAt: new Date(),
    readAt: null,
  };
  const id = `dm:${input.recipientId}:${input.conversationId}`;
  const write = () => database.notification.upsert({
    where: { id },
    update: fresh,
    create: {
      id,
      userId: input.recipientId,
      type: "dm",
      conversationId: input.conversationId,
      ...fresh,
    },
  });
  // A concurrent first write can lose the insert race (P2002); the row exists
  // by then, so the retry lands as an update.
  return write().catch((error: unknown) => {
    if ((error as { code?: string })?.code === "P2002") return write();
    throw error;
  });
}

export async function createFriendRequestNotification(
  requesterId: string,
  requesterUsername: string,
  addresseeId: string,
  database: NotificationDatabase = prisma,
): Promise<NotificationRecord> {
  return database.notification.create({
    data: {
      userId: addresseeId,
      type: "friend_request",
      title: `${displayName(requesterUsername)} sent you a friend request`,
      body: "Open the Friends panel to accept or decline.",
      actorId: requesterId,
    },
  });
}

/**
 * In-process bridge from Next.js route modules to any attached realtime
 * server, mirroring lib/realtimeControl.ts. Emission is best-effort: clients
 * refetch the inbox when it opens, so a missed push (e.g. two-port dev, where
 * routes and Socket.IO run in separate processes) only delays visibility.
 */
export type NotificationEmitter = (
  userId: string,
  notification: NotificationRecord,
) => void;

type NotificationEmitGlobal = typeof globalThis & {
  __campfireNotificationEmitters__?: Set<NotificationEmitter>;
};

function emitters(): Set<NotificationEmitter> {
  const shared = globalThis as NotificationEmitGlobal;
  return shared.__campfireNotificationEmitters__ ??= new Set<NotificationEmitter>();
}

export function registerNotificationEmitter(emitter: NotificationEmitter): () => void {
  emitters().add(emitter);
  return () => emitters().delete(emitter);
}

export function emitNotification(userId: string, notification: NotificationRecord): void {
  for (const emitter of emitters()) {
    try {
      emitter(userId, notification);
    } catch (error) {
      console.error("[Campfire] notification emit failed:", error);
    }
  }
}
