import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { memberHasPermission } from "@/lib/serverRoles";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ serverId: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { serverId } = await params;
  const url = new URL(req.url);
  const page = parseInt(url.searchParams.get("page") || "1", 10);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 100);
  const actionFilter = url.searchParams.get("action") || undefined;

  try {
    const { prisma } = await import("@/lib/db");

    if (!(await memberHasPermission(serverId, session.userId, "VIEW_AUDIT_LOG"))) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const where: { serverId: string; action?: string } = { serverId };
    if (actionFilter) where.action = actionFilter;

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.auditLog.count({ where }),
    ]);

    // Resolve actor usernames
    const actorIds = [...new Set(logs.map((l) => l.actorId))];
    const targetIds = [...new Set(logs.filter((l) => l.targetId).map((l) => l.targetId!))];
    const allUserIds = [...new Set([...actorIds, ...targetIds])];

    const users = await prisma.user.findMany({
      where: { id: { in: allUserIds } },
      select: { id: true, username: true, avatar: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const entries = logs.map((log) => ({
      id: log.id,
      action: log.action,
      detail: log.detail,
      createdAt: log.createdAt.toISOString(),
      actor: userMap.get(log.actorId) || { id: log.actorId, username: "Unknown", avatar: null },
      target: log.targetId ? userMap.get(log.targetId) || { id: log.targetId, username: "Unknown", avatar: null } : null,
    }));

    return NextResponse.json({ entries, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error("[Campfire] Audit log error:", err);
    return NextResponse.json({ error: "Database error" }, { status: 503 });
  }
}
