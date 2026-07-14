import { describe, expect, it } from "vitest";
import { effectiveUserVolume } from "@/lib/voiceVolume";

describe("voice routing volume", () => {
  it("temporarily mutes routing without losing the listener's preferred volume", () => {
    expect(effectiveUserVolume(0.2, true)).toBe(0);
    expect(effectiveUserVolume(0.2, false)).toBe(0.2);
  });

  it("uses full volume when no preference has been saved", () => {
    expect(effectiveUserVolume(undefined, false)).toBe(1);
  });
});
