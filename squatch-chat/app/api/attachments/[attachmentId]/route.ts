import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { resolveChannelAccess } from "@/lib/channelAccess";
import { prisma } from "@/lib/db";
import {
  parseSingleByteRange,
  privateContentDisposition,
  resolvePrivateUploadPath,
} from "@/lib/privateUploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ attachmentId: string }>;
}

async function canReadAttachment(
  attachment: {
    ownerId: string;
    state: string;
    message: { channelId: string } | null;
    directMessage: {
      conversation: { user1Id: string; user2Id: string };
    } | null;
    journalEntries: { id: string }[];
  },
  userId: string,
): Promise<boolean> {
  if (attachment.state === "pending" && attachment.ownerId === userId) return true;
  if (attachment.journalEntries.length > 0) return true;
  if (attachment.directMessage) {
    const conversation = attachment.directMessage.conversation;
    if (conversation.user1Id === userId || conversation.user2Id === userId) return true;
  }
  if (attachment.message) {
    const access = await resolveChannelAccess(attachment.message.channelId, userId);
    return Boolean(access?.canView);
  }
  return false;
}

async function serveAttachment(
  request: NextRequest,
  context: RouteContext,
  headOnly: boolean,
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { attachmentId } = await context.params;
  const attachment = await prisma.privateUpload.findUnique({
    where: { id: attachmentId },
    include: {
      message: { select: { channelId: true } },
      directMessage: {
        select: {
          conversation: { select: { user1Id: true, user2Id: true } },
        },
      },
      journalEntries: {
        where: { authorId: session.userId },
        take: 1,
        select: { id: true },
      },
    },
  });
  if (!attachment || !(await canReadAttachment(attachment, session.userId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const filePath = resolvePrivateUploadPath(attachment.storageKey);
  if (!filePath) return NextResponse.json({ error: "Not found" }, { status: 404 });
  let fileStat;
  try {
    fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error("Not a file");
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const range = parseSingleByteRange(request.headers.get("range"), fileStat.size);
  const baseHeaders = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "Content-Disposition": privateContentDisposition(attachment.originalName),
    "Content-Type": attachment.contentType || "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
  });
  if (range === "unsatisfiable") {
    baseHeaders.set("Content-Range", `bytes */${fileStat.size}`);
    return new Response(null, { status: 416, headers: baseHeaders });
  }

  const start = range?.start ?? 0;
  const end = range?.end ?? Math.max(0, fileStat.size - 1);
  const contentLength = range ? end - start + 1 : fileStat.size;
  baseHeaders.set("Content-Length", String(contentLength));
  if (range) baseHeaders.set("Content-Range", `bytes ${start}-${end}/${fileStat.size}`);
  if (headOnly || fileStat.size === 0) {
    return new Response(null, { status: range ? 206 : 200, headers: baseHeaders });
  }

  const nodeStream = createReadStream(filePath, range ? { start, end } : undefined);
  const body = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
  return new Response(body, { status: range ? 206 : 200, headers: baseHeaders });
}

export function GET(request: NextRequest, context: RouteContext) {
  return serveAttachment(request, context, false);
}

export function HEAD(request: NextRequest, context: RouteContext) {
  return serveAttachment(request, context, true);
}
