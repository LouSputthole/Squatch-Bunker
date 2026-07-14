import { describe, expect, it, vi } from "vitest";
import { isPollClosed, parsePollDraft } from "@/lib/polls";

describe("Camp Vote validation", () => {
  it("normalizes a valid draft", () => {
    expect(parsePollDraft({ question: " Where next? ", options: [" Forest ", "Lake"], allowMultiple: true }))
      .toMatchObject({ question: "Where next?", options: ["Forest", "Lake"], allowMultiple: true, closesAt: null });
  });

  it("rejects too few, blank, or duplicate options", () => {
    expect(parsePollDraft({ question: "Q", options: ["one"] })).toBeNull();
    expect(parsePollDraft({ question: "Q", options: ["one", " "] })).toBeNull();
    expect(parsePollDraft({ question: "Q", options: ["Same", "same"] })).toBeNull();
  });

  it("rejects a close time in the past", () => {
    vi.setSystemTime(new Date("2026-07-12T12:00:00Z"));
    expect(parsePollDraft({ question: "Q", options: ["A", "B"], closesAt: "2026-07-12T11:59:00Z" })).toBeNull();
    vi.useRealTimers();
  });

  it("recognizes manual and scheduled closure", () => {
    const now = new Date("2026-07-12T12:00:00Z");
    expect(isPollClosed({ closesAt: null, closedAt: now }, now)).toBe(true);
    expect(isPollClosed({ closesAt: "2026-07-12T11:59:00Z", closedAt: null }, now)).toBe(true);
    expect(isPollClosed({ closesAt: "2026-07-12T12:01:00Z", closedAt: null }, now)).toBe(false);
  });
});
