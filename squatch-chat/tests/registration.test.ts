import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth";
import { POST } from "@/app/api/auth/register/route";

let requestNumber = 0;

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
});
