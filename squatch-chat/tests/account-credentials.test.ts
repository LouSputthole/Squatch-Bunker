import { describe, expect, it } from "vitest";
import {
  parseAccountCredentials,
  passwordValidationError,
} from "@/lib/accountCredentials";

describe("account credential validation", () => {
  it("normalizes email and surrounding username whitespace", () => {
    expect(parseAccountCredentials({
      email: "  Camper@Example.COM ",
      username: "  Trail Guide  ",
      password: "long-enough-password",
    })).toEqual({
      ok: true,
      value: {
        email: "camper@example.com",
        username: "Trail Guide",
        password: "long-enough-password",
      },
    });
  });

  it.each([
    null,
    [],
    {},
    { email: 7, username: "camper", password: "long-enough-password" },
  ])("rejects malformed credential bodies", (body) => {
    expect(parseAccountCredentials(body)).toMatchObject({ ok: false });
  });

  it("rejects malformed or oversized email addresses", () => {
    expect(parseAccountCredentials({
      email: "not-an-email",
      username: "camper",
      password: "long-enough-password",
    })).toMatchObject({ ok: false, error: "Enter a valid email address" });
    expect(parseAccountCredentials({
      email: `${"x".repeat(250)}@example.com`,
      username: "camper",
      password: "long-enough-password",
    })).toMatchObject({ ok: false, error: "Enter a valid email address" });
  });

  it("bounds usernames", () => {
    for (const username of ["x", "x".repeat(33)]) {
      expect(parseAccountCredentials({
        email: "camper@example.com",
        username,
        password: "long-enough-password",
      })).toMatchObject({ ok: false, error: "Username must be 2-32 characters" });
    }
  });

  it("bounds password work", () => {
    expect(passwordValidationError("short")).toBe("Password must be at least 8 characters");
    expect(passwordValidationError("x".repeat(129))).toBe("Password must be at most 128 characters");
    expect(passwordValidationError("exactly-eight")).toBeNull();
  });
});
