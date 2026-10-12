import { describe, expect, it } from "vitest";
import {
  DEFAULT_CAMPFIRE_SCENES_URL,
  _normalizeSceneEmbedBase,
  roomSceneEmbedUrl,
  sceneEmbedOrigin,
} from "@/lib/sceneEmbed";

describe("voice-room 3D scene embed", () => {
  it("defaults to the official site and strips trailing slashes", () => {
    expect(_normalizeSceneEmbedBase(undefined)).toBe(DEFAULT_CAMPFIRE_SCENES_URL);
    expect(_normalizeSceneEmbedBase("")).toBe(DEFAULT_CAMPFIRE_SCENES_URL);
    expect(_normalizeSceneEmbedBase("https://scenes.example.com///")).toBe("https://scenes.example.com");
  });

  it("turns off with \"off\" or an origin that is not a plain http(s) origin", () => {
    expect(_normalizeSceneEmbedBase("off")).toBeNull();
    expect(_normalizeSceneEmbedBase("javascript:alert(1)")).toBeNull();
    expect(_normalizeSceneEmbedBase("https://scenes.example.com/path")).toBeNull();
    expect(roomSceneEmbedUrl("ocean", null)).toBeNull();
  });

  it("builds the embed URL and the postMessage origin", () => {
    expect(roomSceneEmbedUrl("ocean", "https://scenes.example.com")).toBe("https://scenes.example.com/room?room=ocean");
    expect(roomSceneEmbedUrl("a b", "https://scenes.example.com")).toBe("https://scenes.example.com/room?room=a%20b");
    expect(sceneEmbedOrigin("https://scenes.example.com")).toBe("https://scenes.example.com");
    expect(sceneEmbedOrigin(null)).toBeNull();
  });
});
