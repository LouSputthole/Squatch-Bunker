import { describe, expect, it } from "vitest";
import { gatheringIcs } from "@/lib/gatherings";
import { journalMarkdown } from "@/lib/journal";

describe("gatheringIcs", () => {
  it("emits a UTC VEVENT with escaped text and CRLF lines", () => {
    const ics = gatheringIcs(
      {
        id: "g1",
        title: "Stories; snacks, songs",
        description: "Line one\nLine two",
        startsAt: "2026-10-01T18:30:00.000Z",
        endsAt: "2026-10-01T20:00:00.000Z",
      },
      new Date("2026-09-16T00:00:00.000Z"),
    );
    const lines = ics.split("\r\n");
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines).toContain("UID:g1@campfire");
    expect(lines).toContain("DTSTAMP:20260916T000000Z");
    expect(lines).toContain("DTSTART:20261001T183000Z");
    expect(lines).toContain("DTEND:20261001T200000Z");
    expect(lines).toContain("SUMMARY:Stories\\; snacks\\, songs");
    expect(lines).toContain("DESCRIPTION:Line one\\nLine two");
    expect(lines.at(-2)).toBe("END:VCALENDAR");
  });

  it("omits DESCRIPTION when there is none", () => {
    const ics = gatheringIcs({
      id: "g2",
      title: "Quiet hour",
      description: null,
      startsAt: "2026-10-01T18:30:00.000Z",
      endsAt: "2026-10-01T19:30:00.000Z",
    });
    expect(ics).not.toContain("DESCRIPTION");
  });
});

describe("journalMarkdown", () => {
  it("quotes every content line and keeps note, author and attachment", () => {
    const markdown = journalMarkdown([
      {
        content: "first\nsecond",
        note: "remember this",
        attachmentName: "map.png",
        createdAt: "2026-09-16T04:05:00.000Z",
        sourceMessage: { author: { username: "lou" } },
      },
      { content: "", note: null, createdAt: "2026-09-15T01:00:00.000Z", sourceMessage: null },
    ]);
    expect(markdown).toContain("## 2026-09-16 04:05 UTC · lou");
    expect(markdown).toContain("_remember this_");
    expect(markdown).toContain("> first\n> second");
    expect(markdown).toContain("Attachment: map.png");
    expect(markdown).toContain("## 2026-09-15 01:00 UTC\n");
  });
});
