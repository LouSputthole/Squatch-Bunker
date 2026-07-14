import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getInviteAvailability } from "@/lib/invites";
import { effectivePermissions } from "@/lib/permissions";
import { getPermContext } from "@/lib/serverRoles";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ serverId: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { serverId } = await params;

  const permissionContext = await getPermContext(serverId, session.userId);
  if (!permissionContext.isMember) {
    return NextResponse.json({ error: "Not a server member" }, { status: 403 });
  }

  const currentUserPermissions = effectivePermissions(permissionContext);

  const [members, server] = await Promise.all([
    prisma.serverMember.findMany({
      where: currentUserPermissions.has("BAN_MEMBERS")
        ? { serverId }
        : { serverId, banned: false },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            avatar: true,
            statusMessage: true,
          },
        },
        memberRoles: { select: { roleId: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.server.findUnique({
      where: { id: serverId },
      select: {
        ownerId: true,
        inviteCode: true,
        inviteExpiresAt: true,
        inviteMaxUses: true,
        inviteUseCount: true,
        inviteRevokedAt: true,
      },
    }),
  ]);

  return NextResponse.json({
    members: members.map((m) => ({
      id: m.user.id,
      username: m.user.username,
      avatar: m.user.avatar,
      role: m.role,
      roleIds: m.memberRoles.map((mr) => mr.roleId),
      joinedAt: m.createdAt,
      banned: m.banned,
      statusMessage: m.user.statusMessage,
    })),
    currentUserPermissions: Array.from(currentUserPermissions).sort(),
    inviteCode: server?.inviteCode,
    inviteAvailable: server
      ? getInviteAvailability(server) === "active"
      : false,
  });
}
