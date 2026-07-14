import { describe, expect, it } from "vitest";
import {
  isVoiceRoomMode,
  isVoiceRoomScene,
  normalizeVoiceRoomConfig,
  voiceRoomModeLabel,
} from "@/lib/voiceRoomConfig";

describe("voice-room configuration", () => {
  it("defaults new rooms to a Campfire hangout", () => {
    expect(normalizeVoiceRoomConfig({})).toEqual({
      roomMode: "hangout",
      roomScene: "campfire",
    });
  });

  it("uses a mode's own default scene when no scene is supplied", () => {
    expect(normalizeVoiceRoomConfig({ mode: "story-time" })).toEqual({
      roomMode: "story-time",
      roomScene: "forest",
    });
  });

  it("accepts an explicit shared scene", () => {
    expect(normalizeVoiceRoomConfig({ mode: "workshop", scene: "ocean" })).toEqual({
      roomMode: "workshop",
      roomScene: "ocean",
    });
  });

  it("rejects unknown modes and scenes", () => {
    expect(normalizeVoiceRoomConfig({ mode: "karaoke" })).toBeNull();
    expect(normalizeVoiceRoomConfig({ mode: "hangout", scene: "office" })).toBeNull();
    expect(isVoiceRoomMode("karaoke")).toBe(false);
    expect(isVoiceRoomScene("office")).toBe(false);
  });

  it("provides stable human labels with a safe fallback", () => {
    expect(voiceRoomModeLabel("quiet-room")).toBe("Quiet Room");
    expect(voiceRoomModeLabel("unknown")).toBe("Hangout");
  });
});
