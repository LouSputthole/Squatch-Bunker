import { describe, expect, it } from "vitest";
import { isInstanceAdmin } from "@/lib/instanceAdmin";

describe("instance admin allowlist", () => {
  it("denies everyone when INSTANCE_ADMIN_USER_IDS is unset or empty", () => {
    expect(isInstanceAdmin("user-1", undefined)).toBe(false);
    expect(isInstanceAdmin("user-1", "")).toBe(false);
    expect(isInstanceAdmin("user-1", " ,  , ")).toBe(false);
  });

  it("allows only exact user IDs from a comma-separated allowlist", () => {
    const allowlist = " user-1,admin-2 , user-3 ";
    expect(isInstanceAdmin("user-1", allowlist)).toBe(true);
    expect(isInstanceAdmin("admin-2", allowlist)).toBe(true);
    expect(isInstanceAdmin("user", allowlist)).toBe(false);
    expect(isInstanceAdmin("USER-1", allowlist)).toBe(false);
  });

  it("does not treat wildcard text as an implicit administrator", () => {
    expect(isInstanceAdmin("any-user", "*")).toBe(false);
  });

  it("uses INSTANCE_ADMIN_USER_IDS when no explicit policy string is passed", () => {
    const previous = process.env.INSTANCE_ADMIN_USER_IDS;
    process.env.INSTANCE_ADMIN_USER_IDS = "env-admin";
    try { expect(isInstanceAdmin("env-admin")).toBe(true); }
    finally { process.env.INSTANCE_ADMIN_USER_IDS = previous; }
  });
});
