import { NextResponse } from "next/server";
import { clearTokenCookie, createToken, getSession, setTokenCookie, verifyPassword } from "@/lib/auth";
import { hasUsablePassword, MAX_USERNAME_LENGTH, MIN_USERNAME_LENGTH } from "@/lib/accountCredentials";
import { deleteAccount } from "@/lib/accountDeletion";
import { prismaErrorCode } from "@/lib/prismaErrors";
import { checkWeightedLimit } from "@/lib/rateLimit";

const USERNAME_CHANGES_PER_HOUR = 5;
const DELETE_ATTEMPTS_PER_HOUR = 10;

/**
 * PATCH /api/auth/me — update the caller's statusMessage and/or username.
 * Only fields present in the body change. A username change follows the
 * registration rules, is unavailable to guests (they pick one when upgrading),
 * and re-mints the session cookie, since tokens carry the username.
 */
export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const data: { statusMessage?: string | null; username?: string } = {};
  if ("statusMessage" in body) {
    const { statusMessage } = body;
    data.statusMessage = typeof statusMessage === "string" ? statusMessage.slice(0, 128) || null : null;
  }
  if ("username" in body) {
    if (typeof body.username !== "string") {
      return NextResponse.json({ error: "Username is required" }, { status: 400 });
    }
    const username = body.username.trim();
    if (username.length < MIN_USERNAME_LENGTH || username.length > MAX_USERNAME_LENGTH) {
      return NextResponse.json(
        { error: `Username must be ${MIN_USERNAME_LENGTH}-${MAX_USERNAME_LENGTH} characters` },
        { status: 400 },
      );
    }
    // Counted before the uniqueness check so it also brakes name probing.
    const limit = checkWeightedLimit(`username-change:${session.userId}`, 1, USERNAME_CHANGES_PER_HOUR, 60 * 60 * 1000);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Too many username changes. Try again later." },
        { status: 429, headers: { "Retry-After": String(Math.ceil((limit.resetAt - Date.now()) / 1000)) } },
      );
    }
    data.username = username;
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  try {
    const { prisma } = await import("@/lib/db");
    if (data.username !== undefined) {
      const current = await prisma.user.findUnique({
        where: { id: session.userId },
        select: { isGuest: true, username: true },
      });
      if (!current) return NextResponse.json({ error: "User not found" }, { status: 404 });
      if (current.isGuest) {
        return NextResponse.json(
          { error: "Guests choose a permanent username when they save their account" },
          { status: 403 },
        );
      }
      if (current.username === data.username) {
        delete data.username;
      } else {
        const taken = await prisma.user.findFirst({
          where: { username: data.username, id: { not: session.userId } },
          select: { id: true },
        });
        if (taken) return NextResponse.json({ error: "Username already taken" }, { status: 409 });
      }
    }

    const user = await prisma.user.update({
      where: { id: session.userId },
      data,
      select: { id: true, username: true, statusMessage: true, tokenVersion: true },
    });
    const response = NextResponse.json({
      user: { id: user.id, username: user.username, statusMessage: user.statusMessage },
    });
    if (data.username !== undefined) {
      // Same re-mint as the guest upgrade: new username, current revocation version.
      setTokenCookie(response, createToken({ userId: user.id, username: user.username, tokenVersion: user.tokenVersion }));
    }
    return response;
  } catch (err) {
    if (prismaErrorCode(err) === "P2002") {
      return NextResponse.json({ error: "Username already taken" }, { status: 409 });
    }
    console.error("[Campfire] PATCH me:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/auth/me — delete the caller's account (lib/accountDeletion.ts).
 * Body: { username, password? }. Typing the exact username confirms intent;
 * the current password is also required when the account has one (not for
 * guests or GitHub/Google-only accounts). DELETE rather than POST so a
 * cross-site form can never send it with the session cookie.
 */
export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const limit = checkWeightedLimit(`account-delete:${session.userId}`, 1, DELETE_ATTEMPTS_PER_HOUR, 60 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((limit.resetAt - Date.now()) / 1000)) } },
    );
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const { prisma } = await import("@/lib/db");
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { username: true, isGuest: true, passwordHash: true },
    });
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
    if (typeof body.username !== "string" || body.username.trim() !== user.username) {
      return NextResponse.json({ error: "Type your username exactly to confirm" }, { status: 400 });
    }
    if (
      hasUsablePassword(user)
      && (typeof body.password !== "string" || !(await verifyPassword(body.password, user.passwordHash)))
    ) {
      return NextResponse.json({ error: "Incorrect password" }, { status: 403 });
    }

    const result = await deleteAccount(session.userId);
    if (!result.ok) {
      if (result.reason === "owns_camps") {
        const named = result.camps.slice(0, 3).map((name) => `"${name}"`).join(", ");
        const more = result.camps.length > 3 ? ` and ${result.camps.length - 3} more` : "";
        return NextResponse.json(
          {
            error: `You still own ${named}${more}. Delete ${result.camps.length === 1 ? "that camp" : "those camps"} first (Server Settings, Danger Zone); camps can't be handed to someone else yet.`,
          },
          { status: 409 },
        );
      }
      if (result.reason === "subscription") {
        return NextResponse.json(
          { error: "Cancel your subscription in Manage billing before deleting your account." },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const response = NextResponse.json({ ok: true });
    clearTokenCookie(response);
    return response;
  } catch (err) {
    console.error("[Campfire] DELETE me:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Try to fetch from database first
    try {
      const { prisma } = await import("@/lib/db");
      const user = await prisma.user.findUnique({
        where: { id: session.userId },
        select: {
          id: true,
          username: true,
          email: true,
          avatar: true,
          statusMessage: true,
          isGuest: true,
          guestExpiresAt: true,
          passwordHash: true,
        },
      });

      if (user) {
        // Never the hash itself: only whether deleting the account asks for a password.
        const { passwordHash, ...profile } = user;
        return NextResponse.json({ user: { ...profile, hasPassword: hasUsablePassword({ isGuest: user.isGuest, passwordHash }) } });
      }
    } catch {
      // Database not available — fall through to JWT-based response
    }

    // Guest or DB-unavailable: return session data from JWT
    return NextResponse.json({
      user: {
        id: session.userId,
        username: session.username,
        email: null,
        isGuest: session.userId.startsWith("guest-"),
        guestExpiresAt: null,
      },
    });
  } catch (err) {
    console.error("[Campfire] Auth/me error:", err);
    return NextResponse.json({ error: "Auth check failed" }, { status: 500 });
  }
}
