import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth";
import { POST } from "@/app/api/auth/register/route";

let requestNumber = 0;
const originalBetaAccessCode = process.env.CAMPFIRE_BETA_ACCESS_CODE;

afterEach(() => {
  if (originalBetaAccessCode === undefined) {
    delete process.env.CAMPFIRE_BETA_ACCESS_CODE;
  } else {
    process.env.CAMPFIRE_BETA_ACCESS_CODE = originalBetaAccessCode;
  }
});

function register(body: unknown, raw = false) {
  requestNumber += 1;
  return POST(new Request("http://test.local/api/auth/register", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `198.51.100.${requestNumber}`,
    },
    body: raw ? String(body) : JSON.stringify(body),
  }));
}

describe("POST /api/auth/register", () => {
  it("returns a client error for malformed JSON and malformed field types", async () => {
    expect((await register("{", true)).status).toBe(400);
    expect((await register({
      email: 7,
      username: "camper",
      password: "long-enough-password",
    })).status).toBe(400);
  });

  it("normalizes persisted identity fields and hashes the password", async () => {
    const response = await register({
      email: "  Register-Normalized@Example.COM ",
      username: "  register_normalized  ",
      password: "long-enough-password",
    });
    expect(response.status).toBe(201);

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: "register-normalized@example.com" },
    });
    expect(user.username).toBe("register_normalized");
    await expect(verifyPassword("long-enough-password", user.passwordHash)).resolves.toBe(true);
  });

  it("returns a stable conflict for normalized duplicate email", async () => {
    await prisma.user.create({
      data: {
        email: "register-duplicate@example.com",
        username: "register_duplicate_original",
        passwordHash: "x",
      },
    });

    const response = await register({
      email: " REGISTER-DUPLICATE@EXAMPLE.COM ",
      username: "register_duplicate_other",
      password: "long-enough-password",
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Email or username already taken",
    });
  });

  it("requires the configured beta access code before creating an account", async () => {
    const betaAccessCode = "beta-registration-code-0123456789";
    process.env.CAMPFIRE_BETA_ACCESS_CODE = betaAccessCode;
    const credentials = {
      email: "beta-registration@example.com",
      username: "beta_registration",
      password: "long-enough-password",
    };

    const blocked = await register({ ...credentials, betaAccessCode: "wrong" });
    expect(blocked.status).toBe(403);
    await expect(blocked.clone().json()).resolves.toEqual({ error: "Access denied" });
    const blockedBody = await blocked.text();
    expect(blockedBody).not.toContain(betaAccessCode);
    await expect(
      prisma.user.findUnique({ where: { email: credentials.email } }),
    ).resolves.toBeNull();

    const allowed = await register({ ...credentials, betaAccessCode });
    expect(allowed.status).toBe(201);
  });
});
