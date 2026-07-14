import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { resolveChannelAccess } from "@/lib/channelAccess";
import { requireMembership } from "@/lib/membership";

const NOTIFICATION_LEVELS = new Set(["all", "mentions", "none"]);
const MAX_SCOPE_ID_LENGTH = 128;

interface PreferenceInput {
  serverId: string | null;
  channelId: string | null;
  level: string;
}

function isOptionalScopeId(value: unknown): value is string | null | undefined {
  return value === undefined
    || value === null
    || (typeof value === "string"
      && value.length > 0
      && value.length <= MAX_SCOPE_ID_LENGTH
      && value.trim() === value);
}

function parsePreferenceInput(value: unknown): PreferenceInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const body = value as Record<string, unknown>;
  if (typeof body.level !== "string" || !NOTIFICATION_LEVELS.has(body.level)) return null;
  if (!isOptionalScopeId(body.serverId) || !isOptionalScopeId(body.channelId)) return null;

  const serverId = typeof body.serverId === "string" ? body.serverId : null;
  const channelId = typeof body.channelId === "string" ? body.channelId : null;
  if (channelId && !serverId) return null;

  return { serverId, channelId, level: body.level };
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const { prisma } = await import("@/lib/db");
    const preferences = await prisma.notificationPreference.findMany({
      where: { userId: session.userId },
    });

    const visiblePreferences = (await Promise.all(preferences.map(async (preference) => {
      if (!preference.serverId && !preference.channelId) return preference;
      if (!preference.serverId) return null;

      if (!preference.channelId) {
        const membership = await requireMembership(preference.serverId, session.userId);
        return membership ? preference : null;
      }

      const access = await resolveChannelAccess(preference.channelId, session.userId);
      return access?.canView && access.serverId === preference.serverId ? preference : null;
    }))).filter((preference): preference is (typeof preferences)[number] => preference !== null);

    return NextResponse.json({ preferences: visiblePreferences });
  } catch (err) {
    console.error("[Campfire] Failed to fetch notification preferences:", err);
    return NextResponse.json({ preferences: [] });
  }
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const input = parsePreferenceInput(await request.json().catch(() => null));
  if (!input) {
    return NextResponse.json({ error: "Invalid notification preference" }, { status: 400 });
  }

  try {
    if (input.channelId) {
      const access = await resolveChannelAccess(input.channelId, session.userId);
      if (!access?.canView || access.serverId !== input.serverId) {
        return NextResponse.json({ error: "Notification scope is not available" }, { status: 403 });
      }
    } else if (input.serverId) {
      const membership = await requireMembership(input.serverId, session.userId);
      if (!membership) {
        return NextResponse.json({ error: "Notification scope is not available" }, { status: 403 });
      }
    }

    const { prisma } = await import("@/lib/db");
    const preference = await prisma.$transaction(async (tx) => {
      const matches = await tx.notificationPreference.findMany({
        where: {
          userId: session.userId,
          serverId: input.serverId,
          channelId: input.channelId,
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true },
      });

      if (matches.length === 0) {
        return tx.notificationPreference.create({
          data: { userId: session.userId, ...input },
        });
      }

      const [survivor, ...duplicates] = matches;
      const updated = await tx.notificationPreference.update({
        where: { id: survivor.id },
        data: { level: input.level },
      });

      if (duplicates.length > 0) {
        await tx.notificationPreference.deleteMany({
          where: { id: { in: duplicates.map(({ id }) => id) } },
        });
      }

      return updated;
    });

    return NextResponse.json({ preference }, { status: 200 });
  } catch (err) {
    console.error("[Campfire] Failed to upsert notification preference:", err);
    return NextResponse.json(
      { error: "Database unavailable. Check the server's database connection (DATABASE_URL)." },
      { status: 503 },
    );
  }
}
