import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveChannelAccess } from "@/lib/channelAccess";
import {
  BoardError,
  getBoardTopic,
  parseTopicStatus,
  parseTopicTags,
  parseTopicTitle,
  updateBoardTopic,
  type TopicPatch,
} from "@/lib/boards";
import { memberHasPermission } from "@/lib/serverRoles";

type Params = { params: Promise<{ channelId: string; topicId: string }> };

async function boardAccess(channelId: string, userId: string) {
  const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { type: true, serverId: true } });
  if (!channel || channel.type !== "board") return null;
  const access = await resolveChannelAccess(channelId, userId);
  if (!access?.canView) return null;
  return { channel, access };
}

/** GET — the topic and its root message (replies come from /api/messages?parentId=). */
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { channelId, topicId } = await params;
  if (!(await boardAccess(channelId, session.userId))) {
    return NextResponse.json({ error: "Board not found" }, { status: 404 });
  }
  const detail = await getBoardTopic(channelId, topicId);
  if (!detail) return NextResponse.json({ error: "Topic not found" }, { status: 404 });
  return NextResponse.json(detail);
}

/**
 * PATCH — { title?, tags?, status?, pinned?, ownerId? }. The owner edits the
 * title and tags and resolves/reopens; MANAGE_MESSAGES also archives, pins,
 * and hands the topic to another member.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { channelId, topicId } = await params;
  const scope = await boardAccess(channelId, session.userId);
  if (!scope) return NextResponse.json({ error: "Board not found" }, { status: 404 });

  let body: { title?: unknown; tags?: unknown; status?: unknown; pinned?: unknown; ownerId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const patch: TopicPatch = {};
  if (body.title !== undefined) {
    const title = parseTopicTitle(body.title);
    if (!title) return NextResponse.json({ error: "Title must be 3-120 characters" }, { status: 400 });
    patch.title = title;
  }
  if (body.tags !== undefined) {
    const tags = parseTopicTags(body.tags);
    if (!tags) {
      return NextResponse.json({ error: "Up to 5 tags of letters, numbers and dashes (24 characters each)" }, { status: 400 });
    }
    patch.tags = tags;
  }
  if (body.status !== undefined) {
    const status = parseTopicStatus(body.status);
    if (!status) return NextResponse.json({ error: "status must be open, resolved, or archived" }, { status: 400 });
    patch.status = status;
  }
  if (body.pinned !== undefined) {
    if (typeof body.pinned !== "boolean") return NextResponse.json({ error: "pinned must be a boolean" }, { status: 400 });
    patch.pinned = body.pinned;
  }
  if (body.ownerId !== undefined) {
    if (body.ownerId !== null && typeof body.ownerId !== "string") {
      return NextResponse.json({ error: "ownerId must be a user id or null" }, { status: 400 });
    }
    patch.ownerId = body.ownerId;
  }

  try {
    const canModerate = await memberHasPermission(scope.channel.serverId, session.userId, "MANAGE_MESSAGES");
    const topic = await updateBoardTopic({
      channelId,
      serverId: scope.channel.serverId,
      topicId,
      actorId: session.userId,
      canModerate,
      patch,
    });
    return NextResponse.json({ topic });
  } catch (error) {
    if (error instanceof BoardError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[Campfire] Update topic error:", error);
    return NextResponse.json({ error: "Database error" }, { status: 503 });
  }
}
