import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  isSafeCustomEmojiUrl,
  parseCustomEmojiToken,
  toCustomEmojiMap,
} from "@/lib/customEmoji";

const authMock = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => authMock);

import MessageBubble from "@/components/MessageBubble";
import { POST as react } from "@/app/api/messages/[messageId]/reactions/route";

const TestableMessageBubble = MessageBubble as unknown as ComponentType<Record<string, unknown>>;

describe("custom emoji helpers", () => {
  it("parses only well-formed :name: tokens", () => {
    expect(parseCustomEmojiToken(":campfire:")).toBe("campfire");
    expect(parseCustomEmojiToken(":big_smile_2:")).toBe("big_smile_2");
    expect(parseCustomEmojiToken("campfire")).toBeNull();
    expect(parseCustomEmojiToken(":with space:")).toBeNull();
    expect(parseCustomEmojiToken(`:${"x".repeat(33)}:`)).toBeNull();
    expect(parseCustomEmojiToken("🔥")).toBeNull();
  });

  it("accepts only same-origin uploaded images as emoji URLs", () => {
    expect(isSafeCustomEmojiUrl("/uploads/0a1b2c3d4e5f6a7b.png")).toBe(true);
    expect(isSafeCustomEmojiUrl("/uploads/abc.webp")).toBe(true);
    for (const url of [
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "https://tracker.example/pixel.png",
      "//evil.example/x.png",
      "/uploads/../secrets.png",
      "/uploads/x.svg",
      "/api/attachments/abc",
      42,
    ]) {
      expect(isSafeCustomEmojiUrl(url)).toBe(false);
    }
  });

  it("drops malformed rows when building the render map", () => {
    const map = toCustomEmojiMap([
      { id: "1", name: "campfire", url: "/uploads/fire.png" },
      { id: "2", name: "evil", url: "javascript:alert(1)" },
      { id: "3", name: "bad name", url: "/uploads/x.png" },
      null,
    ]);
    expect([...map]).toEqual([["campfire", "/uploads/fire.png"]]);
    expect(toCustomEmojiMap(undefined).size).toBe(0);
  });
});

describe("MessageBubble custom emoji rendering", () => {
  function render(content: string, customEmojis?: ReadonlyMap<string, string>, reactions = {}) {
    return renderToStaticMarkup(createElement(TestableMessageBubble, {
      message: {
        id: "m1",
        content,
        createdAt: new Date("2026-10-01T12:00:00Z").toISOString(),
        author: { id: "u1", username: "ember" },
        reactions,
      },
      isOwn: false,
      currentUserId: "u2",
      customEmojis,
    }));
  }

  it("renders known server emoji as images and leaves everything else as text", () => {
    const emojis = toCustomEmojiMap([{ name: "campfire", url: "/uploads/fire.png" }]);
    const html = render("hi :campfire: and :unknown: and `:campfire:`", emojis);
    expect(html.match(/<img[^>]*src="\/uploads\/fire.png"/g)).toHaveLength(1);
    expect(html).toContain('alt=":campfire:"');
    expect(html).toContain(":unknown:");
    expect(html).toContain("<code");
  });

  it("finds an emoji right after an unknown token", () => {
    const emojis = toCustomEmojiMap([{ name: "smile", url: "/uploads/smile.gif" }]);
    const html = render(":nope:smile:", emojis);
    expect(html.match(/<img[^>]*src="\/uploads\/smile.gif"/g)).toHaveLength(1);
    expect(html).toContain(":nope");
  });

  it("never renders an unsafe URL even if one reaches the map", () => {
    const html = render(":evil:", new Map([["evil", "javascript:alert(1)"]]));
    expect(html).not.toContain('alt=":evil:"');
    expect(html).not.toContain("javascript:");
    expect(html).toContain(":evil:");
  });

  it("keeps :name: as text without a server emoji list (DMs)", () => {
    const html = render("see :campfire:");
    expect(html).not.toContain('alt=":campfire:"');
    expect(html).toContain(":campfire:");
  });

  it("renders a custom reaction pill as its image", () => {
    const emojis = toCustomEmojiMap([{ name: "campfire", url: "/uploads/fire.png" }]);
    const html = render("hello", emojis, {
      ":campfire:": { count: 2, users: ["a", "b"], userIds: ["a", "b"] },
      "👍": { count: 1, users: ["a"], userIds: ["a"] },
    });
    expect(html.match(/<img[^>]*src="\/uploads\/fire.png"/g)).toHaveLength(1);
    expect(html).toContain("👍");
  });
});

describe("custom emoji reactions", () => {
  let member: { id: string; username: string };
  let messageId: string;

  function post(emoji: string) {
    return react(
      new NextRequest(`http://test.local/api/messages/${messageId}/reactions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ emoji }),
      }),
      { params: Promise.resolve({ messageId }) },
    );
  }

  beforeAll(async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    member = await prisma.user.create({
      data: {
        email: `custom-emoji-${suffix}@t.local`,
        username: `custom_emoji_${suffix}`,
        passwordHash: "x",
      },
    });
    const server = await prisma.server.create({
      data: {
        name: "Emoji camp",
        ownerId: member.id,
        members: { create: { userId: member.id, role: "owner" } },
        channels: { create: { name: "general", type: "text" } },
      },
      include: { channels: true },
    });
    const otherServer = await prisma.server.create({
      data: { name: "Other camp", ownerId: member.id },
    });
    await prisma.customEmoji.createMany({
      data: [
        { serverId: server.id, name: "campfire", url: "/uploads/fire.png", createdBy: member.id },
        { serverId: otherServer.id, name: "foreign", url: "/uploads/foreign.png", createdBy: member.id },
      ],
    });
    messageId = (await prisma.message.create({
      data: { channelId: server.channels[0].id, authorId: member.id, content: "react to me" },
    })).id;
    authMock.getSession.mockResolvedValue({ userId: member.id, username: member.username });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("accepts this server's emoji and rejects unknown or foreign ones", async () => {
    const added = await post(":campfire:");
    expect(added.status).toBe(200);
    await expect(added.json()).resolves.toMatchObject({
      reactions: { ":campfire:": { count: 1 } },
    });

    expect((await post(":nope:")).status).toBe(400);
    expect((await post(":foreign:")).status).toBe(400);
    await expect(prisma.reaction.count({ where: { messageId } })).resolves.toBe(1);
  });

  it("still lets a user remove a reaction whose emoji was deleted", async () => {
    await prisma.customEmoji.deleteMany({ where: { name: "campfire" } });
    const removed = await post(":campfire:");
    expect(removed.status).toBe(200);
    await expect(prisma.reaction.count({ where: { messageId } })).resolves.toBe(0);
  });
});
