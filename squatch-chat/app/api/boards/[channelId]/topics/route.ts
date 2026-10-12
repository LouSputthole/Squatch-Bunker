import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveChannelAccess } from "@/lib/channelAccess";
import {
  BoardError,
  createBoardTopic,
  findTopicForMessage,
  listBoardTopics,
  parseTopicTags,
  parseTopicTitle,
} from "@/lib/boards";
import { MAX_MESSAGE_LENGTH } from "@/lib/inputLimits";
import { checkRateLimit } from "@/lib/rateLimit";

type Params = { params: Promise<{ channelId: string }> };

async function boardAccess(channelId: string, userId: string) {
  const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { type: true, slowModeSeconds: true } });
  if (!channel || channel.type !== "board") return null;
  const access = await resolveChannelAccess(channelId, userId);
  if (!access?.canView) return null;
  return { channel, access };
}

/** GET /api/boards/:channelId/topics?status=&tag=&q= — the board's topic list. */
export async function GET(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { channelId } = await params;
  const scope = await boardAccess(channelId, session.userId);
  if (!scope) return NextResponse.json({ error: "Board not found" }, { status: 404 });

  const search = new URL(req.url).searchParams;
  const limit = Number.parseInt(search.get("limit") ?? "", 10);
  try {
    // ?message=<id>: the topic a message belongs to (jump-to from search, saved, journal).
    const messageId = search.get("message");
    if (messageId) {
      const topic = await findTopicForMessage(channelId, messageId);
      return NextResponse.json({ topics: topic ? [topic] : [], tags: [], hasMore: false });
    }
    const result = await listBoardTopics(channelId, {
      status: search.get("status"),
      tag: search.get("tag"),
      q: search.get("q"),
      ...(Number.isFinite(limit) ? { limit } : {}),
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[Campfire] Board topics error:", error);
    return NextResponse.json({ error: "Database error" }, { status: 503 });
  }
}

/** POST /api/boards/:channelId/topics — open a topic: { title, content, tags? }. */
export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { allowed } = checkRateLimit(`msg:${session.userId}`);
  if (!allowed) return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });

  const { channelId } = await params;
  const scope = await boardAccess(channelId, session.userId);
  if (!scope) return NextResponse.json({ error: "Board not found" }, { status: 404 });
  if (!scope.access.canSend) {
    return NextResponse.json({ error: "Not authorized to post on this board" }, { status: 403 });
  }

  let body: { title?: unknown; content?: unknown; tags?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const title = parseTopicTitle(body?.title);
  if (!title) return NextResponse.json({ error: "Title must be 3-120 characters" }, { status: 400 });
  const tags = parseTopicTags(body?.tags);
  if (!tags) {
    return NextResponse.json({ error: "Up to 5 tags of letters, numbers and dashes (24 characters each)" }, { status: 400 });
  }
  const content = typeof body?.content === "string" ? body.content.trim() : "";
  if (!content) return NextResponse.json({ error: "Say something to open the topic" }, { status: 400 });
  if (content.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: `Message too long (max ${MAX_MESSAGE_LENGTH} characters)` }, { status: 400 });
  }

  // Slow mode counts topics like any other message in the channel.
  if (scope.channel.slowModeSeconds > 0) {
    const last = await prisma.message.findFirst({
      where: { channelId, authorId: session.userId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (last) {
      const remaining = Math.ceil(scope.channel.slowModeSeconds - (Date.now() - last.createdAt.getTime()) / 1000);
      if (remaining > 0) {
        return NextResponse.json({ error: `Slow mode: wait ${remaining} seconds`, remaining }, { status: 429 });
      }
    }
  }

  try {
    const created = await createBoardTopic({ channelId, authorId: session.userId, title, tags, content });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof BoardError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[Campfire] Create topic error:", error);
    return NextResponse.json({ error: "Database error" }, { status: 503 });
  }
}
