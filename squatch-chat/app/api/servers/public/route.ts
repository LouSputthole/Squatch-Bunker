import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getInviteAvailability } from "@/lib/invites";

export async function GET() {
  // Discovery is for signed-in users only. (We intentionally do NOT gate
  // *browsing* the directory behind the premium tier: the `server_discovery`
  // feature governs a server OWNER listing their server publicly, not a member
  // reading the list. The publish side is gated where servers set isPublic.)
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const servers = await prisma.server.findMany({
    where: { isPublic: true },
    include: {
      _count: {
        select: { members: { where: { banned: false } } },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json({
    servers: servers
      .filter((s) => getInviteAvailability(s) === "active")
      .map((s) => ({
        id: s.id,
        name: s.name,
        icon: s.icon,
        description: s.description,
        memberCount: s._count.members,
        inviteCode: s.inviteCode,
      })),
  });
}
