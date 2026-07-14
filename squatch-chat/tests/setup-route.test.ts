import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const transactionUser = {
    count: vi.fn(),
    create: vi.fn(),
  };
  return {
    transactionUser,
    prisma: {
      user: { count: vi.fn() },
      $transaction: vi.fn(
        async (
          operation: (tx: { user: typeof transactionUser }) => Promise<unknown>,
          options?: { isolationLevel?: string },
        ) => {
          void options;
          return operation({ user: transactionUser });
        },
      ),
    },
    auth: {
      hashPassword: vi.fn(async (password: string) => `hashed:${password}`),
      createToken: vi.fn(() => "setup-token"),
      setTokenCookie: vi.fn(),
    },
  };
});

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/auth", () => mocks.auth);

import { GET, POST } from "@/app/api/setup/route";

function setup(body: unknown, raw = false) {
  return POST(new Request("http://test.local/api/setup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ? String(body) : JSON.stringify(body),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.user.count.mockResolvedValue(0);
  mocks.transactionUser.count.mockResolvedValue(0);
  mocks.transactionUser.create.mockResolvedValue({
    id: "first-user",
    username: "first_camper",
    email: "first@example.com",
  });
});

describe("first-run setup", () => {
  it("fails closed when setup status cannot reach the database", async () => {
    mocks.prisma.user.count.mockRejectedValueOnce(new Error("offline"));
    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      needsSetup: false,
      error: "Database unavailable",
    });
  });

  it("rejects malformed JSON before opening a transaction", async () => {
    const response = await setup("{", true);

    expect(response.status).toBe(400);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("serializes the empty-instance check with initial-user creation", async () => {
    const response = await setup({
      email: " FIRST@EXAMPLE.COM ",
      username: " first_camper ",
      password: "long-enough-password",
    });

    expect(response.status).toBe(200);
    expect(mocks.prisma.$transaction).toHaveBeenCalledOnce();
    expect(mocks.prisma.$transaction.mock.calls[0]?.[1]).toEqual({
      isolationLevel: "Serializable",
    });
    expect(mocks.transactionUser.create).toHaveBeenCalledWith({
      data: {
        email: "first@example.com",
        username: "first_camper",
        passwordHash: "hashed:long-enough-password",
      },
    });
    expect(mocks.auth.setTokenCookie).toHaveBeenCalledOnce();
  });

  it("returns a conflict after another request completes setup", async () => {
    mocks.transactionUser.count.mockResolvedValueOnce(1);
    const response = await setup({
      email: "second@example.com",
      username: "second_camper",
      password: "long-enough-password",
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Setup already complete",
    });
    expect(mocks.transactionUser.create).not.toHaveBeenCalled();
  });

  it("maps transaction write conflicts to a retry-safe conflict", async () => {
    mocks.prisma.$transaction.mockRejectedValueOnce({ code: "P2034" });
    const response = await setup({
      email: "racing@example.com",
      username: "racing_camper",
      password: "long-enough-password",
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Setup is already being completed",
    });
  });
});
