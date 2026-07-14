import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { normalizeVoiceRoomConfig } from "@/lib/voiceRoomConfig";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { serverId, name, type, description, category, roomMode, roomScene } = await request.json();
  if (!serverId || !name || !name.trim()) {
    return NextResponse.json(
      { error: "Server ID and channel name are required" },
      { status: 400 }
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

    const channel = await prisma.channel.create({
      data: {
        serverId,
        name: name.trim().toLowerCase().replace(/\s+/g, "-"),
        type: channelType,
        ...(description?.trim() ? { description: description.trim() } : {}),
        ...(category?.trim() ? { category: category.trim() } : {}),
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
        serverId: true,
        createdAt: true,
      },
    });

    // Post welcome system message for text channels
    if (channelType === "text") {
      await prisma.message.create({
        data: {
          channelId: channel.id,
          authorId: session.userId,
          content: `Welcome to #${channel.name}!`,
          isSystem: true,
        },
      });
    }

    return NextResponse.json({ channel }, { status: 201 });
  } catch (err) {
    console.error("[Campfire] Failed to create channel:", err);
    return NextResponse.json(
      { error: "Database unavailable. Check the server's database connection (DATABASE_URL)." },
      { status: 503 }
    );
  }
}
