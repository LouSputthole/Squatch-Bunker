import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { io as ioc, type Socket as ClientSocket } from "socket.io-client";
import type { Server as IOServer } from "socket.io";
import { prisma } from "@/lib/db";
import { createToken } from "@/lib/auth";
import { notifyRealtimeAuthorizationChange } from "@/lib/realtimeControl";
import { attachSocketIO } from "@/realtime/server";

// Boots the realtime server in-process on an ephemeral port and drives it with
// real socket.io clients. Seeds two members (A, B) of server S / channel C /
// voice channel V, plus a non-member X, then checks the server's own
// authorization gates (membership + shared-voice-room) rather than trusting the
// client. Negative assertions wait a short real timeout for an event that must
// never arrive.

const SOCKET_PATH = "/api/socketio";

let httpServer: HttpServer;
let io: IOServer;
let limiterNow: number | null = null;
let port: number;
let serverId: string;
let channelC: string;
let channelV: string;
let channelHidden: string;
let channelHiddenVoice: string;
let channelReadOnly: string;
let tokenA: string;
let tokenB: string;
let tokenX: string;
let tokenC: string;
let userAId: string;
let userBId: string;
let userCId: string;

// Every client opened by connect() is tracked and torn down after each test so
// server-side presence/voice state (keyed by userId) doesn't leak between tests.
const openSockets: ClientSocket[] = [];

function connect(token?: string, origin?: string): Promise<ClientSocket> {
  const socket = ioc(`http://localhost:${port}`, {
    path: SOCKET_PATH,
    transports: ["websocket"],
    reconnection: false,
    forceNew: true,
    extraHeaders: {
      ...(token ? { cookie: `squatch-token=${token}` } : {}),
      ...(origin ? { origin } : {}),
    },
  });
  openSockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", (err) => reject(err));
  });
}

function waitFor<T = unknown>(socket: ClientSocket, event: string, timeout = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for "${event}"`)), timeout);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

// Resolves only if `event` does NOT fire within `wait` ms.
function expectNoEvent(socket: ClientSocket, event: string, wait = 300): Promise<void> {
  return new Promise((resolve, reject) => {
    const handler = () => reject(new Error(`received "${event}" but expected none`));
    socket.once(event, handler);
    setTimeout(() => {
      socket.off(event, handler);
      resolve();
    }, wait);
  });
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// channel:join has no ack event; give the async membership check time to land
// the socket in the room before asserting on room broadcasts.
async function joinChannel(socket: ClientSocket, channelId: string) {
  socket.emit("channel:join", channelId);
  await delay(200);
}

// voice:join DOES confirm to the joiner via "voice:participants".
async function joinVoice(socket: ClientSocket, channelId: string) {
  const confirmed = waitFor(socket, "voice:participants");
  socket.emit("voice:join", channelId);
  await confirmed;
}

beforeAll(async () => {
  const userA = await prisma.user.create({
    data: { email: "authz-a@t.local", username: "authz_a", passwordHash: "x" },
  });
  const userB = await prisma.user.create({
    data: { email: "authz-b@t.local", username: "authz_b", passwordHash: "x" },
  });
  const userX = await prisma.user.create({
    data: { email: "authz-x@t.local", username: "authz_x", passwordHash: "x" },
  });
  const userC = await prisma.user.create({
    data: { email: "authz-c@t.local", username: "authz_c", passwordHash: "x" },
  });
  userAId = userA.id;
  userBId = userB.id;
  userCId = userC.id;

  const server = await prisma.server.create({ data: { name: "S", ownerId: userA.id } });
  serverId = server.id;
  await prisma.serverMember.create({ data: { serverId, userId: userA.id, role: "owner" } });
  await prisma.serverMember.create({ data: { serverId, userId: userB.id, role: "member" } });
  await prisma.serverMember.create({ data: { serverId, userId: userC.id, role: "member" } });
  // X is intentionally NOT a member of S.

  const c = await prisma.channel.create({ data: { serverId, name: "general", type: "text" } });
  const v = await prisma.channel.create({ data: { serverId, name: "Voice", type: "voice" } });
  const hidden = await prisma.channel.create({ data: { serverId, name: "hidden", type: "text" } });
  const hiddenVoice = await prisma.channel.create({ data: { serverId, name: "hidden-voice", type: "voice" } });
  const readOnly = await prisma.channel.create({ data: { serverId, name: "read-only", type: "text" } });
  channelC = c.id;
  channelV = v.id;
  channelHidden = hidden.id;
  channelHiddenVoice = hiddenVoice.id;
  channelReadOnly = readOnly.id;

  await prisma.channelPermission.createMany({
    data: [
      { channelId: channelHidden, role: "member", canView: false, canSend: false },
      { channelId: channelHiddenVoice, role: "member", canView: false, canSend: false },
      { channelId: channelReadOnly, role: "member", canView: true, canSend: false },
    ],
  });

  tokenA = createToken({ userId: userA.id, username: userA.username });
  tokenB = createToken({ userId: userB.id, username: userB.username });
  tokenX = createToken({ userId: userX.id, username: userX.username });
  tokenC = createToken({ userId: userC.id, username: userC.username });

  httpServer = createServer();
  io = attachSocketIO(httpServer, {
    rateLimitNow: () => limiterNow ?? Date.now(),
  });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  port = (httpServer.address() as AddressInfo).port;
});

afterEach(async () => {
  for (const s of openSockets) s.disconnect();
  openSockets.length = 0;
  // Let the server process disconnects (which tear down voice/presence state).
  await delay(60);
});

afterAll(async () => {
  io.close();
  httpServer.close();
  await prisma.$disconnect();
});

describe("socket handshake auth", () => {
  it("rejects a connection with no token", async () => {
    await expect(connect()).rejects.toBeDefined();
  });

  it("rejects a connection with a garbage token", async () => {
    await expect(connect("not.a.valid.jwt")).rejects.toBeDefined();
  });

  it("accepts a connection with a valid token", async () => {
    const a = await connect(tokenA);
    expect(a.connected).toBe(true);
  });

  it("rejects a valid ambient session from a hostile browser origin", async () => {
    await expect(connect(tokenA, "https://evil.example")).rejects.toBeDefined();
  });
});

describe("channel membership gates", () => {
  it("does not deliver typing from a non-member to channel members", async () => {
    const a = await connect(tokenA);
    const b = await connect(tokenB);
    const x = await connect(tokenX);
    await joinChannel(a, channelC);
    await joinChannel(b, channelC);

    const noTyping = expectNoEvent(b, "typing:update", 300);
    x.emit("typing:start", channelC);
    await expect(noTyping).resolves.toBeUndefined();
  });

  it("delivers typing between channel members", async () => {
    const a = await connect(tokenA);
    const b = await connect(tokenB);
    await joinChannel(a, channelC);
    await joinChannel(b, channelC);

    const typing = waitFor<{ channelId: string; userId: string; isTyping: boolean }>(b, "typing:update");
    a.emit("typing:start", channelC);
    const evt = await typing;
    expect(evt).toMatchObject({ channelId: channelC, isTyping: true });
  });

  it("only relays a persisted message and replaces spoofed fields with the DB snapshot", async () => {
    const a = await connect(tokenA);
    const b = await connect(tokenB);
    const x = await connect(tokenX);
    await joinChannel(a, channelC);
    await joinChannel(b, channelC);

    const channelEvent = `message:channel:${channelC}`;

    const noNonMemberMessage = expectNoEvent(b, channelEvent, 300);
    x.emit("message:send", {
      channelId: channelC,
      message: { id: "m1", content: "sneaky", createdAt: new Date().toISOString(), author: { id: "spoof", username: "spoof" } },
    });
    await expect(noNonMemberMessage).resolves.toBeUndefined();

    const noPhantomMessage = expectNoEvent(b, channelEvent, 300);
    a.emit("message:send", {
      channelId: channelC,
      message: { id: "not-persisted", content: "phantom", createdAt: new Date().toISOString(), author: { id: "spoof", username: "spoof" } },
    });
    await expect(noPhantomMessage).resolves.toBeUndefined();

    const persisted = await prisma.message.create({
      data: { channelId: channelC, authorId: userAId, content: "database truth" },
    });
    const incoming = waitFor<{ id: string; content: string; author: { id: string; username: string } }>(b, channelEvent);
    a.emit("message:send", {
      channelId: channelC,
      message: {
        id: persisted.id,
        content: "spoofed content",
        createdAt: new Date(0).toISOString(),
        author: { id: "spoof", username: "spoof" },
      },
    });
    const msg = await incoming;
    expect(msg).toMatchObject({
      id: persisted.id,
      content: "database truth",
      author: { id: userAId, username: "authz_a" },
    });
  });

  it("bounds each message and poll relay independently and recovers after the limit window", async () => {
    const rateSuffix = crypto.randomUUID().slice(0, 8);
    const rateUser = await prisma.user.create({
      data: {
        email: "realtime-rate-" + rateSuffix + "@t.local",
        username: "realtime_rate_" + rateSuffix,
        passwordHash: "x",
      },
    });
    await prisma.serverMember.create({
      data: { serverId, userId: rateUser.id, role: "member" },
    });
    const rateToken = createToken({ userId: rateUser.id, username: rateUser.username });
    const a = await connect(rateToken);
    const secondA = await connect(rateToken);
    const b = await connect(tokenB);
    await joinChannel(a, channelC);
    await joinChannel(secondA, channelC);
    await joinChannel(b, channelC);

    const sent = await prisma.message.create({
      data: { channelId: channelC, authorId: rateUser.id, content: "bounded send" },
    });
    const edited = await prisma.message.create({
      data: { channelId: channelC, authorId: rateUser.id, content: "bounded edit" },
    });
    const reacted = await prisma.message.create({
      data: { channelId: channelC, authorId: rateUser.id, content: "bounded reaction" },
    });
    const pollMessage = await prisma.message.create({
      data: { channelId: channelC, authorId: rateUser.id, content: "bounded poll" },
    });
    const poll = await prisma.poll.create({
      data: {
        serverId,
        channelId: channelC,
        messageId: pollMessage.id,
        creatorId: rateUser.id,
        question: "How many relays?",
        options: { create: [{ text: "Thirty", position: 0 }, { text: "Unbounded", position: 1 }] },
      },
    });

    const baseTime = Date.now();
    limiterNow = baseTime;
    const allowedPerWindow = Number.parseInt(process.env.RATE_LIMIT_REQUESTS ?? "30", 10);
    const windowMs = Number.parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? "60000", 10);

    async function exhaust(event: string, emit: (source: ClientSocket) => void) {
      for (let index = 0; index < allowedPerWindow; index += 1) {
        const relayed = waitFor(b, event);
        emit(a);
        await relayed;
      }
      const rejected = expectNoEvent(b, event);
      emit(secondA);
      await rejected;
    }

    try {
      await exhaust(`message:channel:${channelC}`, (source) => {
        source.emit("message:send", { channelId: channelC, message: { id: sent.id } });
      });
      await exhaust(`message:edited:${channelC}`, (source) => {
        source.emit("message:edit", { channelId: channelC, messageId: edited.id });
      });
      await exhaust(`message:deleted:${channelC}`, (source) => {
        source.emit("message:delete", { channelId: channelC, messageId: "already-deleted" });
      });
      await exhaust(`message:reacted:${channelC}`, (source) => {
        source.emit("message:react", { channelId: channelC, messageId: reacted.id });
      });
      await exhaust(`poll:updated:${channelC}`, (source) => {
        source.emit("poll:update", { channelId: channelC, pollId: poll.id });
      });

      limiterNow = baseTime + windowMs + 1;
      const recovered = waitFor<{ id: string }>(b, `message:channel:${channelC}`);
      a.emit("message:send", { channelId: channelC, message: { id: sent.id } });
      await expect(recovered).resolves.toMatchObject({ id: sent.id });
    } finally {
      limiterNow = null;
    }
  });

  it("keeps hidden joins and read-only sends in parity with HTTP access", async () => {
    const owner = await connect(tokenA);
    const member = await connect(tokenB);

    await joinChannel(owner, channelHidden);
    await joinChannel(member, channelHidden);
    expect(io.sockets.sockets.get(owner.id!)?.rooms.has(`channel:${channelHidden}`)).toBe(true);
    expect(io.sockets.sockets.get(member.id!)?.rooms.has(`channel:${channelHidden}`)).toBe(false);

    await joinChannel(owner, channelReadOnly);
    await joinChannel(member, channelReadOnly);
    expect(io.sockets.sockets.get(member.id!)?.rooms.has(`channel:${channelReadOnly}`)).toBe(true);

    const event = `message:channel:${channelReadOnly}`;
    const noMessage = expectNoEvent(owner, event, 300);
    member.emit("message:send", {
      channelId: channelReadOnly,
      message: {
        id: "read-only-message",
        content: "must not broadcast",
        createdAt: new Date().toISOString(),
        author: { id: "spoof", username: "spoof" },
      },
    });
    await expect(noMessage).resolves.toBeUndefined();
  });

  it("does not broadcast typing from a member who cannot send", async () => {
    const owner = await connect(tokenA);
    const member = await connect(tokenB);
    await joinChannel(owner, channelReadOnly);
    await joinChannel(member, channelReadOnly);

    const noTyping = expectNoEvent(owner, "typing:update", 300);
    member.emit("typing:start", channelReadOnly);
    await expect(noTyping).resolves.toBeUndefined();
  });
});

describe("direct-message delivery", () => {
  it("relays only a persisted sender-owned DM to the conversation and recipient user room", async () => {
    const a = await connect(tokenA);
    const b = await connect(tokenB);
    const conversation = await prisma.conversation.create({
      data: { user1Id: userAId, user2Id: userBId },
    });
    a.emit("dm:join", conversation.id);
    b.emit("dm:join", conversation.id);
    await delay(200);

    const noPhantom = expectNoEvent(b, "dm:message", 300);
    a.emit("dm:send", { conversationId: conversation.id, messageId: "not-persisted" });
    await expect(noPhantom).resolves.toBeUndefined();

    const persisted = await prisma.directMessage.create({
      data: {
        conversationId: conversation.id,
        authorId: userAId,
        content: "Meet by the fire",
      },
    });
    const incoming = waitFor<{ id: string; content: string; authorId: string }>(b, "dm:message");
    const notification = waitFor<{ id: string }>(b, "dm:notification");
    a.emit("dm:send", { conversationId: conversation.id, messageId: persisted.id });

    await expect(incoming).resolves.toMatchObject({
      id: persisted.id,
      content: "Meet by the fire",
      authorId: userAId,
    });
    await expect(notification).resolves.toMatchObject({ id: persisted.id });
  });

  it("stops typing relays after either participant blocks the other", async () => {
    const a = await connect(tokenA);
    const b = await connect(tokenB);
    const conversation = await prisma.conversation.findUnique({
      where: { user1Id_user2Id: { user1Id: userAId, user2Id: userBId } },
    }) ?? await prisma.conversation.create({
        data: { user1Id: userAId, user2Id: userBId },
      });
    a.emit("dm:join", conversation.id);
    b.emit("dm:join", conversation.id);
    await delay(200);

    await prisma.userBlock.create({
      data: { blockerId: userAId, blockedId: userBId },
    });
    try {
      const noTyping = expectNoEvent(a, "dm:typing", 300);
      b.emit("dm:typing", { conversationId: conversation.id });
      await expect(noTyping).resolves.toBeUndefined();
    } finally {
      await prisma.userBlock.deleteMany({
        where: { blockerId: userAId, blockedId: userBId },
      });
    }
  });
});

// server:join confirms to the joiner (and the room) via "presence:update".
async function joinServer(socket: ClientSocket, sid: string) {
  const confirmed = waitFor(socket, "presence:update");
  socket.emit("server:join", sid);
  await confirmed;
}

describe("channel lifecycle broadcasts", () => {
  it("broadcasts a created channel to server members with the DB row, and drops a non-member's emit", async () => {
    const a = await connect(tokenA);
    const b = await connect(tokenB);
    const x = await connect(tokenX);
    await joinServer(a, serverId);
    await joinServer(b, serverId);

    // Non-member X: no broadcast, even for a channel that exists.
    const noCreate = expectNoEvent(b, "channel:created", 300);
    x.emit("channel:created", { serverId, channelId: channelC });
    await expect(noCreate).resolves.toBeUndefined();

    // Member A announces a channel the REST route just created: B receives the
    // DB-authoritative row (name comes from the DB, not the payload).
    const created = await prisma.channel.create({ data: { serverId, name: "announcements", type: "text" } });
    const incoming = waitFor<{ serverId: string; channels: { id: string; name: string }[] }>(b, "channel:created");
    a.emit("channel:created", { serverId, channelId: created.id });
    const evt = await incoming;
    expect(evt.serverId).toBe(serverId);
    expect(evt.channels).toHaveLength(1);
    expect(evt.channels[0]).toMatchObject({ id: created.id, name: "announcements" });
  });

  it("broadcasts authoritative voice-room scenes to the sender and peers", async () => {
    const a = await connect(tokenA);
    const b = await connect(tokenB);
    await joinServer(a, serverId);
    await joinServer(b, serverId);

    await prisma.channel.update({
      where: { id: channelV },
      data: { roomMode: "focus", roomScene: "forest" },
    });

    type SharedSceneEvent = { serverId: string; channels: { id: string; roomMode: string; roomScene: string }[] };

    const sender = waitFor<SharedSceneEvent>(a, "channels:updated");
    const peer = waitFor<SharedSceneEvent>(b, "channels:updated");
    a.emit("channels:updated", { serverId, channelIds: [channelV] });

    const [senderEvent, peerEvent] = await Promise.all([sender, peer]);
    expect(senderEvent.channels[0]).toMatchObject({ id: channelV, roomMode: "focus", roomScene: "forest" });
    expect(peerEvent.channels[0]).toMatchObject({ id: channelV, roomMode: "focus", roomScene: "forest" });
  });

  it("filters channel snapshots separately for each server-room viewer", async () => {
    const owner = await connect(tokenA);
    const member = await connect(tokenB);
    await joinServer(owner, serverId);
    await joinServer(member, serverId);

    type Snapshot = { serverId: string; channels: { id: string }[] };
    const ownerSnapshot = waitFor<Snapshot>(owner, "channels:updated");
    const memberSnapshot = waitFor<Snapshot>(member, "channels:updated");
    owner.emit("channels:updated", {
      serverId,
      channelIds: [channelC, channelHidden, channelHiddenVoice],
    });

    const [ownerEvent, memberEvent] = await Promise.all([ownerSnapshot, memberSnapshot]);
    expect(ownerEvent.channels.map((channel) => channel.id).sort()).toEqual(
      [channelC, channelHidden, channelHiddenVoice].sort(),
    );
    expect(memberEvent.channels.map((channel) => channel.id)).toEqual([channelC]);
  });

  it("does not broadcast a channel that does not exist in that server", async () => {
    const a = await connect(tokenA);
    const b = await connect(tokenB);
    await joinServer(a, serverId);
    await joinServer(b, serverId);

    const noCreate = expectNoEvent(b, "channel:created", 300);
    a.emit("channel:created", { serverId, channelId: "00000000-0000-0000-0000-000000000000" });
    await expect(noCreate).resolves.toBeUndefined();
  });

  it("broadcasts channel:deleted only after the row is really gone", async () => {
    const a = await connect(tokenA);
    const b = await connect(tokenB);
    await joinServer(a, serverId);
    await joinServer(b, serverId);

    const doomed = await prisma.channel.create({ data: { serverId, name: "doomed", type: "text" } });

    // Row still exists — the "deletion" is a lie, nothing is broadcast.
    const noDelete = expectNoEvent(b, "channel:deleted", 300);
    a.emit("channel:deleted", { serverId, channelId: doomed.id });
    await expect(noDelete).resolves.toBeUndefined();

    // After the REST route really deleted it, the notification relays.
    await prisma.channel.delete({ where: { id: doomed.id } });
    const incoming = waitFor<{ serverId: string; channelId: string }>(b, "channel:deleted");
    a.emit("channel:deleted", { serverId, channelId: doomed.id });
    const evt = await incoming;
    expect(evt).toMatchObject({ serverId, channelId: doomed.id });
  });
});

describe("voice signaling gates", () => {
  it("relays a voice:offer between two members of the same voice room", async () => {
    const a = await connect(tokenA);
    const b = await connect(tokenB);
    await joinVoice(a, channelV);
    await joinVoice(b, channelV);

    const offerP = waitFor<{ fromUserId: string; offer: { type: string } }>(b, "voice:offer");
    a.emit("voice:offer", { to: b.id, channelId: channelV, offer: { type: "offer", sdp: "x" } });
    const offer = await offerP;
    expect(offer.offer).toMatchObject({ type: "offer" });
    expect(offer.fromUserId).toBeTruthy();
  });

  it("rejects a voice join when effective channel visibility is denied", async () => {
    const member = await connect(tokenB);
    const noParticipants = expectNoEvent(member, "voice:participants", 300);
    member.emit("voice:join", channelHiddenVoice);
    await expect(noParticipants).resolves.toBeUndefined();
    expect(
      io.sockets.sockets.get(member.id!)?.rooms.has(`voice:${channelHiddenVoice}`),
    ).toBe(false);
  });

  it("does not leak a hidden voice roster through the server room", async () => {
    const owner = await connect(tokenA);
    const member = await connect(tokenB);
    await joinServer(owner, serverId);
    await joinServer(member, serverId);

    const noHiddenRoster = expectNoEvent(member, "voice:participants-update", 300);
    await joinVoice(owner, channelHiddenVoice);
    await expect(noHiddenRoster).resolves.toBeUndefined();
  });
});

describe("authoritative voice moderation", () => {
  it("honors a custom moderation grant assigned after the socket joined", async () => {
    const moderator = await connect(tokenB);
    const target = await connect(tokenC);
    await joinServer(moderator, serverId);
    await joinVoice(moderator, channelV);
    await joinVoice(target, channelV);

    const member = await prisma.serverMember.findUniqueOrThrow({
      where: { serverId_userId: { serverId, userId: userBId } },
      select: { id: true },
    });
    const role = await prisma.role.create({
      data: {
        serverId,
        name: "Voice guide",
        permissions: JSON.stringify(["MUTE_MEMBERS"]),
        position: 10,
      },
    });
    await prisma.serverMemberRole.create({
      data: { memberId: member.id, roleId: role.id },
    });

    try {
      const forcedMute = waitFor<{ muted: boolean }>(target, "mod:force-mute");
      moderator.emit("mod:server-mute", {
        channelId: channelV,
        targetUserId: userCId,
        muted: true,
      });
      await expect(forcedMute).resolves.toMatchObject({ muted: true });
    } finally {
      await prisma.role.delete({ where: { id: role.id } });
    }
  });

  it("rejects a cached moderator immediately after authoritative demotion", async () => {
    await prisma.serverMember.update({
      where: { serverId_userId: { serverId, userId: userBId } },
      data: { role: "mod" },
    });
    const moderator = await connect(tokenB);
    const target = await connect(tokenC);
    await joinServer(moderator, serverId);
    await joinVoice(moderator, channelV);
    await joinVoice(target, channelV);

    await prisma.serverMember.update({
      where: { serverId_userId: { serverId, userId: userBId } },
      data: { role: "member" },
    });
    try {
      const noForcedMute = expectNoEvent(target, "mod:force-mute", 300);
      moderator.emit("mod:server-mute", {
        channelId: channelV,
        targetUserId: userCId,
        muted: true,
      });
      await expect(noForcedMute).resolves.toBeUndefined();
    } finally {
      await prisma.serverMember.update({
        where: { serverId_userId: { serverId, userId: userBId } },
        data: { role: "member" },
      });
    }
  });

  it("leaves voice state unchanged for every invalid move destination", async () => {
    const owner = await connect(tokenA);
    const target = await connect(tokenB);
    await joinVoice(owner, channelV);
    await joinVoice(target, channelV);

    const otherServer = await prisma.server.create({
      data: { name: "Other realtime server", ownerId: userAId },
    });
    const otherVoice = await prisma.channel.create({
      data: { serverId: otherServer.id, name: "Other voice", type: "voice" },
    });

    try {
      const invalidDestinations = [
        "00000000-0000-0000-0000-000000000000",
        channelC,
        otherVoice.id,
        channelHiddenVoice,
      ];
      for (const destination of invalidDestinations) {
        const noMove = expectNoEvent(target, "mod:moved-to-channel", 250);
        owner.emit("mod:move-user", {
          fromChannelId: channelV,
          toChannelId: destination,
          targetUserId: userBId,
        });
        await expect(noMove).resolves.toBeUndefined();
        const targetRooms = io.sockets.sockets.get(target.id!)?.rooms;
        expect(targetRooms?.has(`voice:${channelV}`)).toBe(true);
        expect(targetRooms?.has(`voice:${destination}`)).toBe(false);
      }
    } finally {
      await prisma.channel.delete({ where: { id: otherVoice.id } });
      await prisma.server.delete({ where: { id: otherServer.id } });
    }
  });
});

describe("live authorization refresh", () => {
  it("disconnects every active socket after a user session is revoked", async () => {
    const first = await connect(tokenC);
    const second = await connect(tokenC);
    await joinServer(first, serverId);
    await joinServer(second, serverId);
    await joinChannel(first, channelC);
    await joinVoice(first, channelV);

    const firstId = first.id!;
    const secondId = second.id!;
    const disconnected = Promise.all([
      new Promise<void>((resolve) => first.once("disconnect", () => resolve())),
      new Promise<void>((resolve) => second.once("disconnect", () => resolve())),
    ]);

    await prisma.user.update({
      where: { id: userCId },
      data: { tokenVersion: { increment: 1 } },
    });
    try {
      await notifyRealtimeAuthorizationChange({
        scope: "session",
        userId: userCId,
      });
      await disconnected;

      expect(first.connected).toBe(false);
      expect(second.connected).toBe(false);
      expect(io.sockets.sockets.has(firstId)).toBe(false);
      expect(io.sockets.sockets.has(secondId)).toBe(false);
      expect(io.sockets.adapter.rooms.get(`server:${serverId}`)?.has(firstId)).not.toBe(true);
      expect(io.sockets.adapter.rooms.get(`channel:${channelC}`)?.has(firstId)).not.toBe(true);
      expect(io.sockets.adapter.rooms.get(`voice:${channelV}`)?.has(firstId)).not.toBe(true);
      await expect(connect(tokenC)).rejects.toBeDefined();
    } finally {
      await prisma.user.update({
        where: { id: userCId },
        data: { tokenVersion: 0 },
      });
    }
  });

  it("evicts a banned member from server, channel, voice, and lantern state", async () => {
    const owner = await connect(tokenA);
    const member = await connect(tokenB);
    await joinServer(owner, serverId);
    await joinServer(member, serverId);
    await joinChannel(member, channelC);
    await joinVoice(owner, channelV);
    await joinVoice(member, channelV);

    const lanternStarted = waitFor<{ holderId: string }>(owner, "lantern:update");
    member.emit("lantern:start", channelV);
    await expect(lanternStarted).resolves.toMatchObject({ holderId: userBId });

    await prisma.serverMember.update({
      where: { serverId_userId: { serverId, userId: userBId } },
      data: { banned: true, bannedAt: new Date() },
    });
    try {
      const lanternAdvanced = waitFor<{ hostId: string; holderId: string | null }>(
        owner,
        "lantern:update",
      );
      await notifyRealtimeAuthorizationChange({
        scope: "member",
        serverId,
        userId: userBId,
      });
      await expect(lanternAdvanced).resolves.toMatchObject({
        hostId: userAId,
        holderId: null,
      });

      const rooms = io.sockets.sockets.get(member.id!)?.rooms;
      expect(rooms?.has(`server:${serverId}`)).toBe(false);
      expect(rooms?.has(`channel:${channelC}`)).toBe(false);
      expect(rooms?.has(`voice:${channelV}`)).toBe(false);
    } finally {
      await prisma.serverMember.update({
        where: { serverId_userId: { serverId, userId: userBId } },
        data: { banned: false, bannedAt: null },
      });
    }
  });

  it("evicts a kicked member from every server-scoped room", async () => {
    const owner = await connect(tokenA);
    const member = await connect(tokenB);
    await joinServer(owner, serverId);
    await joinServer(member, serverId);
    await joinChannel(member, channelC);
    await joinVoice(member, channelV);

    await prisma.serverMember.delete({
      where: { serverId_userId: { serverId, userId: userBId } },
    });
    try {
      await notifyRealtimeAuthorizationChange({
        scope: "member",
        serverId,
        userId: userBId,
      });
      const rooms = io.sockets.sockets.get(member.id!)?.rooms;
      expect(rooms?.has(`server:${serverId}`)).toBe(false);
      expect(rooms?.has(`channel:${channelC}`)).toBe(false);
      expect(rooms?.has(`voice:${channelV}`)).toBe(false);
    } finally {
      await prisma.serverMember.create({
        data: { serverId, userId: userBId, role: "member" },
      });
    }
  });

  it("sweeps newly hidden rooms after a member role change", async () => {
    await prisma.serverMember.update({
      where: { serverId_userId: { serverId, userId: userBId } },
      data: { role: "mod" },
    });
    const member = await connect(tokenB);
    await joinServer(member, serverId);
    await joinChannel(member, channelHidden);
    await joinVoice(member, channelHiddenVoice);

    await prisma.serverMember.update({
      where: { serverId_userId: { serverId, userId: userBId } },
      data: { role: "member" },
    });
    try {
      await notifyRealtimeAuthorizationChange({
        scope: "server",
        serverId,
        userId: userBId,
      });
      const rooms = io.sockets.sockets.get(member.id!)?.rooms;
      expect(rooms?.has(`server:${serverId}`)).toBe(true);
      expect(rooms?.has(`channel:${channelHidden}`)).toBe(false);
      expect(rooms?.has(`voice:${channelHiddenVoice}`)).toBe(false);
    } finally {
      await prisma.serverMember.update({
        where: { serverId_userId: { serverId, userId: userBId } },
        data: { role: "member" },
      });
    }
  });

  it("evicts only the affected channel after a visibility override changes", async () => {
    const member = await connect(tokenB);
    await joinServer(member, serverId);
    await joinChannel(member, channelV);
    await joinVoice(member, channelV);

    await prisma.channelPermission.create({
      data: {
        channelId: channelV,
        role: "member",
        canView: false,
        canSend: false,
      },
    });
    try {
      await notifyRealtimeAuthorizationChange({
        scope: "channel",
        channelId: channelV,
      });
      const rooms = io.sockets.sockets.get(member.id!)?.rooms;
      expect(rooms?.has(`server:${serverId}`)).toBe(true);
      expect(rooms?.has(`channel:${channelV}`)).toBe(false);
      expect(rooms?.has(`voice:${channelV}`)).toBe(false);
    } finally {
      await prisma.channelPermission.delete({
        where: {
          channelId_role: { channelId: channelV, role: "member" },
        },
      });
    }
  });
});

describe("Pass the Lantern", () => {
  it("synchronizes holder/queue state and advances safely when the holder leaves", async () => {
    const a = await connect(tokenA);
    const b = await connect(tokenB);
    const x = await connect(tokenX);
    await joinVoice(a, channelV);
    await joinVoice(b, channelV);

    const startedForA = waitFor<{
      active: boolean;
      holderId: string | null;
      queue: { userId: string }[];
    }>(a, "lantern:update");
    const startedForB = waitFor<{ holderId: string | null }>(b, "lantern:update");
    a.emit("lantern:start", channelV);
    await expect(startedForA).resolves.toMatchObject({ active: true, holderId: userAId, queue: [] });
    await expect(startedForB).resolves.toMatchObject({ holderId: userAId });

    const queued = waitFor<{ holderId: string | null; queue: { userId: string }[] }>(a, "lantern:update");
    b.emit("lantern:request", channelV);
    await expect(queued).resolves.toMatchObject({
      holderId: userAId,
      queue: [{ userId: userBId }],
    });

    const passed = waitFor<{ holderId: string | null; queue: { userId: string }[] }>(a, "lantern:update");
    a.emit("lantern:pass", { channelId: channelV, targetUserId: userBId });
    await expect(passed).resolves.toMatchObject({ holderId: userBId, queue: [] });

    const noCrossRoomUpdate = expectNoEvent(a, "lantern:update", 300);
    x.emit("lantern:request", channelV);
    await expect(noCrossRoomUpdate).resolves.toBeUndefined();

    const advanced = waitFor<{ active: boolean; holderId: string | null }>(a, "lantern:update");
    b.emit("voice:leave", channelV);
    await expect(advanced).resolves.toMatchObject({ active: true, holderId: null });

    const stopped = waitFor<{ active: boolean }>(a, "lantern:update");
    a.emit("lantern:stop", channelV);
    await expect(stopped).resolves.toMatchObject({ active: false });
  });

  it("advances when a moderator removes the current holder", async () => {
    const a = await connect(tokenA);
    const b = await connect(tokenB);
    await joinVoice(a, channelV);
    await joinVoice(b, channelV);

    const started = waitFor<{ holderId: string | null }>(a, "lantern:update");
    a.emit("lantern:start", channelV);
    await expect(started).resolves.toMatchObject({ holderId: userAId });

    const queued = waitFor<{ queue: { userId: string }[] }>(a, "lantern:update");
    b.emit("lantern:request", channelV);
    await expect(queued).resolves.toMatchObject({ queue: [{ userId: userBId }] });

    const passed = waitFor<{ holderId: string | null }>(a, "lantern:update");
    a.emit("lantern:pass", { channelId: channelV, targetUserId: userBId });
    await expect(passed).resolves.toMatchObject({ holderId: userBId });

    const advanced = waitFor<{ active: boolean; holderId: string | null }>(a, "lantern:update");
    a.emit("mod:kick-voice", { channelId: channelV, targetUserId: userBId });
    await expect(advanced).resolves.toMatchObject({ active: true, holderId: null });

    const stopped = waitFor<{ active: boolean }>(a, "lantern:update");
    a.emit("lantern:stop", channelV);
    await expect(stopped).resolves.toMatchObject({ active: false });
  });
});
describe("voice signaling gates", () => {

  it("drops a voice:offer from a socket that is not in the voice room", async () => {
    const a = await connect(tokenA);
    const b = await connect(tokenB);
    const x = await connect(tokenX);
    await joinVoice(a, channelV);
    await joinVoice(b, channelV);
    // X never joins voice V (and could not — not a member).

    const noOffer = expectNoEvent(b, "voice:offer", 300);
    x.emit("voice:offer", { to: b.id, channelId: channelV, offer: { type: "offer", sdp: "x" } });
    await expect(noOffer).resolves.toBeUndefined();
  });
});
