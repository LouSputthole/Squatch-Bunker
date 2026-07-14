import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createUser: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { user: { create: mocks.createUser } },
}));

import { POST } from "@/app/api/auth/guest/route";

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.CAMPFIRE_BETA_ACCESS_CODE;
});

describe("POST /api/auth/guest persistence", () => {
  it("fails closed without a session cookie when the guest record cannot be persisted", async () => {
    mocks.createUser.mockRejectedValueOnce({ code: "P1001" });

    const response = await POST(new Request("http://test.local/api/auth/guest", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.249",
      },
      body: JSON.stringify({ username: "unpersisted_guest" }),
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Guest sessions are temporarily unavailable",
    });
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
