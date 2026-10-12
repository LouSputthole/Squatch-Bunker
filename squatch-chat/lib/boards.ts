import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { channelMessageInclude, toChannelMessagePayload } from "@/lib/messagePayload";
import { requireMembership } from "@/lib/membership";

/**
 * Trail Boards — forum-style channels.
 *
 * A board is a channel with `type = "board"`. Each topic is an ordinary root
 * message in that channel plus a `BoardTopic` row carrying the title, tags,
 * status, and owner; replies are the root message's thread, so everything the
 * chat already does (reactions, edits, attachments, reports, retention,
 * notifications) keeps working. Durable ownership: the topic's owner runs it
 * (title, tags, resolve/reopen) until a moderator hands it to someone else.
 */

export const TOPIC_STATUSES = ["open", "resolved", "archived"] as const;
export type TopicStatus = (typeof TOPIC_STATUSES)[number];

export const MIN_TOPIC_TITLE_LENGTH = 3;
export const MAX_TOPIC_TITLE_LENGTH = 120;
export const MAX_TOPIC_TAGS = 5;
export const MAX_TAG_LENGTH = 24;
const TAG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const SNIPPET_LENGTH = 160;
const CANDIDATE_LIMIT = 300;
export const DEFAULT_TOPIC_PAGE = 50;

export class BoardError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "BoardError";
  }
}

export function parseTopicStatus(value: unknown): TopicStatus | null {
  return typeof value === "string" && (TOPIC_STATUSES as readonly string[]).includes(value)
    ? (value as TopicStatus)
    : null;
}

/** Trimmed title within bounds, or null. */
export function parseTopicTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const title = value.replace(/\s+/g, " ").trim();
  return title.length >= MIN_TOPIC_TITLE_LENGTH && title.length <= MAX_TOPIC_TITLE_LENGTH ? title : null;
}

/** Normalized tag — lowercase slug — or null when it can't be one. */
export function normalizeTag(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const tag = value.trim().toLowerCase().replace(/^#/, "").replace(/\s+/g, "-");
  return tag.length > 0 && tag.length <= MAX_TAG_LENGTH && TAG_PATTERN.test(tag) ? tag : null;
}

/** Up to MAX_TOPIC_TAGS unique normalized tags, or null when any entry is unusable. */
export function parseTopicTags(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : null;
  if (!raw) return null;
  const tags: string[] = [];
  for (const entry of raw) {
    if (typeof entry === "string" && entry.trim() === "") continue;
    const tag = normalizeTag(entry);
    if (!tag) return null;
    if (!tags.includes(tag)) tags.push(tag);
  }
  return tags.length <= MAX_TOPIC_TAGS ? tags : null;
}

export function tagsFromJson(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string") : [];
  } catch {
    return [];
  }
}

function snippetOf(content: string): string {
  const collapsed = content.replace(/\s+/g, " ").trim();
  return collapsed.length > SNIPPET_LENGTH ? `${collapsed.slice(0, SNIPPET_LENGTH - 1)}…` : collapsed;
}

const topicInclude = {
  owner: { select: { id: true, username: true } },
  rootMessage: {
    select: {
      content: true,
      attachmentName: true,
      author: { select: { id: true, username: true, avatar: true } },
      _count: { select: { children: true } },
    },
  },
} satisfies Prisma.BoardTopicInclude;

type TopicRow = Prisma.BoardTopicGetPayload<{ include: typeof topicInclude }>;

export interface BoardTopicView {
  id: string;
  channelId: string;
  rootMessageId: string;
  title: string;
  tags: string[];
  status: string;
  pinned: boolean;
  owner: { id: string; username: string } | null;
  author: { id: string; username: string; avatar: string | null };
  snippet: string;
  hasAttachment: boolean;
  replyCount: number;
  lastActivityAt: string;
  createdAt: string;
  resolvedAt: string | null;
  archivedAt: string | null;
}

export function toTopicView(row: TopicRow): BoardTopicView {
  return {
    id: row.id,
    channelId: row.channelId,
    rootMessageId: row.rootMessageId,
    title: row.title,
    tags: tagsFromJson(row.tags),
    status: row.status,
    pinned: row.pinned,
    owner: row.owner,
    author: row.rootMessage.author,
    snippet: snippetOf(row.rootMessage.content),
    hasAttachment: !!row.rootMessage.attachmentName,
    replyCount: row.rootMessage._count.children,
    lastActivityAt: row.lastActivityAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

export interface ListTopicsOptions {
  /** "open" | "resolved" | "archived" | "all"; default: everything but archived. */
  status?: string | null;
  tag?: string | null;
  q?: string | null;
  limit?: number;
}

/**
 * Topics on a board: pinned first, then most recent activity. Text search
 * runs over a bounded candidate set in memory so it behaves the same on
 * SQLite and PostgreSQL; boards with more than CANDIDATE_LIMIT matching
 * topics get the newest ones.
 */
export async function listBoardTopics(
  channelId: string,
  options: ListTopicsOptions = {},
): Promise<{ topics: BoardTopicView[]; tags: Array<{ tag: string; count: number }>; hasMore: boolean }> {
  const status = options.status === "all" ? null : parseTopicStatus(options.status) ?? null;
  const tag = options.tag ? normalizeTag(options.tag) : null;
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_TOPIC_PAGE, 1), CANDIDATE_LIMIT);
  const rows = await prisma.boardTopic.findMany({
    where: {
      channelId,
      ...(status ? { status } : options.status === "all" ? {} : { status: { not: "archived" } }),
      ...(tag ? { tags: { contains: `"${tag}"` } } : {}),
    },
    orderBy: [{ pinned: "desc" }, { lastActivityAt: "desc" }, { id: "desc" }],
    take: CANDIDATE_LIMIT,
    include: topicInclude,
  });

  const views = rows.map(toTopicView);
  const tagCounts = new Map<string, number>();
  for (const view of views) {
    for (const t of view.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  }

  const query = options.q?.trim().toLowerCase() ?? "";
  const matched = query
    ? views.filter((view) =>
        view.title.toLowerCase().includes(query)
        || view.snippet.toLowerCase().includes(query)
        || view.tags.some((t) => t.includes(query)))
    : views;

  return {
    topics: matched.slice(0, limit),
    tags: [...tagCounts.entries()]
      .map(([t, count]) => ({ tag: t, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
    hasMore: matched.length > limit,
  };
}

/** The topic whose root (or reply) is this message, for jump-to links. */
export async function findTopicForMessage(channelId: string, messageId: string): Promise<BoardTopicView | null> {
  const message = await prisma.message.findFirst({ where: { id: messageId, channelId }, select: { id: true, parentMessageId: true } });
  if (!message) return null;
  const row = await prisma.boardTopic.findFirst({
    where: { channelId, rootMessageId: message.parentMessageId ?? message.id },
    include: topicInclude,
  });
  return row ? toTopicView(row) : null;
}

/** One topic with its root message in the chat payload shape. */
export async function getBoardTopic(channelId: string, topicId: string) {
  const row = await prisma.boardTopic.findFirst({ where: { id: topicId, channelId }, include: topicInclude });
  if (!row) return null;
  const message = await prisma.message.findUnique({ where: { id: row.rootMessageId }, include: channelMessageInclude });
  if (!message) return null;
  return { topic: toTopicView(row), message: toChannelMessagePayload(message) };
}

/** Create the root message and its topic row together. */
export async function createBoardTopic(input: {
  channelId: string;
  authorId: string;
  title: string;
  tags: string[];
  content: string;
}) {
  const { channelId, authorId, title, tags, content } = input;
  const created = await prisma.$transaction(async (tx) => {
    const message = await tx.message.create({
      data: { channelId, authorId, content },
      include: channelMessageInclude,
    });
    const topic = await tx.boardTopic.create({
      data: { channelId, rootMessageId: message.id, ownerId: authorId, title, tags: JSON.stringify(tags) },
      include: topicInclude,
    });
    return { topic, message };
  });
  return { topic: toTopicView(created.topic), message: toChannelMessagePayload(created.message) };
}

export interface TopicPatch {
  title?: string;
  tags?: string[];
  status?: TopicStatus;
  pinned?: boolean;
  ownerId?: string | null;
}

/**
 * Apply a change under the ownership rules: the owner edits title/tags and
 * moves between open and resolved; anyone with MANAGE_MESSAGES can also
 * archive/unarchive, pin, and hand the topic to another member.
 */
export async function updateBoardTopic(input: {
  channelId: string;
  serverId: string;
  topicId: string;
  actorId: string;
  canModerate: boolean;
  patch: TopicPatch;
}): Promise<BoardTopicView> {
  const { channelId, serverId, topicId, actorId, canModerate, patch } = input;
  const topic = await prisma.boardTopic.findFirst({ where: { id: topicId, channelId } });
  if (!topic) throw new BoardError(404, "Topic not found");
  const isOwner = topic.ownerId === actorId;
  if (!isOwner && !canModerate) throw new BoardError(403, "Only the topic owner or a moderator can change this topic");

  const data: Prisma.BoardTopicUpdateInput = {};
  if (patch.title !== undefined) data.title = patch.title;
  if (patch.tags !== undefined) data.tags = JSON.stringify(patch.tags);
  if (patch.status !== undefined && patch.status !== topic.status) {
    const touchesArchive = patch.status === "archived" || topic.status === "archived";
    if (touchesArchive && !canModerate) {
      throw new BoardError(403, "Only a moderator can archive or unarchive a topic");
    }
    data.status = patch.status;
    data.resolvedAt = patch.status === "resolved" ? new Date() : null;
    data.archivedAt = patch.status === "archived" ? new Date() : null;
  }
  if (patch.pinned !== undefined) {
    if (!canModerate) throw new BoardError(403, "Only a moderator can pin a topic");
    data.pinned = patch.pinned;
  }
  if (patch.ownerId !== undefined) {
    if (!canModerate) throw new BoardError(403, "Only a moderator can hand a topic to someone else");
    if (patch.ownerId !== null) {
      const server = await prisma.server.findUnique({ where: { id: serverId }, select: { ownerId: true } });
      const member = server?.ownerId === patch.ownerId || !!(await requireMembership(serverId, patch.ownerId));
      if (!member) throw new BoardError(400, "The new owner must be a member of this camp");
    }
    data.owner = patch.ownerId ? { connect: { id: patch.ownerId } } : { disconnect: true };
  }
  if (Object.keys(data).length === 0) throw new BoardError(400, "Nothing to change");

  const updated = await prisma.boardTopic.update({ where: { id: topic.id }, data, include: topicInclude });
  return toTopicView(updated);
}

/** The topic a message replies into (by its parent root), or null. */
export async function topicForRoot(rootMessageId: string, database: Pick<Prisma.TransactionClient, "boardTopic"> = prisma) {
  return database.boardTopic.findUnique({ where: { rootMessageId }, select: { id: true, status: true } });
}

/** A reply landed: the topic moves up the board. */
export async function touchBoardTopic(rootMessageId: string, database: Pick<Prisma.TransactionClient, "boardTopic"> = prisma) {
  await database.boardTopic.updateMany({ where: { rootMessageId }, data: { lastActivityAt: new Date() } });
}
