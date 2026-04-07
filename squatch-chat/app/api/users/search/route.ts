import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

// GET /api/users/search?q=username — search users by username
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 2) {
    return NextResponse.json({ users: [] });
  }

  try {
    const { prisma } = await import("@/lib/db");

    const users = await prisma.user.findMany({
      where: {
        username: { contains: q, mode: "insensitive" },
        id: { not: session.userId },
      },
      select: { id: true, username: true, avatar: true },
      take: 10,
    });

    return NextResponse.json({ users });
  } catch (err) {
    console.error("[Campfire] User search failed:", err);
    return NextResponse.json({ error: "Database error" }, { status: 503 });
  }
}
