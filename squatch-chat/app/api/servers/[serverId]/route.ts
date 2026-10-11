import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { assertFeature } from "@/lib/features";
import { parseInviteRegeneration } from "@/lib/invites";
import { removeUnreferencedUpload } from "@/lib/messageRetention";
import { memberHasPermission } from "@/lib/serverRoles";
import { deleteServerWithContent } from "@/lib/serverDeletion";
import { MAX_SERVER_DESCRIPTION_LENGTH, parseServerName } from "@/lib/inputLimits";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ serverId: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { serverId } = await params;
  const body = (await request.json()) as Record<string, unknown>;
  const { regenerateInvite, revokeInvite, icon, banner } = body;

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
      description?: string | null;
      isPublic?: boolean;
    } = {};
    if ("name" in body) {
      const name = parseServerName(body.name);
      if (!name.ok) return NextResponse.json({ error: name.error }, { status: 400 });
      updates.name = name.value;
    }
    if ("description" in body) {
      if (body.description !== null && typeof body.description !== "string") {
        return NextResponse.json({ error: "Description must be a string" }, { status: 400 });
      }
      const description = typeof body.description === "string" ? body.description.trim() : "";
      if (description.length > MAX_SERVER_DESCRIPTION_LENGTH) {
        return NextResponse.json(
          { error: `Description must be at most ${MAX_SERVER_DESCRIPTION_LENGTH} characters` },
          { status: 400 },
        );
      }
      updates.description = description || null;
    }
    if ("isPublic" in body) {
      if (typeof body.isPublic !== "boolean") {
        return NextResponse.json({ error: "isPublic must be a boolean" }, { status: 400 });
      }
      updates.isPublic = body.isPublic;
    }
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

    const changedFields = [
      ...new Set(Object.keys(updates).map((key) => (key.startsWith("invite") ? "invite" : key))),
    ];
    const [updated] = await prisma.$transaction([
      prisma.server.update({
        where: { id: serverId },
        data: updates,
        include: { channels: true, _count: { select: { members: true } } },
      }),
      prisma.auditLog.create({
        data: {
          serverId,
          actorId: session.userId,
          action: "server_update",
          detail: `Updated ${changedFields.join(", ")}`,
        },
      }),
    ]);
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

    if (!(await deleteServerWithContent(serverId))) {
      return NextResponse.json({ error: "Server not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Campfire] Failed to delete server:", err);
    return NextResponse.json({ error: "Database error" }, { status: 503 });
  }
}
