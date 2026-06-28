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

    // Normalize the pair so the existence check covers either direction.
    const [u1, u2] = [session.userId, target.id].sort();

    // Run the existence check and the create/auto-accept atomically. On the
    // single-connection SQLite default this fully serializes concurrent
    // reciprocal requests, so they can't both pass the check and create two
    // rows; the P2002 handler below converts any residual unique-constraint
    // race into a graceful response. `requesterId`/`addresseeId` still record
    // the real sender/recipient so incoming vs outgoing display is preserved.
    const result = await prisma.$transaction(
      async (tx): Promise<{ status: number; body: Record<string, unknown> }> => {
        const existing = await tx.friendship.findFirst({
          where: {
            OR: [
              { requesterId: u1, addresseeId: u2 },
              { requesterId: u2, addresseeId: u1 },
            ],
          },
        });

        if (existing) {
          if (existing.status === "accepted") {
            return { status: 409, body: { error: "Already friends" } };
          }
          if (existing.status === "pending") {
            // If they sent us a request, auto-accept
            if (existing.addresseeId === session.userId) {
              const updated = await tx.friendship.update({
                where: { id: existing.id },
                data: { status: "accepted" },
              });
              return { status: 200, body: { friendship: updated, autoAccepted: true } };
            }
            return { status: 409, body: { error: "Request already sent" } };
          }
          if (existing.status === "blocked") {
            return { status: 403, body: { error: "Cannot send request" } };
          }
        }

        const friendship = await tx.friendship.create({
          data: { requesterId: session.userId, addresseeId: target.id },
        });

        return { status: 200, body: { friendship } };
      },
    );

    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    const prismaErr = err as { code?: string };
    if (prismaErr?.code === "P2002") {
      // A concurrent request already created this friendship — treat the
      // duplicate as a no-op rather than surfacing a 500.
      return NextResponse.json({ error: "Request already sent" }, { status: 409 });
    }
    console.error("[Campfire] Failed to send friend request:", err);
    return NextResponse.json({ error: "Database error" }, { status: 503 });
  }
}
