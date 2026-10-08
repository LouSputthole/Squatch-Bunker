import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

// GET /api/dm/unread — total unread direct messages for the DM badge. Cheap
// enough to call on load and whenever a `dm:notification` arrives.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { prisma } = await import("@/lib/db");
    const total = await prisma.directMessage.count({
      where: {
        authorId: { not: session.userId },
        readAt: null,
        conversation: {
          OR: [{ user1Id: session.userId }, { user2Id: session.userId }],
        },
      },
    });
    return NextResponse.json({ total });
  } catch (err) {
    console.error("[Campfire] Failed to count unread DMs:", err);
    return NextResponse.json({ error: "Database error" }, { status: 503 });
  }
}
