import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { normalizeVoiceRoomConfig } from "@/lib/voiceRoomConfig";
import {
  removeUnreferencedPrivateUpload,
  removeUnreferencedUpload,
} from "@/lib/messageRetention";
import { notifyRealtimeAuthorizationChange } from "@/lib/realtimeControl";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { channelId } = await params;

  try {
    const { prisma } = await import("@/lib/db");

    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      include: { server: { select: { ownerId: true } } },
    });
    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    const { memberHasPermission } = await import("@/lib/serverRoles");
    if (!(await memberHasPermission(channel.serverId, session.userId, "MANAGE_CHANNELS"))) {
      return NextResponse.json(
        { error: "You need the Manage Channels permission to update channels" },
        { status: 403 },
      );
    }

    const body = await req.json();

    let name: string | undefined;
    if ("name" in body) {
      if (typeof body.name !== "string" || !body.name.trim()) {
        return NextResponse.json({ error: "Channel name cannot be empty" }, { status: 400 });
      }
      name = body.name.trim().toLowerCase().replace(/\s+/g, "-");
    }


    let roomConfig: ReturnType<typeof normalizeVoiceRoomConfig> | undefined;
    if ("roomMode" in body || "roomScene" in body) {
      if (channel.type !== "voice") {
        return NextResponse.json({ error: "Room modes only apply to voice channels" }, { status: 400 });
      }
      roomConfig = normalizeVoiceRoomConfig({
        mode: "roomMode" in body ? body.roomMode : channel.roomMode,
        scene: "roomScene" in body ? body.roomScene : channel.roomScene,
      });
      if (!roomConfig) {
        return NextResponse.json({ error: "Invalid voice-room mode or scene" }, { status: 400 });
      }
    }

    let retentionDays: number | null | undefined;
    if ("retentionDays" in body) {
      if (channel.type === "voice") {
        return NextResponse.json({ error: "Message retention only applies to text channels" }, { status: 400 });
      }
      if (body.retentionDays === null) {
        retentionDays = null;
      } else if (
        typeof body.retentionDays === "number" &&
        Number.isInteger(body.retentionDays) &&
        [1, 7, 30].includes(body.retentionDays)
      ) {
        retentionDays = body.retentionDays;
      } else {
        return NextResponse.json({ error: "Retention must be forever, 1, 7, or 30 days" }, { status: 400 });
      }
    }
    const updated = await prisma.channel.update({
      where: { id: channelId },
      data: {

        topic: "topic" in body
          ? (typeof body.topic === "string" ? body.topic.trim() || null : null)
          : undefined,
        name,
        category: "category" in body
          ? (typeof body.category === "string" && body.category.trim() ? body.category.trim() : null)
          : undefined,
        roomMode: roomConfig?.roomMode,
        roomScene: roomConfig?.roomScene,
        retentionDays,
      },
    });

    return NextResponse.json({ channel: updated });
  } catch (err) {
    console.error("[Campfire] Failed to update channel:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { channelId } = await params;

  try {
    const { prisma } = await import("@/lib/db");

    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: {
        id: true,
        serverId: true,
      },
    });
    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    const membership = await prisma.serverMember.findUnique({
      where: { serverId_userId: { serverId: channel.serverId, userId: session.userId } },
    });
    if (!membership) {
      return NextResponse.json({ error: "Not a server member" }, { status: 403 });
    }

    // Requires the Manage Channels permission (same gate as channel creation).
    const { memberHasPermission } = await import("@/lib/serverRoles");
    if (!(await memberHasPermission(channel.serverId, session.userId, "MANAGE_CHANNELS"))) {
      return NextResponse.json({ error: "You need the Manage Channels permission to delete channels" }, { status: 403 });
    }

    // No DB-level cascade from Channel — clear dependents explicitly.
    // (Reactions/pins cascade off Message at the DB level.)
    const attachments = await prisma.$transaction(async (tx) => {
      const messages = await tx.message.findMany({
        where: { channelId },
        select: { attachmentUrl: true, privateUploadId: true },
      });
      await tx.notificationPreference.deleteMany({ where: { channelId } });
      await tx.scheduledMessage.deleteMany({ where: { channelId } });
      await tx.webhook.deleteMany({ where: { channelId } });
      await tx.message.deleteMany({ where: { channelId } });
      await tx.channel.delete({ where: { id: channelId } });
      return {
        attachmentUrls: [...new Set(
          messages
            .map((message) => message.attachmentUrl)
            .filter((url): url is string => Boolean(url)),
        )],
        privateUploadIds: [...new Set(
          messages
            .map((message) => message.privateUploadId)
            .filter((id): id is string => Boolean(id)),
        )],
      };
    });
    const sideEffects = await Promise.allSettled([
      notifyRealtimeAuthorizationChange({ scope: "channel", channelId }),
      ...attachments.attachmentUrls.map(removeUnreferencedUpload),
      ...attachments.privateUploadIds.map(removeUnreferencedPrivateUpload),
    ]);
    for (const result of sideEffects) {
      if (result.status === "rejected") {
        console.error("[Campfire] Post-delete channel cleanup failed:", result.reason);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Campfire] Failed to delete channel:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
