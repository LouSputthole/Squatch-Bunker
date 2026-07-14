import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveUserMediaPath,
  userMediaCacheControl,
  userMediaContentType,
} from "@/lib/userMedia";

describe("user media paths", () => {
  const root = resolve("tests", ".tmp", "media");

  it("resolves only flat upload and avatar filenames", () => {
    expect(resolveUserMediaPath("/uploads/abc123.webm", root)).toBe(
      resolve(root, "uploads", "abc123.webm"),
    );
    expect(resolveUserMediaPath("/avatars/user-1.png", root)).toBe(
      resolve(root, "avatars", "user-1.png"),
    );
    expect(resolveUserMediaPath("/uploads/../secret.txt", root)).toBeNull();
    expect(resolveUserMediaPath("/uploads/%2e%2e%2fsecret.txt", root)).toBeNull();
    expect(resolveUserMediaPath("/other/file.png", root)).toBeNull();
  });

  it("serves known media with explicit content types", () => {
    expect(userMediaContentType("voice.webm")).toBe("audio/webm");
    expect(userMediaContentType("avatar.png")).toBe("image/png");
    expect(userMediaContentType("unknown.bin")).toBe("application/octet-stream");
  });

  it("revalidates replaceable avatars while caching immutable uploads", () => {
    expect(userMediaCacheControl("/uploads/random-id.png")).toContain("immutable");
    expect(userMediaCacheControl("/avatars/user-1.png")).toBe(
      "public, max-age=0, must-revalidate",
    );
  });
});
