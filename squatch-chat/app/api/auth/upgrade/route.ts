import { NextResponse } from "next/server";
import { getSession, hashPassword, createToken, setTokenCookie } from "@/lib/auth";
import { parseAccountCredentials } from "@/lib/accountCredentials";
import { prismaErrorCode } from "@/lib/prismaErrors";

// POST — upgrade a guest account to a real account
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Same validation and normalization as registration (trimmed lowercase
  // email, 2-32 char username, 8-128 char password).
  const parsed = parseAccountCredentials(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { email, username, password } = parsed.value;

  try {
    const { prisma } = await import("@/lib/db");

    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
    if (!user.isGuest) return NextResponse.json({ error: "Account is not a guest" }, { status: 400 });

    // Check for conflicts — use a single generic message so we don't disclose
    // whether the email or the username specifically is already registered.
    const taken = await prisma.user.findFirst({
      where: { id: { not: user.id }, OR: [{ email }, { username }] },
      select: { id: true },
    });
    if (taken) {
      return NextResponse.json({ error: "Email or username already taken" }, { status: 409 });
    }

    const passwordHash = await hashPassword(password);

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        email,
        username,
        passwordHash,
        isGuest: false,
        guestExpiresAt: null,
      },
    });

    // The guest token carries the old "name#tag" username; re-mint it with
    // the permanent username and the user's current revocation version.
    const token = createToken({ userId: updated.id, username: updated.username, tokenVersion: updated.tokenVersion });
    const response = NextResponse.json({
      user: { id: updated.id, username: updated.username, email: updated.email, isGuest: false },
    });
    setTokenCookie(response, token);
    return response;
  } catch (err) {
    if (prismaErrorCode(err) === "P2002") {
      return NextResponse.json({ error: "Email or username already taken" }, { status: 409 });
    }
    console.error("[Campfire] Guest upgrade error:", err);
    return NextResponse.json({ error: "Database error" }, { status: 503 });
  }
}
