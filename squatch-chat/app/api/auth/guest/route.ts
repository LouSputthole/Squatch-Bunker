import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword, createToken, setTokenCookie } from "@/lib/auth";
import crypto from "crypto";

export async function POST(request: Request) {
  const { username } = await request.json();

  if (!username || !username.trim()) {
    return NextResponse.json(
      { error: "Username is required" },
      { status: 400 }
    );
  }

  const cleanUsername = username.trim();

  if (cleanUsername.length < 2 || cleanUsername.length > 24) {
    return NextResponse.json(
      { error: "Username must be 2-24 characters" },
      { status: 400 }
    );
  }

  // Generate a unique guest identifier to avoid collisions
  const guestId = crypto.randomBytes(4).toString("hex");
  const guestUsername = `${cleanUsername}#${guestId}`;
  const guestEmail = `guest-${guestId}@squatch.local`;
  const guestPassword = crypto.randomBytes(16).toString("hex");

  // Check if display username is taken (exact match)
  const existing = await prisma.user.findFirst({
    where: { username: guestUsername },
  });

  if (existing) {
    // Extremely unlikely with random suffix, but handle it
    return NextResponse.json(
      { error: "Please try again" },
      { status: 409 }
    );
  }

  const passwordHash = await hashPassword(guestPassword);
  const user = await prisma.user.create({
    data: {
      email: guestEmail,
      username: guestUsername,
      passwordHash,
    },
  });

  const token = createToken({ userId: user.id, username: user.username });
  const response = NextResponse.json(
    { user: { id: user.id, username: user.username, email: user.email } },
    { status: 201 }
  );
  setTokenCookie(response, token);
  return response;
}
