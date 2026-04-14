import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { userId } = await params;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      avatar: true,
      banner: true,
      bio: true,
      statusMessage: true,
      createdAt: true,
    },
  });

  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  return NextResponse.json({ user });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { userId } = await params;

  // Users can only edit their own profile
  if (session.userId !== userId) {
    return NextResponse.json({ error: "Cannot edit another user's profile" }, { status: 403 });
  }

  const body = await req.json();
  const updates: { bio?: string | null; banner?: string | null; statusMessage?: string | null } = {};

  if ("bio" in body) updates.bio = (body.bio || "").slice(0, 500) || null;
  if ("banner" in body) updates.banner = body.banner || null;
  if ("statusMessage" in body) updates.statusMessage = (body.statusMessage || "").slice(0, 128) || null;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: updates,
    select: {
      id: true,
      username: true,
      avatar: true,
      banner: true,
      bio: true,
      statusMessage: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ user });
}
