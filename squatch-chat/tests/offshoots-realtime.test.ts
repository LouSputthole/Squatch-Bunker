import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { io as ioc, type Socket as ClientSocket } from "socket.io-client";
import type { Server as IOServer } from "socket.io";
import { prisma } from "@/lib/db";
import { createToken } from "@/lib/auth";
import { attachSocketIO } from "@/realtime/server";

const SOCKET_PATH = "/api/socketio";

interface OffshootState {
  channelId: string;
  offshoots: {
    id: string;
    name: string;
    creatorId: string;
    members: { userId: string; username: string }[];
  }[];
  limits: { maxOffshoots: number; maxMembers: number };
}

let httpServer: HttpServer;
let io: IOServer;
let port: number;
let channelId: string;
let secondChannelId: string;
let userAId: string;
let userBId: string;
let tokenA: string;
let tokenB: string;
let tokenC: string;
let tokenD: string;
let tokenE: string;
const openSockets: ClientSocket[] = [];

function connect(token: string): Promise<ClientSocket> {
  const socket = ioc(`http://localhost:${port}`, {
    path: SOCKET_PATH,
    transports: ["websocket"],
    reconnection: false,
    forceNew: true,
    extraHeaders: { cookie: `squatch-token=${token}` },
  });
  openSockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", reject);
  });
}

function waitFor<T>(socket: ClientSocket, event: string, timeout = 2_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for "${event}"`)), timeout);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function joinVoice(socket: ClientSocket, voiceChannelId: string) {
  const participants = waitFor(socket, "voice:participants");
  socket.emit("voice:join", voiceChannelId);
  await participants;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeAll(async () => {
  const [userA, userB, userC, userD, userE] = await Promise.all([
    prisma.user.create({ data: { email: "offshoot-a@t.local", username: "offshoot_a", passwordHash: "x" } }),
    prisma.user.create({ data: { email: "offshoot-b@t.local", username: "offshoot_b", passwordHash: "x" } }),
    prisma.user.create({ data: { email: "offshoot-c@t.local", username: "offshoot_c", passwordHash: "x" } }),
    prisma.user.create({ data: { email: "offshoot-d@t.local", username: "offshoot_d", passwordHash: "x" } }),
    prisma.user.create({ data: { email: "offshoot-e@t.local", username: "offshoot_e", passwordHash: "x" } }),
  ]);
  userAId = userA.id;
  userBId = userB.id;

  const server = await prisma.server.create({ data: { name: "Offshoot test", ownerId: userA.id } });
  await prisma.serverMember.createMany({
    data: [
      { serverId: server.id, userId: userA.id, role: "owner" },
      { serverId: server.id, userId: userB.id, role: "member" },
      { serverId: server.id, userId: userC.id, role: "member" },
      { serverId: server.id, userId: userD.id, role: "mod" },
      { serverId: server.id, userId: userE.id, role: "member" },
    ],
  });
  const [channel, secondChannel] = await Promise.all([
    prisma.channel.create({ data: { serverId: server.id, name: "Camp", type: "voice" } }),
    prisma.channel.create({ data: { serverId: server.id, name: "Other camp", type: "voice" } }),
  ]);
  channelId = channel.id;

  secondChannelId = secondChannel.id;
  tokenA = createToken({ userId: userA.id, username: userA.username });
  tokenB = createToken({ userId: userB.id, username: userB.username });
  tokenC = createToken({ userId: userC.id, username: userC.username });

  tokenD = createToken({ userId: userD.id, username: userD.username });
  tokenE = createToken({ userId: userE.id, username: userE.username });
  httpServer = createServer();
  io = attachSocketIO(httpServer);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  port = (httpServer.address() as AddressInfo).port;
});

afterEach(async () => {
  for (const socket of openSockets) socket.disconnect();
  openSockets.length = 0;
  await delay(60);
});

afterAll(async () => {
  io.close();
  httpServer.close();
  await prisma.$disconnect();
});

describe("Offshoot realtime state", () => {
  it("synchronizes create, join, and current state to late voice-room joins", async () => {
    const a = await connect(tokenA);
    const b = await connect(tokenB);
    await joinVoice(a, channelId);
    await joinVoice(b, channelId);

    const createdForA = waitFor<OffshootState>(a, "offshoot:update");
    const createdForB = waitFor<OffshootState>(b, "offshoot:update");
    a.emit("offshoot:create", { channelId, name: "Trail planning" });
    const [aState, bState] = await Promise.all([createdForA, createdForB]);

    expect(aState).toEqual(bState);
    expect(aState.limits).toEqual({ maxOffshoots: 3, maxMembers: 4 });
    expect(aState.offshoots).toHaveLength(1);
    expect(aState.offshoots[0]).toMatchObject({
      name: "Trail planning",
      creatorId: userAId,
      members: [{ userId: userAId, username: "offshoot_a" }],
    });

    const offshootId = aState.offshoots[0].id;
    const joinedForA = waitFor<OffshootState>(a, "offshoot:update");
    b.emit("offshoot:join", { channelId, offshootId });
    const joinedState = await joinedForA;
    expect(joinedState.offshoots[0].members.map((member) => member.userId)).toEqual([userAId, userBId]);

    const c = await connect(tokenC);
    const lateState = waitFor<OffshootState>(c, "offshoot:update");
    await joinVoice(c, channelId);
    await expect(lateState).resolves.toEqual(joinedState);
  });
  it("closes the side fire when its creator disconnects", async () => {
    const a = await connect(tokenA);
    const b = await connect(tokenB);
    await joinVoice(a, channelId);
    await joinVoice(b, channelId);

    const created = waitFor<OffshootState>(b, "offshoot:update");
    a.emit("offshoot:create", { channelId, name: "Quick aside" });
    const offshootId = (await created).offshoots[0].id;

    const joined = waitFor<OffshootState>(b, "offshoot:update");
    b.emit("offshoot:join", { channelId, offshootId });
    await joined;

    const cleanedUp = waitFor<OffshootState>(b, "offshoot:update");
    a.disconnect();
    await expect(cleanedUp).resolves.toMatchObject({ channelId, offshoots: [] });
  });
  it("rejects joining an offshoot from a different parent voice room", async () => {
    const a = await connect(tokenA);
    const c = await connect(tokenC);
    await joinVoice(a, channelId);
    await joinVoice(c, secondChannelId);

    const created = waitFor<OffshootState>(a, "offshoot:update");
    a.emit("offshoot:create", { channelId, name: "First camp aside" });
    const offshootId = (await created).offshoots[0].id;

    const rejected = waitFor<{ channelId: string; code: string }>(c, "offshoot:error");
    c.emit("offshoot:join", { channelId, offshootId });
    await expect(rejected).resolves.toMatchObject({
      channelId,
      code: "parent_membership_required",
    });

    const unchanged = waitFor<OffshootState>(a, "offshoot:update");
    a.emit("offshoot:state", channelId);
    await expect(unchanged).resolves.toMatchObject({
      offshoots: [{ members: [{ userId: userAId }] }],
    });
  });

  it("caps each offshoot at four members", async () => {
    const a = await connect(tokenA);
    const b = await connect(tokenB);
    const c = await connect(tokenC);
    const d = await connect(tokenD);
    const e = await connect(tokenE);
    for (const socket of [a, b, c, d, e]) await joinVoice(socket, channelId);

    const created = waitFor<OffshootState>(a, "offshoot:update");
    a.emit("offshoot:create", { channelId, name: "Small circle" });
    const offshootId = (await created).offshoots[0].id;

    for (const socket of [b, c, d]) {
      const joined = waitFor<OffshootState>(a, "offshoot:update");
      socket.emit("offshoot:join", { channelId, offshootId });
      await joined;
    }

    const rejected = waitFor<{ code: string }>(e, "offshoot:error");
    e.emit("offshoot:join", { channelId, offshootId });
    await expect(rejected).resolves.toMatchObject({ code: "offshoot_capacity" });

    const fullState = waitFor<OffshootState>(a, "offshoot:update");
    a.emit("offshoot:state", channelId);
    const state = await fullState;
    expect(state.offshoots[0].members).toHaveLength(4);
    expect(state.offshoots[0].members.map((member) => member.username)).not.toContain("offshoot_e");
  });
  it("limits each parent room to three concurrent offshoots", async () => {
    const a = await connect(tokenA);
    const b = await connect(tokenB);
    const c = await connect(tokenC);
    const d = await connect(tokenD);
    for (const socket of [a, b, c, d]) await joinVoice(socket, channelId);

    for (const [socket, name] of [[a, "North"], [b, "East"], [c, "West"]] as const) {
      const created = waitFor<OffshootState>(d, "offshoot:update");
      socket.emit("offshoot:create", { channelId, name });
      await created;
    }

    const rejected = waitFor<{ code: string }>(d, "offshoot:error");
    d.emit("offshoot:create", { channelId, name: "Overflow" });
    await expect(rejected).resolves.toMatchObject({ code: "offshoot_limit" });

    const current = waitFor<OffshootState>(d, "offshoot:update");
    d.emit("offshoot:state", channelId);
    await expect(current).resolves.toMatchObject({ offshoots: [{}, {}, {}] });
  });

  it("supports rejoining main and creator or moderator close controls", async () => {
    const a = await connect(tokenA);
    const b = await connect(tokenB);
    const d = await connect(tokenD);
    for (const socket of [a, b, d]) await joinVoice(socket, channelId);

    const created = waitFor<OffshootState>(b, "offshoot:update");
    a.emit("offshoot:create", { channelId, name: "Private trail" });
    const offshootId = (await created).offshoots[0].id;

    const joined = waitFor<OffshootState>(a, "offshoot:update");
    b.emit("offshoot:join", { channelId, offshootId });
    await joined;

    const backAtMain = waitFor<OffshootState>(a, "offshoot:update");
    b.emit("offshoot:leave", { channelId });
    await expect(backAtMain).resolves.toMatchObject({
      offshoots: [{ members: [{ userId: userAId }] }],
    });

    const forbidden = waitFor<{ code: string }>(b, "offshoot:error");
    b.emit("offshoot:close", { channelId, offshootId });
    await expect(forbidden).resolves.toMatchObject({ code: "offshoot_close_forbidden" });

    const modClosed = waitFor<OffshootState>(a, "offshoot:update");
    const modClosedForD = waitFor<OffshootState>(d, "offshoot:update");
    d.emit("offshoot:close", { channelId, offshootId });
    await expect(Promise.all([modClosed, modClosedForD])).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ offshoots: [] })]));

    const recreated = waitFor<OffshootState>(d, "offshoot:update");
    a.emit("offshoot:create", { channelId, name: "Creator close" });
    const creatorOffshootId = (await recreated).offshoots[0].id;
    const creatorClosed = waitFor<OffshootState>(d, "offshoot:update");
    a.emit("offshoot:close", { channelId, offshootId: creatorOffshootId });
    await expect(creatorClosed).resolves.toMatchObject({ offshoots: [] });
  });
});
