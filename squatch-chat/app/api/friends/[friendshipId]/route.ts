import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

// PATCH — accept or block a friend request
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ friendshipId: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { friendshipId } = await params;
  const { action } = await request.json(); // "accept" or "block"

  if (!["accept", "block"].includes(action)) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  try {
    const { prisma } = await import("@/lib/db");

    const friendship = await prisma.friendship.findUnique({
      where: { id: friendshipId },
    });

    if (!friendship) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Only the addressee can accept/block incoming requests
    if (friendship.addresseeId !== session.userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (friendship.status !== "pending") {
      return NextResponse.json({ error: "Request already resolved" }, { status: 409 });
    }

    const updated = await prisma.friendship.update({
      where: { id: friendshipId },
      data: { status: action === "accept" ? "accepted" : "blocked" },
    });

    return NextResponse.json({ friendship: updated });
  } catch (err) {
    console.error("[Campfire] Failed to update friendship:", err);
    return NextResponse.json({ error: "Database error" }, { status: 503 });
  }
}

// DELETE — remove friendship or cancel request
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ friendshipId: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { friendshipId } = await params;

  try {
    const { prisma } = await import("@/lib/db");

    const friendship = await prisma.friendship.findUnique({
      where: { id: friendshipId },
    });

    if (!friendship) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Either party can remove/cancel
    if (friendship.requesterId !== session.userId && friendship.addresseeId !== session.userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await prisma.friendship.delete({ where: { id: friendshipId } });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Campfire] Failed to remove friendship:", err);
    return NextResponse.json({ error: "Database error" }, { status: 503 });
  }
}
