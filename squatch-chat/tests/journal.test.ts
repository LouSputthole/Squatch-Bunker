import { describe, expect, it } from "vitest";
import { journalSnapshot, normalizeJournalNote } from "@/lib/journal";

describe("Camp Journal", () => {
  it("normalizes optional notes", () => {
    expect(normalizeJournalNote(undefined)).toBeNull();
    expect(normalizeJournalNote("  remember this  ")).toBe("remember this");
    expect(normalizeJournalNote("x".repeat(501))).toBeNull();
  });

  it("captures message content and attachment metadata", () => {
    expect(journalSnapshot({ content: "trail map", attachmentUrl: "/uploads/map.png", attachmentName: "map.png" }))
      .toEqual({ content: "trail map", attachmentUrl: "/uploads/map.png", attachmentName: "map.png" });
  });
});
