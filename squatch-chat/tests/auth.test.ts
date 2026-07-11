import { describe, it, expect, beforeAll, afterAll } from "vitest";
import jwt from "jsonwebtoken";
import { prisma } from "@/lib/db";
import { config } from "@/lib/config";
import { createToken, validateSessionToken } from "@/lib/auth";

// Integration tests for validateSessionToken against a real (throwaway) SQLite
// DB. This function is the single source of truth for "is this token good right
// now", shared by the HTTP session and the realtime socket handshake, so its
// revocation / expiry / algorithm-pin behaviour is worth pinning down.

let validUser: { id: string; username: string };
let staleUser: { id: string; username: string };
let guestUser: { id: string; username: string };
let algUser: { id: string; username: string };
let deletedUser: { id: string; username: string };

beforeAll(async () => {
  validUser = await prisma.user.create({
    data: { email: "auth-valid@t.local", username: "auth_valid", passwordHash: "x" },
  });
  staleUser = await prisma.user.create({
    data: { email: "auth-stale@t.local", username: "auth_stale", passwordHash: "x" },
  });
  guestUser = await prisma.user.create({
    data: {
      email: "auth-guest@t.local",
      username: "auth_guest",
      passwordHash: "x",
      isGuest: true,
      guestExpiresAt: new Date(Date.now() - 60_000), // already expired
    },
  });
  algUser = await prisma.user.create({
    data: { email: "auth-alg@t.local", username: "auth_alg", passwordHash: "x" },
  });
  deletedUser = await prisma.user.create({
    data: { email: "auth-del@t.local", username: "auth_del", passwordHash: "x" },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("validateSessionToken", () => {
  it("returns the session for a valid token of an existing user", async () => {
    const token = createToken({ userId: validUser.id, username: validUser.username });
    const payload = await validateSessionToken(token);
    expect(payload).not.toBeNull();
    expect(payload?.userId).toBe(validUser.id);
    expect(payload?.username).toBe(validUser.username);
  });

  it("rejects a token whose tokenVersion is stale (revoked)", async () => {
    // Token minted at version 0…
    const token = createToken({ userId: staleUser.id, username: staleUser.username });
    // …then the user's version is bumped (as on password reset), revoking it.
    await prisma.user.update({ where: { id: staleUser.id }, data: { tokenVersion: 5 } });
    expect(await validateSessionToken(token)).toBeNull();
  });

  it("rejects an expired guest session", async () => {
    const token = createToken({ userId: guestUser.id, username: guestUser.username });
    expect(await validateSessionToken(token)).toBeNull();
  });

  it("rejects algorithm-downgrade forgeries (HS512 and alg:none)", async () => {
    const claims = { userId: algUser.id, username: algUser.username, tokenVersion: 0 };
    // Forged with a different HMAC alg than the pinned HS256.
    const hs512 = jwt.sign(claims, config.jwtSecret, { algorithm: "HS512" });
    expect(await validateSessionToken(hs512)).toBeNull();
    // Unsigned "none" token.
    const none = jwt.sign(claims, "", { algorithm: "none" });
    expect(await validateSessionToken(none)).toBeNull();
  });

  it("rejects a valid token for a user that no longer exists", async () => {
    const token = createToken({ userId: deletedUser.id, username: deletedUser.username });
    await prisma.user.delete({ where: { id: deletedUser.id } });
    expect(await validateSessionToken(token)).toBeNull();
  });
});
