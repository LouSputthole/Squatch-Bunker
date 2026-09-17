import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";

const authMock = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => authMock);

import { GET, PATCH, DELETE } from "@/app/api/notifications/route";
import {
  GET as getSettings,
  PATCH as patchSettings,
} from "@/app/api/notifications/settings/route";
import { POST as postFriendRequest } from "@/app/api/friends/route";
import {
  createChannelMessageNotifications,
  createFriendRequestNotification,
  extractMentionedUsernames,
  registerNotificationEmitter,
  resolveNotificationLevel,
  upsertDmNotification,
  MAX_MENTION_TARGETS,
} from "@/lib/notifications";

let authorId: string;
let memberId: string;
let strangerId: string;
let blockedId: string;
let serverId: string;
let channelId: string;
let hiddenChannelId: string;

function authenticate(userId = memberId, username = "ember_member") {
  authMock.getSession.mockResolvedValue({ userId, username });
}

function patchJson(body: unknown) {
  return PATCH(new Request("http://test.local/api/notifications", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never);
}

function baseMessageInput(content: string) {
  return {
    messageId: randomUUID(),
    channelId,
    channelName: "ember-general",
    serverId,
    authorId,
    authorUsername: "ember_author",
    content,
  };
}

beforeAll(async () => {
  const [author, member, stranger, blocked] = await Promise.all([
    prisma.user.create({
      data: { email: "ember-author@t.local", username: "ember_author", passwordHash: "x" },
    }),
    prisma.user.create({
      data: { email: "ember-member@t.local", username: "ember_member", passwordHash: "x" },
    }),
    prisma.user.create({
      data: { email: "ember-stranger@t.local", username: "ember_stranger", passwordHash: "x" },
    }),
    prisma.user.create({
      data: { email: "ember-blocked@t.local", username: "ember_blocked", passwordHash: "x" },
    }),
  ]);
  authorId = author.id;
  memberId = member.id;
  strangerId = stranger.id;
  blockedId = blocked.id;

  const server = await prisma.server.create({
    data: { name: "Ember camp", ownerId: authorId },
  });
  serverId = server.id;

  await prisma.serverMember.createMany({
    data: [
      { serverId, userId: authorId, role: "owner" },
      { serverId, userId: memberId, role: "member" },
      { serverId, userId: blockedId, role: "member" },
    ],
  });

  const [channel, hidden] = await Promise.all([
    prisma.channel.create({
      data: { serverId, name: "ember-general", type: "text" },
    }),
    prisma.channel.create({
      data: { serverId, name: "ember-hidden", type: "text" },
    }),
  ]);
  channelId = channel.id;
  hiddenChannelId = hidden.id;

  await prisma.channelPermission.create({
    data: { channelId: hiddenChannelId, role: "member", canView: false, canSend: false },
  });

  await prisma.userBlock.create({
    data: { blockerId: blockedId, blockedId: authorId },
  });
});

beforeEach(async () => {
  authenticate();
  await prisma.notification.deleteMany({});
  await prisma.notificationPreference.deleteMany({});
  await prisma.friendship.deleteMany({});
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("mention extraction", () => {
  it("finds unique usernames case-insensitively and caps the target list", () => {
    expect(extractMentionedUsernames("hi @Ember_Member and @ember_member!")).toEqual([
      "ember_member",
    ]);
    const many = Array.from({ length: 20 }, (_, i) => `@user${i}`).join(" ");
    expect(extractMentionedUsernames(many)).toHaveLength(MAX_MENTION_TARGETS);
    expect(extractMentionedUsernames("no mentions here")).toEqual([]);
  });
});

describe("notification policy resolution", () => {
  it("defaults to all and honors channel > server > global precedence", async () => {
    expect(await resolveNotificationLevel(memberId, serverId, channelId)).toBe("all");

    await prisma.notificationPreference.create({
      data: { userId: memberId, serverId: null, channelId: null, level: "none" },
    });
    expect(await resolveNotificationLevel(memberId, serverId, channelId)).toBe("none");

    await prisma.notificationPreference.create({
      data: { userId: memberId, serverId, channelId: null, level: "mentions" },
    });
    expect(await resolveNotificationLevel(memberId, serverId, channelId)).toBe("mentions");

    await prisma.notificationPreference.create({
      data: { userId: memberId, serverId, channelId, level: "all" },
    });
    expect(await resolveNotificationLevel(memberId, serverId, channelId)).toBe("all");
  });
});

describe("channel message notifications", () => {
  it("creates a mention notification for a mentioned, authorized member", async () => {
    const created = await createChannelMessageNotifications(
      baseMessageInput("welcome @ember_member to the fire"),
    );
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      userId: memberId,
      type: "mention",
      serverId,
      channelId,
      actorId: authorId,
    });
    expect(created[0].title).toContain("ember_author");
    expect(created[0].title).toContain("#ember-general");
  });

  it("matches mixed-case usernames and guest #tags as the composer inserts them", async () => {
    const [caps, guest, otherGuest] = await Promise.all([
      prisma.user.create({
        data: { email: "ember-caps@t.local", username: "EmberCaps", passwordHash: "x" },
      }),
      prisma.user.create({
        data: { email: "ember-guest@t.local", username: "Camper#ab12cd34", passwordHash: "x" },
      }),
      prisma.user.create({
        data: { email: "ember-guest2@t.local", username: "Camper#zz99yy88", passwordHash: "x" },
      }),
    ]);
    await prisma.serverMember.createMany({
      data: [caps, guest, otherGuest].map((user) => ({ serverId, userId: user.id, role: "member" })),
    });

    const tagged = await createChannelMessageNotifications(
      baseMessageInput("hey @EmberCaps and @Camper#ab12cd34"),
    );
    expect(tagged.map((n) => n.userId).sort()).toEqual([caps.id, guest.id].sort());

    // A bare display name reaches every member who shows up under it.
    const bare = await createChannelMessageNotifications(baseMessageInput("hey @camper"));
    expect(bare.map((n) => n.userId).sort()).toEqual([guest.id, otherGuest.id].sort());
  });

  it("creates a reply notification and prefers mention when both apply", async () => {
    const reply = await createChannelMessageNotifications({
      ...baseMessageInput("responding to your point"),
      replyToAuthorId: memberId,
    });
    expect(reply).toHaveLength(1);
    expect(reply[0].type).toBe("reply");

    const both = await createChannelMessageNotifications({
      ...baseMessageInput("@ember_member responding to your point"),
      replyToAuthorId: memberId,
    });
    expect(both).toHaveLength(1);
    expect(both[0].type).toBe("mention");
  });

  it("never notifies the author, non-members, or blocked pairs", async () => {
    const created = await createChannelMessageNotifications(
      baseMessageInput("@ember_author @ember_stranger @ember_blocked hello"),
    );
    expect(created).toHaveLength(0);
    expect(await prisma.notification.count()).toBe(0);
  });

  it("suppresses notifications in channels the recipient cannot view", async () => {
    const created = await createChannelMessageNotifications({
      ...baseMessageInput("@ember_member secret plans"),
      channelId: hiddenChannelId,
      channelName: "ember-hidden",
    });
    expect(created).toHaveLength(0);
  });

  it("honors a 'none' policy for the scope", async () => {
    await prisma.notificationPreference.create({
      data: { userId: memberId, serverId, channelId: null, level: "none" },
    });
    const created = await createChannelMessageNotifications(
      baseMessageInput("@ember_member are you there?"),
    );
    expect(created).toHaveLength(0);
  });
});

describe("dm notifications", () => {
  it("collapses to one unread entry per conversation", async () => {
    const conversationId = randomUUID();
    const first = await upsertDmNotification({
      conversationId,
      authorId,
      authorUsername: "ember_author",
      recipientId: memberId,
      content: "first message",
    });
    const second = await upsertDmNotification({
      conversationId,
      authorId,
      authorUsername: "ember_author",
      recipientId: memberId,
      content: "second message",
    });
    expect(second.id).toBe(first.id);
    expect(second.body).toBe("second message");
    expect(await prisma.notification.count({ where: { userId: memberId } })).toBe(1);

    // A read entry does not swallow the next message.
    await prisma.notification.update({
      where: { id: first.id },
      data: { readAt: new Date() },
    });
    const third = await upsertDmNotification({
      conversationId,
      authorId,
      authorUsername: "ember_author",
      recipientId: memberId,
      content: "third message",
    });
    expect(third.id).not.toBe(first.id);
  });
});

describe("notifications API", () => {
  it("requires authentication on every method", async () => {
    authMock.getSession.mockResolvedValue(null);
    const requests = [
      GET(new Request("http://test.local/api/notifications") as never),
      patchJson({ all: true }),
      DELETE(),
      getSettings(),
      patchSettings(new Request("http://test.local/api/notifications/settings", {
        method: "PATCH",
        body: "{}",
        headers: { "content-type": "application/json" },
      }) as never),
    ];
    for (const response of await Promise.all(requests)) {
      expect(response.status).toBe(401);
    }
  });

  it("lists only the caller's notifications with unread count and pagination", async () => {
    await createFriendRequestNotification(authorId, "ember_author", memberId);
    await createFriendRequestNotification(memberId, "ember_member", authorId);

    const response = await GET(new Request("http://test.local/api/notifications") as never);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.notifications).toHaveLength(1);
    expect(data.notifications[0].userId).toBe(memberId);
    expect(data.unreadCount).toBe(1);
    expect(data.nextCursor).toBeNull();
  });

  it("marks only the caller's own notifications read", async () => {
    const mine = await createFriendRequestNotification(authorId, "ember_author", memberId);
    const theirs = await createFriendRequestNotification(memberId, "ember_member", authorId);

    const response = await patchJson({ ids: [mine.id, theirs.id] });
    expect(response.status).toBe(200);
    expect((await response.json()).marked).toBe(1);

    const untouched = await prisma.notification.findUnique({ where: { id: theirs.id } });
    expect(untouched?.readAt).toBeNull();
  });

  it("marks all read and clears only the caller's inbox", async () => {
    await createFriendRequestNotification(authorId, "ember_author", memberId);
    await createFriendRequestNotification(memberId, "ember_member", authorId);

    await patchJson({ all: true });
    expect(await prisma.notification.count({
      where: { userId: memberId, readAt: null },
    })).toBe(0);

    await DELETE();
    expect(await prisma.notification.count({ where: { userId: memberId } })).toBe(0);
    expect(await prisma.notification.count({ where: { userId: authorId } })).toBe(1);
  });

  it("rejects an empty mark request", async () => {
    expect((await patchJson({})).status).toBe(400);
    expect((await patchJson({ ids: [] })).status).toBe(400);
  });
});

describe("quiet hours settings", () => {
  it("stores, returns, and clears the pair, rejecting invalid values", async () => {
    const set = await patchSettings(new Request("http://test.local/api/notifications/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ quietHoursStart: 22 * 60, quietHoursEnd: 7 * 60 }),
    }) as never);
    expect(set.status).toBe(200);
    expect(await set.json()).toEqual({ quietHoursStart: 1320, quietHoursEnd: 420 });

    const read = await getSettings();
    expect(await read.json()).toEqual({ quietHoursStart: 1320, quietHoursEnd: 420 });

    for (const body of [
      { quietHoursStart: 1440, quietHoursEnd: 0 },
      { quietHoursStart: -1, quietHoursEnd: 60 },
      { quietHoursStart: 60 },
      { quietHoursStart: null, quietHoursEnd: 60 },
    ]) {
      const bad = await patchSettings(new Request("http://test.local/api/notifications/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }) as never);
      expect(bad.status).toBe(400);
    }

    const cleared = await patchSettings(new Request("http://test.local/api/notifications/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ quietHoursStart: null, quietHoursEnd: null }),
    }) as never);
    expect(await cleared.json()).toEqual({ quietHoursStart: null, quietHoursEnd: null });
  });
});

describe("friend request integration", () => {
  it("creates and emits a durable notification for the addressee", async () => {
    const emitted: Array<{ userId: string; type: string }> = [];
    const unregister = registerNotificationEmitter((userId, notification) => {
      emitted.push({ userId, type: notification.type });
    });
    try {
      authenticate(authorId, "ember_author");
      const response = await postFriendRequest(new Request("http://test.local/api/friends", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "ember_stranger" }),
      }) as never);
      expect(response.status).toBe(200);

      const stored = await prisma.notification.findMany({ where: { userId: strangerId } });
      expect(stored).toHaveLength(1);
      expect(stored[0].type).toBe("friend_request");
      expect(stored[0].actorId).toBe(authorId);
      expect(emitted).toEqual([{ userId: strangerId, type: "friend_request" }]);
    } finally {
      unregister();
    }
  });
});
