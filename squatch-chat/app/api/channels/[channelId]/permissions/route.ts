import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  CHANNEL_OVERRIDE_TIERS,
  customRoleIdFromOverrideKey,
  customRoleOverrideKey,
} from "@/lib/channelAccess";
import { notifyRealtimeAuthorizationChange } from "@/lib/realtimeControl";
import { memberHasPermission } from "@/lib/serverRoles";

type ManagedChannel =
  | { ok: true; serverId: string }
  | { ok: false; response: NextResponse };

async function loadManagedChannel(channelId: string, userId: string): Promise<ManagedChannel> {
  const { prisma } = await import("@/lib/db");
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { serverId: true },
  });
  if (!channel) {
    return { ok: false, response: NextResponse.json({ error: "Channel not found" }, { status: 404 }) };
  }
  if (!(await memberHasPermission(channel.serverId, userId, "MANAGE_CHANNELS"))) {
    return { ok: false, response: NextResponse.json({ error: "Admin access required" }, { status: 403 }) };
  }
  return { ok: true, serverId: channel.serverId };
}

/** Custom roles an override can target: this server's roles, minus the implicit default role. */
async function overridableRoles(serverId: string) {
  const { prisma } = await import("@/lib/db");
  return prisma.role.findMany({
    where: { serverId, isDefault: false },
    orderBy: { position: "desc" },
    select: { id: true, name: true, color: true },
  });
}

/**
 * Validate an override key: a legacy tier, or `role:<id>` for a custom role
 * that belongs to THIS server. Returns a label for the audit log, or null.
 */
async function overrideKeyLabel(role: unknown, serverId: string): Promise<string | null> {
  if (typeof role !== "string" || !role) return null;
  if ((CHANNEL_OVERRIDE_TIERS as readonly string[]).includes(role)) return role;
  const roleId = customRoleIdFromOverrideKey(role);
  if (!roleId) return null;
  const { prisma } = await import("@/lib/db");
  const customRole = await prisma.role.findUnique({
    where: { id: roleId },
    select: { serverId: true, isDefault: true, name: true },
  });
  if (!customRole || customRole.serverId !== serverId || customRole.isDefault) return null;
  return `@${customRole.name}`;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { channelId } = await params;

  try {
    const { prisma } = await import("@/lib/db");
    const managed = await loadManagedChannel(channelId, session.userId);
    if (!managed.ok) return managed.response;

    const [rows, roles] = await Promise.all([
      prisma.channelPermission.findMany({
        where: { channelId },
        orderBy: { role: "asc" },
      }),
      overridableRoles(managed.serverId),
    ]);
    // Rows for deleted roles are inert (nobody holds the role); hide them.
    const liveKeys = new Set<string>([
      ...CHANNEL_OVERRIDE_TIERS,
      ...roles.map((role) => customRoleOverrideKey(role.id)),
    ]);
    const permissions = rows.filter((row) => liveKeys.has(row.role));

    return NextResponse.json({
      permissions,
      roles: roles.map((role) => ({ ...role, key: customRoleOverrideKey(role.id) })),
    });
  } catch (err) {
    console.error("[Campfire] Channel permissions error:", err);
    return NextResponse.json({ error: "Database error" }, { status: 503 });
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ channelId: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { channelId } = await params;
  const body: unknown = await req.json().catch(() => null);
  const { role, canView, canSend } = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  if (typeof role !== "string" || !role) {
    return NextResponse.json({ error: "Valid role required" }, { status: 400 });
  }
  if (
    (canView !== undefined && typeof canView !== "boolean") ||
    (canSend !== undefined && typeof canSend !== "boolean")
  ) {
    return NextResponse.json({ error: "canView and canSend must be booleans" }, { status: 400 });
  }

  try {
    const { prisma } = await import("@/lib/db");
    const managed = await loadManagedChannel(channelId, session.userId);
    if (!managed.ok) return managed.response;

    const label = await overrideKeyLabel(role, managed.serverId);
    if (!label) {
      return NextResponse.json({ error: "Valid role required" }, { status: 400 });
    }

    const view = canView ?? true;
    // A hidden channel is never writable; store the effective value.
    const send = view && (canSend ?? true);
    const permission = await prisma.channelPermission.upsert({
      where: { channelId_role: { channelId, role } },
      update: { canView: view, canSend: send },
      create: { channelId, role, canView: view, canSend: send },
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        serverId: managed.serverId,
        actorId: session.userId,
        action: "channel_permission_update",
        detail: `Updated permissions for role "${label}" in channel ${channelId}: view=${view}, send=${send}`,
      },
    });

    await notifyRealtimeAuthorizationChange({
      scope: "channel",
      channelId,
    });
    return NextResponse.json({ permission });
  } catch (err) {
    console.error("[Campfire] Channel permission update error:", err);
    return NextResponse.json({ error: "Database error" }, { status: 503 });
  }
}

// DELETE ?role=<key> — drop one override so that role falls back to the default rule.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { channelId } = await params;
  const role = req.nextUrl.searchParams.get("role");
  if (!role) return NextResponse.json({ error: "Valid role required" }, { status: 400 });

  try {
    const { prisma } = await import("@/lib/db");
    const managed = await loadManagedChannel(channelId, session.userId);
    if (!managed.ok) return managed.response;

    const label = (await overrideKeyLabel(role, managed.serverId)) ?? role;
    const { count } = await prisma.channelPermission.deleteMany({
      where: { channelId, role },
    });
    if (count > 0) {
      await prisma.auditLog.create({
        data: {
          serverId: managed.serverId,
          actorId: session.userId,
          action: "channel_permission_update",
          detail: `Removed the "${label}" override in channel ${channelId}`,
        },
      });
      await notifyRealtimeAuthorizationChange({ scope: "channel", channelId });
    }
    return NextResponse.json({ deleted: count > 0 });
  } catch (err) {
    console.error("[Campfire] Channel permission delete error:", err);
    return NextResponse.json({ error: "Database error" }, { status: 503 });
  }
}
