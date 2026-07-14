import { describe, expect, it } from "vitest";
import {
  evaluateUploadPolicy,
  VOICE_NOTE_MAX_BYTES,
} from "@/lib/uploadPolicy";

const MB = 1024 * 1024;

describe("evaluateUploadPolicy", () => {
  it.each([
    ["Campfire voice note.webm", "audio/webm;codecs=opus", "webm"],
    ["Campfire voice note.ogg", "audio/ogg;codecs=opus", "ogg"],
    ["Campfire voice note.m4a", "audio/mp4", "m4a"],
  ])("accepts an explicit voice-note format: %s", (name, type, extension) => {
    expect(
      evaluateUploadPolicy({ name, type, size: VOICE_NOTE_MAX_BYTES }, 100 * MB),
    ).toEqual({
      allowed: true,
      extension,
      kind: "voice-note",
      maxBytes: VOICE_NOTE_MAX_BYTES,
    });
  });

  it("applies the strict voice-note ceiling even for premium uploads", () => {
    expect(
      evaluateUploadPolicy(
        {
          name: "Campfire voice note.webm",
          type: "audio/webm",
          size: VOICE_NOTE_MAX_BYTES + 1,
        },
        100 * MB,
      ),
    ).toMatchObject({
      allowed: false,
      status: 413,
      error: expect.stringContaining("Voice note too large"),
    });
  });

  it("rejects mismatched and unsupported audio formats", () => {
    expect(
      evaluateUploadPolicy(
        { name: "voice-note.txt", type: "audio/webm", size: MB },
        10 * MB,
      ),
    ).toMatchObject({ allowed: false, status: 400 });
    expect(
      evaluateUploadPolicy(
        { name: "voice-note.mp3", type: "audio/mpeg", size: MB },
        10 * MB,
      ),
    ).toEqual({
      allowed: false,
      error: "File type not allowed.",
      status: 400,
    });
  });

  it("preserves the caller-provided tier ceiling for standard files", () => {
    expect(
      evaluateUploadPolicy(
        { name: "campfire.png", type: "image/png", size: 11 * MB },
        10 * MB,
      ),
    ).toMatchObject({ allowed: false, status: 413 });
    expect(
      evaluateUploadPolicy(
        { name: "campfire.png", type: "image/png", size: 11 * MB },
        100 * MB,
      ),
    ).toMatchObject({ allowed: true, extension: "png", kind: "file" });
  });
});
