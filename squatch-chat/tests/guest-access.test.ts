import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { POST } from "@/app/api/auth/guest/route";

const originalBetaAccessCode = process.env.CAMPFIRE_BETA_ACCESS_CODE;
let requestNumber = 0;

function guest(body: unknown) {
  requestNumber += 1;
  return POST(new Request("http://test.local/api/auth/guest", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `203.0.113.${requestNumber}`,
    },
    body: JSON.stringify(body),
  }));
}

afterEach(async () => {
  if (originalBetaAccessCode === undefined) {
    delete process.env.CAMPFIRE_BETA_ACCESS_CODE;
  } else {
    process.env.CAMPFIRE_BETA_ACCESS_CODE = originalBetaAccessCode;
  }
  await prisma.user.deleteMany({
    where: { username: { startsWith: "beta_guest_" } },
  });
});

describe("POST /api/auth/guest invited-beta access", () => {
  it("keeps guest entry open when no beta code is configured", async () => {
    delete process.env.CAMPFIRE_BETA_ACCESS_CODE;

    const response = await guest({ username: "beta_guest_open" });
    expect(response.status).toBe(201);
  });

  it("rejects missing or invalid codes and accepts the configured code", async () => {
    const betaAccessCode = "beta-guest-code-0123456789";
    process.env.CAMPFIRE_BETA_ACCESS_CODE = betaAccessCode;

    const missing = await guest({ username: "beta_guest_missing" });
    expect(missing.status).toBe(403);
    await expect(missing.json()).resolves.toEqual({ error: "Access denied" });

    const malformed = await guest(null);
    expect(malformed.status).toBe(403);
    await expect(malformed.json()).resolves.toEqual({ error: "Access denied" });

    const blocked = await guest({
      username: "beta_guest_blocked",
      betaAccessCode: "wrong",
    });
    expect(blocked.status).toBe(403);
    expect(await blocked.text()).not.toContain(betaAccessCode);

    const allowed = await guest({
      username: "beta_guest_allowed",
      betaAccessCode,
    });
    expect(allowed.status).toBe(201);
  });
});
