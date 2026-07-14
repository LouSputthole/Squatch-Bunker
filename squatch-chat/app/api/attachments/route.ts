import crypto from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTier, hasFeature } from "@/lib/features";
import {
  getPrivateUploadRoot,
  privateAttachmentUrl,
  resolvePrivateUploadPath,
} from "@/lib/privateUploads";
import { checkWeightedLimit } from "@/lib/rateLimit";
import { evaluateUploadPolicy } from "@/lib/uploadPolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FREE_MAX_SIZE = 10 * 1024 * 1024;
const PREMIUM_MAX_SIZE = 100 * 1024 * 1024;
const UPLOADS_PER_HOUR = 30;
const UPLOAD_BYTES_PER_HOUR = 500 * 1024 * 1024;
const HOUR_MS = 60 * 60 * 1000;
const MULTIPART_OVERHEAD = 64 * 1024;

async function boundedFormData(req: NextRequest, byteCap: number): Promise<FormData | null> {
  const declaredLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > byteCap) return null;

  if (!req.body) return req.formData();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    received += value.byteLength;
    if (received > byteCap) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new Response(Buffer.concat(chunks), {
    headers: { "content-type": req.headers.get("content-type") ?? "" },
  }).formData();
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let filePath: string | null = null;
  try {
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { tier: true, tierExpiresAt: true },
    });
    const maxSize = hasFeature(getTier(user), "extended_upload")
      ? PREMIUM_MAX_SIZE
      : FREE_MAX_SIZE;
    const maxLabel = `${Math.round(maxSize / (1024 * 1024))}MB`;
    const formData = await boundedFormData(req, maxSize + MULTIPART_OVERHEAD);
    if (!formData) {
      return NextResponse.json(
        { error: `File too large. Maximum size is ${maxLabel}.` },
        { status: 413 },
      );
    }

    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    const policy = evaluateUploadPolicy(file, maxSize);
    if (!policy.allowed) {
      return NextResponse.json({ error: policy.error }, { status: policy.status });
    }

    const countLimit = checkWeightedLimit(
      `upload-count:${session.userId}`,
      1,
      UPLOADS_PER_HOUR,
      HOUR_MS,
    );
    const bytesLimit = countLimit.allowed
      ? checkWeightedLimit(
          `upload-bytes:${session.userId}`,
          file.size,
          UPLOAD_BYTES_PER_HOUR,
          HOUR_MS,
        )
      : countLimit;
    if (!countLimit.allowed || !bytesLimit.allowed) {
      return NextResponse.json(
        { error: "Upload limit reached. Try again later." },
        { status: 429 },
      );
    }

    const attachmentId = crypto.randomUUID();
    const storageKey = `${crypto.randomBytes(16).toString("hex")}.${policy.extension}`;
    const uploadRoot = getPrivateUploadRoot();
    filePath = resolvePrivateUploadPath(storageKey, uploadRoot);
    if (!filePath) throw new Error("Generated an invalid private storage key");
    await mkdir(uploadRoot, { recursive: true });
    await writeFile(filePath, Buffer.from(await file.arrayBuffer()), { flag: "wx" });

    await prisma.privateUpload.create({
      data: {
        id: attachmentId,
        ownerId: session.userId,
        storageKey,
        originalName: path.basename(file.name).slice(0, 255) || "attachment",
        contentType: file.type.split(";", 1)[0].trim().toLowerCase(),
        byteSize: file.size,
      },
    });

    return NextResponse.json(
      {
        attachmentId,
        url: privateAttachmentUrl(attachmentId),
        name: file.name,
        type: file.type,
        size: file.size,
        kind: policy.kind,
      },
      { status: 201 },
    );
  } catch (error) {
    if (filePath) await unlink(filePath).catch(() => undefined);
    console.error("[Campfire] Private attachment upload failed:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
