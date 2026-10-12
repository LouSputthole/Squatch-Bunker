import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { normalizeVoiceRoomConfig } from "@/lib/voiceRoomConfig";
import { MAX_CHANNEL_DESCRIPTION_LENGTH, parseChannelName } from "@/lib/inputLimits";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { serverId, name: rawName, type, description, category, roomMode, roomScene } = await request.json();
  if (!serverId || typeof rawName !== "string" || !rawName.trim()) {
    return NextResponse.json(
      { error: "Server ID and channel name are required" },
      { status: 400 }
    );
  }
  const name = parseChannelName(rawName);
  if (!name.ok) {
    return NextResponse.json({ error: name.error }, { status: 400 });
  }
  if (description !== undefined && description !== null && typeof description !== "string") {
    return NextResponse.json({ error: "Description must be a string" }, { status: 400 });
  }
  if (typeof description === "string" && description.trim().length > MAX_CHANNEL_DESCRIPTION_LENGTH) {
    return NextResponse.json(
      { error: `Description must be at most ${MAX_CHANNEL_DESCRIPTION_LENGTH} characters` },
      { status: 400 },
    );
  }

  const channelType = type === "voice" ? "voice" : "text";

  const roomConfig = channelType === "voice"
    ? normalizeVoiceRoomConfig({ mode: roomMode, scene: roomScene })
    : { roomMode: "hangout" as const, roomScene: "campfire" as const };
  if (!roomConfig) {
    return NextResponse.json(
      { error: "Invalid voice-room mode or scene" },
      { status: 400 },
    );
  }
  try {
    const { prisma } = await import("@/lib/db");

    const membership = await prisma.serverMember.findUnique({
      where: { serverId_userId: { serverId, userId: session.userId } },
    });

    if (!membership) {
      return NextResponse.json({ error: "Not a server member" }, { status: 403 });
    }

    // Requires the Manage Channels permission (owner/admin have it by default;
    // grant it via a custom role to let others create channels).
    const { memberHasPermission } = await import("@/lib/serverRoles");
    if (!(await memberHasPermission(serverId, session.userId, "MANAGE_CHANNELS"))) {
      return NextResponse.json({ error: "You need the Manage Channels permission to create channels" }, { status: 403 });
    }

    // Append after the server's current last channel.
    const last = await prisma.channel.aggregate({
      where: { serverId },
      _max: { position: true },
    });
    const channel = await prisma.channel.create({
      data: {
        serverId,
        name: name.value,
        type: channelType,
        position: last._max.position === null ? 0 : last._max.position + 1,
        ...(description?.trim() ? { description: description.trim() } : {}),
        ...(typeof category === "string" && category.trim() ? { category: category.trim().slice(0, 100) } : {}),
        roomMode: roomConfig.roomMode,
        roomScene: roomConfig.roomScene,
      },
      select: {
        id: true,
        roomMode: true,
        roomScene: true,
        name: true,
        type: true,
        category: true,
        description: true,
        position: true,
        slowModeSeconds: true,
        serverId: true,
        createdAt: true,
      },
    });
    await prisma.auditLog.create({
      data: {
        serverId,
        actorId: session.userId,
        action: "channel_create",
        detail: `Created ${channelType} channel #${channel.name}`,
      },
    });

    return NextResponse.json({ channel }, { status: 201 });
  } catch (err) {
    console.error("[Campfire] Failed to create channel:", err);
    return NextResponse.json(
      { error: "Database unavailable. Check the server's database connection (DATABASE_URL)." },
      { status: 503 }
    );
  }
}
