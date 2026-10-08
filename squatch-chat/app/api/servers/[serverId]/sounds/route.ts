import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getPermContext } from "@/lib/serverRoles";
import { checkWeightedLimit } from "@/lib/rateLimit";

const MAX_DATAURL = 900_000; // ~900KB base64 — comfortably covers an 8s clip
const MAX_SOUNDS_PER_SERVER = 50;
const SOUND_UPLOADS_PER_HOUR = 10;
const HOUR_MS = 60 * 60 * 1000;

// GET — list a server's uploaded soundboard sounds (any member). Built-in sounds
// are static client-side; this only returns custom uploads.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ serverId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { serverId } = await params;

  const ctx = await getPermContext(serverId, session.userId);
  if (!ctx.isMember) return NextResponse.json({ error: "Not a server member" }, { status: 403 });

  const sounds = await prisma.sound.findMany({
    where: { serverId },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, emoji: true, dataUrl: true, createdBy: true },
  });
  return NextResponse.json({ sounds });
}

// POST — upload a sound (any member). Body: { name, emoji?, dataUrl }.
export async function POST(req: NextRequest, { params }: { params: Promise<{ serverId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { serverId } = await params;

  const ctx = await getPermContext(serverId, session.userId);
  if (!ctx.isMember) return NextResponse.json({ error: "Not a server member" }, { status: 403 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const dataUrl = body.dataUrl ?? "";
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:audio/")) {
    return NextResponse.json({ error: "An audio file is required" }, { status: 400 });
  }
  if (dataUrl.length > MAX_DATAURL) {
    return NextResponse.json({ error: "Clip too large — keep it under ~8 seconds" }, { status: 413 });
  }

  // Every clip is stored inline and shipped to every member's soundboard, so
  // both the per-server total and the per-uploader rate are bounded.
  if ((await prisma.sound.count({ where: { serverId } })) >= MAX_SOUNDS_PER_SERVER) {
    return NextResponse.json(
      { error: `This server already has ${MAX_SOUNDS_PER_SERVER} sounds — remove one first` },
      { status: 409 },
    );
  }
  const rate = checkWeightedLimit(`sound-upload:${session.userId}`, 1, SOUND_UPLOADS_PER_HOUR, HOUR_MS);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many sound uploads. Try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((rate.resetAt - Date.now()) / 1000)) },
      },
    );
  }

  const sound = await prisma.sound.create({
    data: {
      serverId,
      name: name.slice(0, 24),
      emoji: typeof body.emoji === "string" && body.emoji.trim() ? body.emoji.trim().slice(0, 8) : "🔊",
      dataUrl,
      createdBy: session.userId,
    },
    select: { id: true, name: true, emoji: true, dataUrl: true, createdBy: true },
  });
  return NextResponse.json({ sound }, { status: 201 });
}
