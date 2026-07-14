import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { assertFeature } from "@/lib/features";
import { parseInviteRegeneration } from "@/lib/invites";
import {
  removeUnreferencedPrivateUpload,
  removeUnreferencedUpload,
} from "@/lib/messageRetention";
import { memberHasPermission } from "@/lib/serverRoles";
import { notifyRealtimeAuthorizationChange } from "@/lib/realtimeControl";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ serverId: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { serverId } = await params;
  const body = (await request.json()) as Record<string, unknown>;
  const { name, regenerateInvite, revokeInvite, icon, banner } = body;

  try {
    const { prisma } = await import("@/lib/db");

    const server = await prisma.server.findUnique({ where: { id: serverId } });
    if (!server) return NextResponse.json({ error: "Server not found" }, { status: 404 });
    if (!(await memberHasPermission(serverId, session.userId, "MANAGE_SERVER"))) {
      return NextResponse.json({ error: "Only the server owner can do this" }, { status: 403 });
    }

    if (regenerateInvite && revokeInvite) {
      return NextResponse.json(
        { error: "Regenerate and revoke are mutually exclusive" },
        { status: 400 },
      );
    }

    const updates: {
      name?: string;
      inviteCode?: string;
      inviteExpiresAt?: Date | null;
      inviteMaxUses?: number | null;
      inviteUseCount?: number;
      inviteRevokedAt?: Date | null;
      icon?: string | null;
      banner?: string | null;
    } = {};
    if (typeof name === "string" && name.trim()) updates.name = name.trim();
    if (typeof icon === "string") updates.icon = icon || null;
    if (regenerateInvite === true) {
      const settings = parseInviteRegeneration(body);
      if (!settings.ok) {
        return NextResponse.json({ error: settings.error }, { status: 400 });
      }

      updates.inviteCode = crypto.randomUUID();
      updates.inviteUseCount = 0;
      updates.inviteRevokedAt = null;
      if (settings.expiresAt !== undefined) {
        updates.inviteExpiresAt = settings.expiresAt;
      }
      if (settings.maxUses !== undefined) {
        updates.inviteMaxUses = settings.maxUses;
      }
    } else if (revokeInvite === true) {
      updates.inviteRevokedAt = new Date();
    }

    if ("banner" in body) {
      const nextBanner = typeof banner === "string" ? banner : null;
      // Setting a (non-empty) banner is a premium feature; clearing is allowed for anyone.
      if (nextBanner && !(await assertFeature(session.userId, "server_banner"))) {
        return NextResponse.json({ error: "Upgrade required" }, { status: 403 });
      }
      updates.banner = nextBanner || null;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const updated = await prisma.server.update({
      where: { id: serverId },
      data: updates,
      include: { channels: true, _count: { select: { members: true } } },
    });
    const replacedMedia = [
      updates.icon !== undefined && updates.icon !== server.icon
        ? server.icon
        : null,
      updates.banner !== undefined && updates.banner !== server.banner
        ? server.banner
        : null,
    ].filter((url): url is string => Boolean(url));
    await Promise.all(replacedMedia.map(removeUnreferencedUpload));

    return NextResponse.json({ server: updated });
  } catch (err) {
    console.error("[Campfire] Failed to update server:", err);
    return NextResponse.json({ error: "Database error" }, { status: 503 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ serverId: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { serverId } = await params;

  try {
    const { prisma } = await import("@/lib/db");

    const server = await prisma.server.findUnique({ where: { id: serverId } });
    if (!server) return NextResponse.json({ error: "Server not found" }, { status: 404 });
    if (server.ownerId !== session.userId) {
      return NextResponse.json({ error: "Only the server owner can do this" }, { status: 403 });
    }

    const { attachmentUrls, privateUploadIds, channelIds } = await prisma.$transaction(async (tx) => {
      const channels = await tx.channel.findMany({
        where: { serverId },
        select: { id: true },
      });
      const channelIds = channels.map((c) => c.id);
      const messages = channelIds.length
        ? await tx.message.findMany({
            where: { channelId: { in: channelIds } },
            select: { attachmentUrl: true, privateUploadId: true },
          })
        : [];
      const journalEntries = await tx.journalEntry.findMany({
        where: { serverId },
        select: { attachmentUrl: true, privateUploadId: true },
      });
      const [serverMedia, customEmojis] = await Promise.all([
        tx.server.findUnique({
          where: { id: serverId },
          select: { icon: true, banner: true },
        }),
        tx.customEmoji.findMany({
          where: { serverId },
          select: { url: true },
        }),
      ]);


      await tx.notificationPreference.deleteMany({
        where: {
          OR: [
            { serverId },
            { channelId: { in: channelIds } },
          ],
        },
      });
      if (channelIds.length > 0) {
        await tx.reaction.deleteMany({
          where: { message: { channelId: { in: channelIds } } },
        });
        // ScheduledMessage and Webhook FK channels but have no onDelete cascade,
        // so they must be removed before their channels.
        await tx.scheduledMessage.deleteMany({ where: { channelId: { in: channelIds } } });
        await tx.webhook.deleteMany({ where: { channelId: { in: channelIds } } });
        await tx.message.deleteMany({ where: { channelId: { in: channelIds } } });
        await tx.channel.deleteMany({ where: { serverId } });
      }

      // Server-scoped records without an onDelete cascade: remove explicitly or
      // they FK-block the server delete (Postgres) / orphan it (SQLite).
      await tx.customEmoji.deleteMany({ where: { serverId } });
      await tx.auditLog.deleteMany({ where: { serverId } });

      await tx.serverMember.deleteMany({ where: { serverId } });
      await tx.server.delete({ where: { id: serverId } });

      return {
        channelIds,
        attachmentUrls: [
          ...new Set(
            [
              ...messages.map((message) => message.attachmentUrl),
              ...journalEntries.map((entry) => entry.attachmentUrl),
              serverMedia?.icon,
              serverMedia?.banner,
              ...customEmojis.map((emoji) => emoji.url),
            ].filter(
              (url): url is string => Boolean(url),
            ),
          ),
        ],
        privateUploadIds: [
          ...new Set(
            [...messages, ...journalEntries]
              .map((record) => record.privateUploadId)
              .filter((id): id is string => Boolean(id)),
          ),
        ],
      };
    });
    const sideEffects = await Promise.allSettled([
      ...channelIds.map((channelId) =>
        notifyRealtimeAuthorizationChange({ scope: "channel", channelId }),
      ),
      notifyRealtimeAuthorizationChange({ scope: "server", serverId }),
      ...attachmentUrls.map(removeUnreferencedUpload),
      ...privateUploadIds.map(removeUnreferencedPrivateUpload),
    ]);
    for (const result of sideEffects) {
      if (result.status === "rejected") {
        console.error("[Campfire] Post-delete server cleanup failed:", result.reason);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Campfire] Failed to delete server:", err);
    return NextResponse.json({ error: "Database error" }, { status: 503 });
  }
}
