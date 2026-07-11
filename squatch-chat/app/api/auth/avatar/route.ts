import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { writeFile, mkdir, unlink } from "fs/promises";
import path from "path";

const AVATAR_DIR = path.join(process.cwd(), "public", "avatars");
const MAX_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get("avatar") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Invalid file type. Use JPEG, PNG, GIF, or WebP." },
        { status: 400 }
      );
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 2MB." },
        { status: 400 }
      );
    }

    const ext = file.type.split("/")[1] === "jpeg" ? "jpg" : file.type.split("/")[1];
    const filename = `${session.userId}.${ext}`;
    const filepath = path.join(AVATAR_DIR, filename);

    // Ensure directory exists
    await mkdir(AVATAR_DIR, { recursive: true });

    // Remove any old avatar with different extension
    for (const oldExt of ["jpg", "png", "gif", "webp"]) {
      if (oldExt === ext) continue;
      try {
        await unlink(path.join(AVATAR_DIR, `${session.userId}.${oldExt}`));
      } catch {
        // File doesn't exist — fine
      }
    }

    // Write file
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filepath, buffer);

    const avatarUrl = `/avatars/${filename}`;

    // Update database
    try {
      const { prisma } = await import("@/lib/db");
      await prisma.user.update({
        where: { id: session.userId },
        data: { avatar: avatarUrl },
      });
    } catch {
      // DB unavailable — file is saved, avatar URL won't persist in DB
    }

    return NextResponse.json({ avatar: avatarUrl });
  } catch (err) {
    console.error("[Campfire] Avatar upload error:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Remove avatar files
    for (const ext of ["jpg", "png", "gif", "webp"]) {
      try {
        await unlink(path.join(AVATAR_DIR, `${session.userId}.${ext}`));
      } catch {
        // File doesn't exist
      }
    }

    // Clear in database
    try {
      const { prisma } = await import("@/lib/db");
      await prisma.user.update({
        where: { id: session.userId },
        data: { avatar: null },
      });
    } catch {
      // DB unavailable
    }

    return NextResponse.json({ avatar: null });
  } catch (err) {
    console.error("[Campfire] Avatar delete error:", err);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
