import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { resolveChannelAccess } from "@/lib/channelAccess";
import { memberHasPermission } from "@/lib/serverRoles";
import {
  cleanupDeletedMessageUploads,
  collectThreadReplies,
} from "@/lib/messageRetention";
import { MAX_MESSAGE_LENGTH } from "@/lib/inputLimits";
import { channelMessageInclude, toChannelMessagePayload } from "@/lib/messagePayload";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { messageId } = await params;

  try {
    const { prisma } = await import("@/lib/db");

    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: {
        author: { select: { id: true, username: true, avatar: true } },
      },
    });

    if (!message) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Authorization: only members of the message's channel/server may read it.
    // Returning 404 (not 403) avoids leaking the existence of the message.
    const access = await resolveChannelAccess(message.channelId, session.userId);
    if (!access?.canView) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ message });
  } catch (err) {
    console.error("[Campfire] Failed to fetch message:", err);
    return NextResponse.json({ error: "Failed to fetch message" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { messageId } = await params;
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const { prisma } = await import("@/lib/db");

    const message = await prisma.message.findUnique({
      where: { id: messageId },
      select: {
        authorId: true,
        channelId: true,
        channel: { select: { serverId: true } },
      },
    });

    if (!message) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }


    // Apply the same visibility decision to reads and mutations. Banned
    // members, including authors and moderators, resolve to no access.
    const access = await resolveChannelAccess(message.channelId, session.userId);
    if (!access?.canView) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    // Handle pin toggle — allowed for server owner, admin, and mod
    if ("pinned" in body) {
      if (typeof body.pinned !== "boolean") {
        return NextResponse.json({ error: "Pinned must be a boolean" }, { status: 400 });
      }
      const canPin = await memberHasPermission(
        message.channel.serverId,
        session.userId,
        "MANAGE_MESSAGES",
      );
      if (!canPin) {
        return NextResponse.json({ error: "No permission to pin" }, { status: 403 });
      }
      const updated = await prisma.message.update({
        where: { id: messageId },
        data: { pinned: body.pinned },
        include: channelMessageInclude,
      });
      return NextResponse.json({ message: toChannelMessagePayload(updated) });
    }

    if (!access.canSend) {
      return NextResponse.json({ error: "Channel is read only" }, { status: 403 });
    }

    // Handle content edit — author only
    const { content } = body;
    if (typeof content !== "string" || !content.trim()) {
      return NextResponse.json({ error: "Content is required" }, { status: 400 });
    }
    if (content.length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json(
        { error: `Message too long (max ${MAX_MESSAGE_LENGTH} characters)` },
        { status: 400 },
      );
    }
    if (message.authorId !== session.userId) {
      return NextResponse.json({ error: "Not your message" }, { status: 403 });
    }
    const updated = await prisma.message.update({
      where: { id: messageId },
      data: { content: content.trim(), editedAt: new Date() },
      include: channelMessageInclude,
    });
    return NextResponse.json({ message: toChannelMessagePayload(updated) });
  } catch (err) {
    console.error("[Campfire] Failed to edit message:", err);
    return NextResponse.json({ error: "Failed to edit message" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { messageId } = await params;

  try {
    const { prisma } = await import("@/lib/db");

    const message = await prisma.message.findUnique({
      where: { id: messageId },
      select: {
        authorId: true,
        channelId: true,
        attachmentUrl: true,
        privateUploadId: true,
      },
    });

    if (!message) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    const access = await resolveChannelAccess(message.channelId, session.userId);
    if (!access?.canView) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }


    // Author or server owner can delete
    // Effective MANAGE_MESSAGES permission also covers moderators and custom roles.
    const isAuthor = message.authorId === session.userId;
    const canManageMessages = isAuthor
      ? false
      : await memberHasPermission(
          access.serverId,
          session.userId,
          "MANAGE_MESSAGES",
        );

    if (!isAuthor && !canManageMessages) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    // Thread replies go with their parent (reactions, bookmarks, and polls
    // cascade off each row; Journal snapshots keep their copy). Authors can only
    // take a thread down with them when every reply is theirs — other members'
    // replies need MANAGE_MESSAGES.
    const outcome = await prisma.$transaction(async (tx) => {
      const replies = await collectThreadReplies(tx, [messageId]);
      const replyIds = replies.map((reply) => reply.id);
      if (isAuthor && replyIds.length > 0) {
        const othersReplied = await tx.message.count({
          where: { id: { in: replyIds }, authorId: { not: session.userId } },
        });
        if (
          othersReplied > 0 &&
          !(await memberHasPermission(access.serverId, session.userId, "MANAGE_MESSAGES"))
        ) {
          return null;
        }
      }
      await tx.message.deleteMany({ where: { id: { in: [messageId, ...replyIds] } } });
      return [{ id: messageId, ...message }, ...replies];
    });
    if (!outcome) {
      return NextResponse.json(
        { error: "Others have replied in this thread, so only a moderator can delete it. You can edit it instead." },
        { status: 409 },
      );
    }
    const deleted = outcome;
    await cleanupDeletedMessageUploads(deleted);

    return NextResponse.json({
      deleted: true,
      messageId,
      channelId: message.channelId,
      deletedMessageIds: deleted.map((row) => row.id),
    });
  } catch (err) {
    console.error("[Campfire] Failed to delete message:", err);
    return NextResponse.json({ error: "Failed to delete message" }, { status: 500 });
  }
}
