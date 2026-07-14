import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth";
import { hashPasswordResetToken } from "@/lib/passwordReset";

const emailMock = vi.hoisted(() => ({
  sendPasswordResetEmail: vi.fn(),
}));
const realtimeMock = vi.hoisted(() => ({
  notifyRealtimeAuthorizationChange: vi.fn(),
}));

vi.mock("@/lib/email", () => emailMock);
vi.mock("@/lib/realtimeControl", () => realtimeMock);

import { POST as forgotPassword } from "@/app/api/auth/forgot-password/route";
import { POST as resetPassword } from "@/app/api/auth/reset-password/route";

const GENERIC_RESPONSE = {
  message: "If that email exists, a reset link has been sent.",
};

let userId: string;
let guestId: string;
let requestNumber = 0;

function request(
  path: "forgot-password" | "reset-password",
  body: unknown,
): Request {
  requestNumber += 1;
  return new Request(`http://test.local/api/auth/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Every call gets its own limiter key so this suite never depends on
      // process-global buckets left behind by another test.
      "x-forwarded-for": "192.0.2." + requestNumber,
    },
    body: JSON.stringify(body),
  });
}

function forgot(email: unknown) {
  return forgotPassword(request("forgot-password", { email }));
}

function reset(token: unknown, password: unknown) {
  return resetPassword(request("reset-password", { token, password }));
}

beforeAll(async () => {
  const [user, guest] = await Promise.all([
    prisma.user.create({
      data: {
        email: "password-reset-user@t.local",
        username: "password_reset_user",
        passwordHash: "old-hash",
      },
    }),
    prisma.user.create({
      data: {
        email: "password-reset-guest@t.local",
        username: "password_reset_guest",
        passwordHash: "guest-hash",
        isGuest: true,
        guestExpiresAt: new Date(Date.now() + 60_000),
      },
    }),
  ]);
  userId = user.id;
  guestId = guest.id;
});

beforeEach(async () => {
  emailMock.sendPasswordResetEmail.mockReset();
  emailMock.sendPasswordResetEmail.mockResolvedValue({ delivered: true });
  realtimeMock.notifyRealtimeAuthorizationChange.mockReset();
  realtimeMock.notifyRealtimeAuthorizationChange.mockResolvedValue(undefined);
  await Promise.all([
    prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: "old-hash",
        resetToken: null,
        resetExpiry: null,
        tokenVersion: 0,
      },
    }),
    prisma.user.update({
      where: { id: guestId },
      data: { resetToken: null, resetExpiry: null },
    }),
  ]);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("POST /api/auth/forgot-password", () => {
  it("returns the generic response, stores only a token digest, and emails the raw token", async () => {
    const before = Date.now();
    const response = await forgot("PASSWORD-RESET-USER@T.LOCAL");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(GENERIC_RESPONSE);
    expect(emailMock.sendPasswordResetEmail).toHaveBeenCalledOnce();

    const message = emailMock.sendPasswordResetEmail.mock.calls[0]?.[0];
    expect(message).toMatchObject({
      to: "password-reset-user@t.local",
      username: "password_reset_user",
      token: expect.any(String),
    });

    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { resetToken: true, resetExpiry: true },
    });
    expect(stored.resetToken).toBe(hashPasswordResetToken(message.token));
    expect(stored.resetToken).not.toBe(message.token);
    expect(stored.resetExpiry?.getTime()).toBeGreaterThan(before + 59 * 60_000);
    expect(stored.resetExpiry?.getTime()).toBeLessThanOrEqual(
      Date.now() + 60 * 60_000,
    );
  });

  it.each([
    ["email is not configured", { delivered: false, reason: "not-configured" }],
    ["the email provider rejects", new Error("provider unavailable")],
  ])("clears the exact reset token when %s", async (_label, outcome) => {
    if (outcome instanceof Error) {
      emailMock.sendPasswordResetEmail.mockRejectedValueOnce(outcome);
    } else {
      emailMock.sendPasswordResetEmail.mockResolvedValueOnce(outcome);
    }
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await forgot("password-reset-user@t.local");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(GENERIC_RESPONSE);
    await expect(
      prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { resetToken: true, resetExpiry: true },
      }),
    ).resolves.toEqual({ resetToken: null, resetExpiry: null });
    expect(consoleError).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });

  it("does not disclose or email unknown users, guests, or invalid input", async () => {
    const responses = await Promise.all([
      forgot("missing-password-reset-user@t.local"),
      forgot("password-reset-guest@t.local"),
      forgot(""),
      forgot(null),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200]);
    await Promise.all(
      responses.map(async (response) => {
        await expect(response.json()).resolves.toEqual(GENERIC_RESPONSE);
      }),
    );
    expect(emailMock.sendPasswordResetEmail).not.toHaveBeenCalled();
    await expect(
      prisma.user.findUniqueOrThrow({
        where: { id: guestId },
        select: { resetToken: true, resetExpiry: true },
      }),
    ).resolves.toEqual({ resetToken: null, resetExpiry: null });
  });
});

describe("POST /api/auth/reset-password", () => {
  it("atomically consumes a token once, replaces the password, and revokes sessions", async () => {
    const token = "single-use-password-reset-token";
    await prisma.user.update({
      where: { id: userId },
      data: {
        resetToken: hashPasswordResetToken(token),
        resetExpiry: new Date(Date.now() + 60_000),
        tokenVersion: 4,
      },
    });


    const observedCommittedState: Array<{
      passwordHash: string;
      resetToken: string | null;
      resetExpiry: Date | null;
      tokenVersion: number;
    }> = [];
    realtimeMock.notifyRealtimeAuthorizationChange.mockImplementationOnce(
      async () => {
        observedCommittedState.push(
          await prisma.user.findUniqueOrThrow({
            where: { id: userId },
            select: {
              passwordHash: true,
              resetToken: true,
              resetExpiry: true,
              tokenVersion: true,
            },
          }),
        );
      },
    );
    const [first, second] = await Promise.all([
      reset(token, "new-password-one"),
      reset(token, "new-password-two"),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 400]);
    const success = first.status === 200 ? first : second;
    const rejected = first.status === 400 ? first : second;
    await expect(success.json()).resolves.toEqual({
      message: "Password updated successfully",
    });
    await expect(rejected.json()).resolves.toEqual({
      error: "Invalid or expired token",
    });

    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        passwordHash: true,
        resetToken: true,
        resetExpiry: true,
        tokenVersion: true,
      },
    });
    expect(stored.resetToken).toBeNull();
    expect(stored.resetExpiry).toBeNull();
    expect(stored.tokenVersion).toBe(5);
    expect(
      (await verifyPassword("new-password-one", stored.passwordHash)) ||
        (await verifyPassword("new-password-two", stored.passwordHash)),
    ).toBe(true);
    expect(realtimeMock.notifyRealtimeAuthorizationChange).toHaveBeenCalledOnce();
    expect(realtimeMock.notifyRealtimeAuthorizationChange).toHaveBeenCalledWith({
      scope: "session",
      userId,
    });
    expect(observedCommittedState).toHaveLength(1);
    expect(observedCommittedState[0]).toMatchObject({
      resetToken: null,
      resetExpiry: null,
      tokenVersion: 5,
    });
    expect(observedCommittedState[0]?.passwordHash).not.toBe("old-hash");
  });

  it("rejects wrong and expired tokens without changing the user", async () => {
    const token = "expired-password-reset-token";
    await prisma.user.update({
      where: { id: userId },
      data: {
        resetToken: hashPasswordResetToken(token),
        resetExpiry: new Date(Date.now() - 1_000),
        tokenVersion: 7,
      },
    });

    const [wrong, expired] = await Promise.all([
      reset("wrong-password-reset-token", "replacement-password"),
      reset(token, "replacement-password"),
    ]);

    expect(wrong.status).toBe(400);
    expect(expired.status).toBe(400);
    await expect(wrong.json()).resolves.toEqual({
      error: "Invalid or expired token",
    });
    await expect(expired.json()).resolves.toEqual({
      error: "Invalid or expired token",
    });
    await expect(
      prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { passwordHash: true, resetToken: true, tokenVersion: true },
      }),
    ).resolves.toEqual({
      passwordHash: "old-hash",
      resetToken: hashPasswordResetToken(token),
      tokenVersion: 7,
    });
    expect(realtimeMock.notifyRealtimeAuthorizationChange).not.toHaveBeenCalled();
  });
});
