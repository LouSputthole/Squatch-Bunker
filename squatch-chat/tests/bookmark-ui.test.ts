import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("message bookmark UI", () => {
  it("wires every channel message bubble to the bookmark action and state", () => {
    const source = readFileSync(
      resolve(process.cwd(), "components/ChatPanel.tsx"),
      "utf8",
    );
    const messageBubbles = source.match(/<MessageBubble\b[\s\S]*?\/>/g) ?? [];

    expect(messageBubbles).toHaveLength(2);
    for (const messageBubble of messageBubbles) {
      expect(messageBubble).toContain("onBookmark={handleBookmark}");
      expect(messageBubble).toContain(
        "isBookmarked={bookmarkedMessageIds.has(msg.id)}",
      );
    }
  });
});
