import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { io as ioc, type Socket as ClientSocket } from "socket.io-client";
import type { Server as IOServer } from "socket.io";
import { prisma } from "@/lib/db";
import { createToken } from "@/lib/auth";
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
let port: number;
let serverId: string;
let channelC: string;
let channelV: string;
let tokenA: string;
let tokenB: string;
let tokenX: string;

// Every client opened by connect() is tracked and torn down after each test so
// server-side presence/voice state (keyed by userId) doesn't leak between tests.
const openSockets: ClientSocket[] = [];

function connect(token?: string): Promise<ClientSocket> {
  const socket = ioc(`http://localhost:${port}`, {
    path: SOCKET_PATH,
    transports: ["websocket"],
    reconnection: false,
    forceNew: true,
    extraHeaders: token ? { cookie: `squatch-token=${token}` } : {},
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

  const server = await prisma.server.create({ data: { name: "S", ownerId: userA.id } });
  serverId = server.id;
  await prisma.serverMember.create({ data: { serverId, userId: userA.id, role: "owner" } });
  await prisma.serverMember.create({ data: { serverId, userId: userB.id, role: "member" } });
  // X is intentionally NOT a member of S.

  const c = await prisma.channel.create({ data: { serverId, name: "general", type: "text" } });
  const v = await prisma.channel.create({ data: { serverId, name: "Voice", type: "voice" } });
  channelC = c.id;
  channelV = v.id;

  tokenA = createToken({ userId: userA.id, username: userA.username });
  tokenB = createToken({ userId: userB.id, username: userB.username });
  tokenX = createToken({ userId: userX.id, username: userX.username });

  httpServer = createServer();
  io = attachSocketIO(httpServer);
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

  it("relays message:send from a member and stamps the real author, but drops a non-member's", async () => {
    const a = await connect(tokenA);
    const b = await connect(tokenB);
    const x = await connect(tokenX);
    await joinChannel(a, channelC);
    await joinChannel(b, channelC);

    const channelEvent = `message:channel:${channelC}`;

    // Non-member X: no broadcast.
    const noMsg = expectNoEvent(b, channelEvent, 300);
    x.emit("message:send", {
      channelId: channelC,
      message: { id: "m1", content: "sneaky", createdAt: new Date().toISOString(), author: { id: "spoof", username: "spoof" } },
    });
    await expect(noMsg).resolves.toBeUndefined();

    // Member A: broadcast, with the author identity stamped from the session.
    const incoming = waitFor<{ content: string; author: { id: string; username: string } }>(b, channelEvent);
    a.emit("message:send", {
      channelId: channelC,
      message: { id: "m2", content: "hello", createdAt: new Date().toISOString(), author: { id: "spoof", username: "spoof" } },
    });
    const msg = await incoming;
    expect(msg.content).toBe("hello");
    expect(msg.author.username).toBe("authz_a");
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
