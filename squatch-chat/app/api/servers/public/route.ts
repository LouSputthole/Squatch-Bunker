import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const servers = await prisma.server.findMany({
    where: { isPublic: true },
    include: {
      _count: { select: { members: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json({
    servers: servers.map((s) => ({
      id: s.id,
      name: s.name,
      icon: s.icon,
      description: s.description,
      memberCount: s._count.members,
      inviteCode: s.inviteCode,
    })),
  });
}
