import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { assertFeature } from "@/lib/features";
import { requireMembership } from "@/lib/membership";
import { memberHasPermission } from "@/lib/serverRoles";
import { removeUnreferencedUpload } from "@/lib/messageRetention";

// GET: list custom emoji for a server
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ serverId: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { serverId } = await params;

  if (!(await requireMembership(serverId, session.userId))) {
    return NextResponse.json({ error: "No permission" }, { status: 403 });
  }

  const emojis = await prisma.customEmoji.findMany({
    where: { serverId },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ emojis });
}

// POST: create a new custom emoji
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ serverId: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { serverId } = await params;
  const { name, url } = await req.json();

  if (!name || !url) {
    return NextResponse.json({ error: "Name and URL required" }, { status: 400 });
  }

  if (!/^[a-zA-Z0-9_]+$/.test(name)) {
    return NextResponse.json({ error: "Name must be alphanumeric" }, { status: 400 });
  }

  if (!(await memberHasPermission(serverId, session.userId, "MANAGE_EMOJIS"))) {
    return NextResponse.json({ error: "No permission" }, { status: 403 });
  }

  // Premium feature gate
  if (!(await assertFeature(session.userId, "custom_emoji"))) {
    return NextResponse.json({ error: "Upgrade required" }, { status: 403 });
  }

  // Check limit (50 per server)
  const count = await prisma.customEmoji.count({ where: { serverId } });
  if (count >= 50) {
    return NextResponse.json({ error: "Max 50 custom emoji per server" }, { status: 400 });
  }

  const emoji = await prisma.customEmoji.create({
    data: {
      name,
      url,
      serverId,
      createdBy: session.userId,
    },
  });

  return NextResponse.json({ emoji }, { status: 201 });
}

// DELETE: remove a custom emoji
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ serverId: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { serverId } = await params;
  const emojiId = req.nextUrl.searchParams.get("id");
  if (!emojiId) return NextResponse.json({ error: "Emoji ID required" }, { status: 400 });

  if (!(await memberHasPermission(serverId, session.userId, "MANAGE_EMOJIS"))) {
    return NextResponse.json({ error: "No permission" }, { status: 403 });
  }

  // Cross-tenant IDOR guard: the emoji must belong to this server.
  const emoji = await prisma.customEmoji.findUnique({ where: { id: emojiId } });
  if (!emoji || emoji.serverId !== serverId) {
    return NextResponse.json({ error: "Emoji not found" }, { status: 404 });
  }

  await prisma.customEmoji.delete({ where: { id: emojiId } });
  await removeUnreferencedUpload(emoji.url);

  return NextResponse.json({ deleted: true });
}
