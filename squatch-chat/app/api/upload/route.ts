import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTier, hasFeature } from "@/lib/features";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import crypto from "crypto";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
const FREE_MAX_SIZE = 10 * 1024 * 1024; // 10MB (free tier)
const PREMIUM_MAX_SIZE = 100 * 1024 * 1024; // 100MB (premium "extended_upload")
// Headroom for multipart envelope (boundaries, headers, filename) so a file at
// exactly the cap isn't rejected by the raw body-size gate.
const MULTIPART_OVERHEAD = 64 * 1024; // 64KB

const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "application/zip": "zip",
};

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Resolve the uploader's effective tier and pick a size cap. Premium (and
    // self-hosted) unlock the "extended_upload" feature for a larger limit.
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { tier: true, tierExpiresAt: true },
    });
    const maxSize = hasFeature(getTier(user), "extended_upload")
      ? PREMIUM_MAX_SIZE
      : FREE_MAX_SIZE;
    const maxLabel = `${Math.round(maxSize / (1024 * 1024))}MB`;
    const byteCap = maxSize + MULTIPART_OVERHEAD;

    // Reject oversized uploads BEFORE buffering the body into memory. The
    // Content-Length header is the fast path; the streaming cap below defends
    // against a missing or lying header.
    const declaredLength = Number(req.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > byteCap) {
      return NextResponse.json(
        { error: `File too large. Maximum size is ${maxLabel}.` },
        { status: 413 }
      );
    }

    // Read the raw body with a hard byte cap so a huge upload can't exhaust
    // memory even when Content-Length is absent or understated.
    let formData: FormData;
    const body = req.body;
    if (body) {
      const reader = body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        received += value.byteLength;
        if (received > byteCap) {
          await reader.cancel();
          return NextResponse.json(
            { error: `File too large. Maximum size is ${maxLabel}.` },
            { status: 413 }
          );
        }
        chunks.push(value);
      }
      formData = await new Response(Buffer.concat(chunks), {
        headers: { "content-type": req.headers.get("content-type") ?? "" },
      }).formData();
    } else {
      formData = await req.formData();
    }

    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (file.size > maxSize) {
      return NextResponse.json(
        { error: `File too large. Maximum size is ${maxLabel}.` },
        { status: 413 }
      );
    }

    const ext = ALLOWED_TYPES[file.type];
    if (!ext) {
      return NextResponse.json({ error: "File type not allowed." }, { status: 400 });
    }

    await mkdir(UPLOAD_DIR, { recursive: true });

    const hash = crypto.randomBytes(8).toString("hex");
    const filename = `${hash}.${ext}`;
    const filepath = path.join(UPLOAD_DIR, filename);

    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filepath, buffer);

    return NextResponse.json({
      url: `/uploads/${filename}`,
      name: file.name,
      type: file.type,
      size: file.size,
    });
  } catch (err) {
    console.error("[Campfire] Upload error:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
