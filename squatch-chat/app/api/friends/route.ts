import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

// GET — list all friendships (accepted, pending incoming, pending outgoing)
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { prisma } = await import("@/lib/db");

    const friendships = await prisma.friendship.findMany({
      where: {
        OR: [{ requesterId: session.userId }, { addresseeId: session.userId }],
        status: { not: "blocked" },
      },
      include: {
        requester: { select: { id: true, username: true, avatar: true } },
        addressee: { select: { id: true, username: true, avatar: true } },
      },
      orderBy: { updatedAt: "desc" },
    });

    const friends = friendships
      .filter((f) => f.status === "accepted")
      .map((f) => ({
        id: f.id,
        user: f.requesterId === session.userId ? f.addressee : f.requester,
        since: f.updatedAt,
      }));

    const incoming = friendships
      .filter((f) => f.status === "pending" && f.addresseeId === session.userId)
      .map((f) => ({
        id: f.id,
        user: f.requester,
        sentAt: f.createdAt,
      }));

    const outgoing = friendships
      .filter((f) => f.status === "pending" && f.requesterId === session.userId)
      .map((f) => ({
        id: f.id,
        user: f.addressee,
        sentAt: f.createdAt,
      }));

    return NextResponse.json({ friends, incoming, outgoing });
  } catch (err) {
    console.error("[Campfire] Failed to list friends:", err);
    return NextResponse.json({ error: "Database error" }, { status: 503 });
  }
}

// POST — send friend request by username
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { username } = await request.json();
  if (!username?.trim()) {
    return NextResponse.json({ error: "Username required" }, { status: 400 });
  }

  try {
    const { prisma } = await import("@/lib/db");

    const target = await prisma.user.findUnique({
      where: { username: username.trim() },
      select: { id: true, username: true },
    });

    if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });
    if (target.id === session.userId) {
      return NextResponse.json({ error: "Cannot friend yourself" }, { status: 400 });
    }

    // Check existing friendship in either direction
    const [u1, u2] = [session.userId, target.id].sort();
    const existing = await prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId: u1, addresseeId: u2 },
          { requesterId: u2, addresseeId: u1 },
        ],
      },
    });

    if (existing) {
      if (existing.status === "accepted") {
        return NextResponse.json({ error: "Already friends" }, { status: 409 });
      }
      if (existing.status === "pending") {
        // If they sent us a request, auto-accept
        if (existing.addresseeId === session.userId) {
          const updated = await prisma.friendship.update({
            where: { id: existing.id },
            data: { status: "accepted" },
          });
          return NextResponse.json({ friendship: updated, autoAccepted: true });
        }
        return NextResponse.json({ error: "Request already sent" }, { status: 409 });
      }
      if (existing.status === "blocked") {
        return NextResponse.json({ error: "Cannot send request" }, { status: 403 });
      }
    }

    const friendship = await prisma.friendship.create({
      data: { requesterId: session.userId, addresseeId: target.id },
    });

    return NextResponse.json({ friendship });
  } catch (err) {
    console.error("[Campfire] Failed to send friend request:", err);
    return NextResponse.json({ error: "Database error" }, { status: 503 });
  }
}
