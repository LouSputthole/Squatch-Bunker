import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { config } from "@/lib/config";

const JWT_SECRET = config.jwtSecret;
const COOKIE_NAME = config.cookieName;

export interface TokenPayload {
  userId: string;
  username: string;
  // Per-user revocation counter. Bumped (e.g. on password reset) to instantly
  // invalidate every previously issued token for that user. Optional so tokens
  // minted before this field existed validate as version 0.
  tokenVersion?: number;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function createToken(payload: TokenPayload): string {
  // Always embed a tokenVersion claim (default 0) so a per-user bump invalidates
  // previously issued tokens. Callers pass user.tokenVersion to carry it forward.
  const { userId, username, tokenVersion = 0 } = payload;
  return jwt.sign({ userId, username, tokenVersion }, JWT_SECRET, {
    expiresIn: "7d",
    algorithm: "HS256",
  });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    // Pin the algorithm so a forged token can't downgrade to "none" or swap to
    // an asymmetric algorithm and bypass signature verification.
    return jwt.verify(token, JWT_SECRET, {
      algorithms: ["HS256"],
    }) as TokenPayload;
  } catch {
    return null;
  }
}

/**
 * Validate a raw session token the same way an authenticated request is
 * validated: pinned-HS256 signature check, then stateful checks against the DB
 * (user still exists, tokenVersion not bumped, guest session not expired).
 * Returns the token payload when the session is still valid, or null otherwise.
 *
 * This is the single source of truth for "is this token good right now" so the
 * HTTP session (getSession) and the realtime socket handshake can share it and
 * never drift apart. Fails closed if the user is gone or the DB errors.
 */
export async function validateSessionToken(
  token: string
): Promise<TokenPayload | null> {
  const payload = verifyToken(token);
  if (!payload) return null;

  // Ephemeral fallback guests (issued only when the DB is unavailable) carry a
  // synthetic "guest-" id that is never persisted, so there is no row to check.
  // Their JWT exp claim is the only bound and is already enforced by verifyToken.
  if (payload.userId.startsWith("guest-")) return payload;

  // Stateful checks: load the user to enforce token revocation (tokenVersion)
  // and guest-session expiry. Fail closed if the user is gone or the DB errors.
  try {
    const { prisma } = await import("@/lib/db");
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { tokenVersion: true, isGuest: true, guestExpiresAt: true },
    });
    if (!user) return null;
    if ((payload.tokenVersion ?? 0) !== user.tokenVersion) return null;
    if (
      user.isGuest &&
      user.guestExpiresAt &&
      user.guestExpiresAt.getTime() <= Date.now()
    ) {
      return null;
    }
  } catch (err) {
    // Fail closed, but never silently: a DB hiccup here downgrades logged-in
    // users to anonymous (e.g. /api/config withholds TURN creds) with no other
    // trace of why.
    console.error("[auth] session validation failed closed:", err);
    return null;
  }

  return payload;
}

export async function getSession(): Promise<TokenPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return validateSessionToken(token);
}

export function setTokenCookie(response: Response, token: string): void {
  response.headers.append(
    "Set-Cookie",
    `${COOKIE_NAME}=${token}; ${config.cookieFlags}`
  );
}

export { COOKIE_NAME };
