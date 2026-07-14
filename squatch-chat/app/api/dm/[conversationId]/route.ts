import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { usersHaveBlock } from "@/lib/userBlocks";
import {
  claimPrivateUpload,
  parseRemoteAttachmentUrl,
  privateAttachmentUrl,
  PrivateUploadClaimError,
} from "@/lib/privateUploads";

// GET — fetch messages for a conversation
export async function GET(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { conversationId } = await params;
  const url = new URL(request.url);
  const before = url.searchParams.get("before");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 100);

  try {
    const { prisma } = await import("@/lib/db");

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (conversation.user1Id !== session.userId && conversation.user2Id !== session.userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const messages = await prisma.directMessage.findMany({
      where: {
        conversationId,
        ...(before ? { createdAt: { lt: new Date(before) } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        author: { select: { id: true, username: true, avatar: true } },
      },
    });

    return NextResponse.json({ messages: messages.reverse() });
  } catch (err) {
    console.error("[Campfire] Failed to fetch DMs:", err);
    return NextResponse.json({ error: "Database error" }, { status: 503 });
  }
}

// POST — send a message in conversation
export async function POST(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { conversationId } = await params;
  const {
    content,
    attachmentId: rawAttachmentId,
    attachmentUrl,
    attachmentName,
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
      { error: "Local upload URLs cannot be attached to new direct messages" },
      { status: 400 },
    );
  }
  if (attachmentId && remoteAttachment.url) {
    return NextResponse.json({ error: "Choose one attachment" }, { status: 400 });
  }

  if (
    !(typeof content === "string" && content.trim()) &&
    !attachmentId &&
    !remoteAttachment.url
  ) {
    return NextResponse.json({ error: "Empty message" }, { status: 400 });
  }

  try {
    const { prisma } = await import("@/lib/db");

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (conversation.user1Id !== session.userId && conversation.user2Id !== session.userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const otherUserId = conversation.user1Id === session.userId
      ? conversation.user2Id
      : conversation.user1Id;
    if (await usersHaveBlock(session.userId, otherUserId)) {
      return NextResponse.json(
        { error: "Direct messages are unavailable between these users" },
        { status: 403 },
      );
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
          claimKind: "direct-message",
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
      const created = await tx.directMessage.create({
        data: {
          id: messageId,
          conversationId,
          authorId: session.userId,
          content: content?.trim() || "",
          ...attachmentData,
        },
        include: {
          author: { select: { id: true, username: true, avatar: true } },
        },
      });
      await tx.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });
      return created;
    });

    return NextResponse.json({ message });
  } catch (err) {
    if (err instanceof PrivateUploadClaimError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[Campfire] Failed to send DM:", err);
    return NextResponse.json({ error: "Database error" }, { status: 503 });
  }
}
