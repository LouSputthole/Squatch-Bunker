import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rateLimit";
import { resolveChannelAccess } from "@/lib/channelAccess";
import {
  claimPrivateUpload,
  parseRemoteAttachmentUrl,
  privateAttachmentUrl,
  PrivateUploadClaimError,
} from "@/lib/privateUploads";

const MAX_MESSAGE_LENGTH = 4000;

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const channelId = searchParams.get("channelId");
  const parentId = searchParams.get("parentId");
  const pinned = searchParams.get("pinned");
  const cursor = searchParams.get("cursor");
  const limit = 50;

  if (!channelId) {
    return NextResponse.json(
      { error: "channelId is required" },
      { status: 400 }
    );
  }

  try {
    const { prisma } = await import("@/lib/db");

    const access = await resolveChannelAccess(channelId, session.userId);
    if (!access?.canView) {
      return NextResponse.json(
        { error: "Not authorized to view this channel" },
        { status: 403 },
      );
    }

    const messages = await prisma.message.findMany({
      where: {
        channelId,
        ...(pinned === "true" ? { pinned: true } : {}),
        parentMessageId: pinned === "true" ? null : (parentId ?? null),
      },
      include: {
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
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    // Group reactions by emoji per message
    const messagesWithGroupedReactions = messages.map((m) => {
      const grouped: Record<string, { count: number; users: string[]; userIds: string[] }> = {};
      for (const r of m.reactions) {
        if (!grouped[r.emoji]) grouped[r.emoji] = { count: 0, users: [], userIds: [] };
        grouped[r.emoji].count++;
        grouped[r.emoji].users.push(r.user.username);
        grouped[r.emoji].userIds.push(r.userId);
      }
      return { ...m, reactions: grouped };
    });

    return NextResponse.json({
      messages: messagesWithGroupedReactions.reverse(),
      nextCursor: messages.length === limit ? messages[0]?.id : null,
    });
  } catch (err) {
    console.error("[Campfire] Failed to fetch messages:", err);
    return NextResponse.json({ messages: [], nextCursor: null });
  }
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { allowed, remaining, resetAt } = checkRateLimit(`msg:${session.userId}`);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      {
        status: 429,
        headers: {
          "X-RateLimit-Limit": String(30),
          "X-RateLimit-Remaining": String(remaining),
          "X-RateLimit-Reset": String(Math.ceil(resetAt / 1000)),
          "Retry-After": String(Math.ceil((resetAt - Date.now()) / 1000)),
        },
      }
    );
  }

  const {
    channelId,
    content,
    attachmentId: rawAttachmentId,
    attachmentUrl,
    attachmentName,
    replyToId,
    parentMessageId,
  } = await request.json();
  if (
    rawAttachmentId !== undefined &&
    (typeof rawAttachmentId !== "string" || !rawAttachmentId.trim())
  ) {
    return NextResponse.json({ error: "Invalid attachment" }, { status: 400 });
  }
  const attachmentId =
    typeof rawAttachmentId === "string" ? rawAttachmentId.trim() : null;
  const remoteAttachment = parseRemoteAttachmentUrl(attachmentUrl);
  if (!remoteAttachment.ok) {
    return NextResponse.json(
      { error: "Local upload URLs cannot be attached to new messages" },
      { status: 400 },
    );
  }
  if (attachmentId && remoteAttachment.url) {
    return NextResponse.json({ error: "Choose one attachment" }, { status: 400 });
  }
  if (
    !channelId ||
    (!(typeof content === "string" && content.trim()) &&
      !attachmentId &&
      !remoteAttachment.url)
  ) {
    return NextResponse.json(
      { error: "channelId and content or attachment are required" },
      { status: 400 }
    );
  }

  // Bound content length to avoid unbounded TEXT writes.
  if (typeof content === "string" && content.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json(
      { error: `Message too long (max ${MAX_MESSAGE_LENGTH} characters)` },
      { status: 400 }
    );
  }

  try {
    const { prisma } = await import("@/lib/db");

    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { serverId: true, slowModeSeconds: true },
    });

    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    const access = await resolveChannelAccess(channelId, session.userId);
    if (!access?.canSend) {
      return NextResponse.json(
        { error: "Not authorized to send messages in this channel" },
        { status: 403 },
      );
    }

    const references = [replyToId, parentMessageId].filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    );
    if (
      (replyToId !== undefined && !references.includes(replyToId)) ||
      (parentMessageId !== undefined && !references.includes(parentMessageId))
    ) {
      return NextResponse.json({ error: "Invalid message reference" }, { status: 400 });
    }
    if (references.length > 0) {
      const uniqueReferences = [...new Set(references)];
      const referencedMessages = await prisma.message.findMany({
        where: { id: { in: uniqueReferences } },
        select: { id: true, channelId: true },
      });
      if (
        referencedMessages.length !== uniqueReferences.length ||
        referencedMessages.some((message) => message.channelId !== channelId)
      ) {
        return NextResponse.json(
          { error: "Referenced messages must belong to this channel" },
          { status: 400 },
        );
      }
    }

    // Slow mode check
    if (channel.slowModeSeconds > 0) {
      const lastMessage = await prisma.message.findFirst({
        where: { channelId, authorId: session.userId },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });

      if (lastMessage) {
        const elapsed = (Date.now() - new Date(lastMessage.createdAt).getTime()) / 1000;
        const remaining = Math.ceil(channel.slowModeSeconds - elapsed);
        if (remaining > 0) {
          return NextResponse.json(
            { error: `Slow mode: wait ${remaining} seconds`, remaining },
            { status: 429 }
          );
        }
      }
    }

    const messageId = randomUUID();
    const message = await prisma.$transaction(async (tx) => {
      let attachmentData: {
        attachmentUrl?: string;
        attachmentName?: string | null;
        privateUploadId?: string;
      } = {};
      if (attachmentId) {
        const upload = await claimPrivateUpload(tx, {
          attachmentId,
          ownerId: session.userId,
          claimKind: "channel-message",
          claimId: messageId,
        });
        attachmentData = {
          attachmentUrl: privateAttachmentUrl(upload.id),
          attachmentName: upload.originalName,
          privateUploadId: upload.id,
        };
      } else if (remoteAttachment.url) {
        attachmentData = {
          attachmentUrl: remoteAttachment.url,
          attachmentName:
            typeof attachmentName === "string" ? attachmentName.slice(0, 255) : null,
        };
      }
      return tx.message.create({
        data: {
          id: messageId,
          channelId,
          authorId: session.userId,
          content: content?.trim() || "",
          ...attachmentData,
          ...(replyToId ? { replyToId } : {}),
          ...(parentMessageId ? { parentMessageId } : {}),
        },
        include: {
          author: { select: { id: true, username: true, avatar: true } },
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
        },
      });
    });

    return NextResponse.json({ message }, { status: 201 });
  } catch (err) {
    if (err instanceof PrivateUploadClaimError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[Campfire] Failed to save message:", err);
    return NextResponse.json(
      { error: "Database unavailable. Check the server's database connection (DATABASE_URL)." },
      { status: 503 }
    );
  }
}
