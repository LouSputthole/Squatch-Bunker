import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { io as ioc, type Socket as ClientSocket } from "socket.io-client";
import type { Server as IOServer } from "socket.io";
import { prisma } from "@/lib/db";
import { createToken } from "@/lib/auth";
import { notifyRealtimeAuthorizationChange } from "@/lib/realtimeControl";
import { attachSocketIO, checkSessionToken } from "@/realtime/server";

// Connection-reliability, presence, and voice-moderation behavior of the
// realtime server, driven with real socket.io clients against an in-process
// server. Server S has owner A and member B; B also owns server T.

const SOCKET_PATH = "/api/socketio";

interface PresenceUpdate {
  serverId: string;
  members: { userId: string; username: string; status: string }[];
}
interface RosterUpdate {
  channelId: string;
  participants: {
    userId: string;
    muted: boolean;
    serverMuted?: boolean;
    serverDeafened?: boolean;
  }[];
}

let httpServer: HttpServer;
let io: IOServer;
let port: number;
let serverS: string;
let serverT: string;
let voiceV: string;
let hiddenVoice: string;
let userAId: string;
let userBId: string;
let tokenA: string;
let tokenB: string;
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

function waitFor<T>(
  socket: ClientSocket,
  event: string,
  predicate: (payload: T) => boolean = () => true,
  timeout = 2_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timed out waiting for matching "${event}"`));
    }, timeout);
    function handler(payload: T) {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    }
    socket.on(event, handler);
  });
}

function expectNoEvent<T>(
  socket: ClientSocket,
  event: string,
  predicate: (payload: T) => boolean = () => true,
  wait = 300,
): Promise<void> {
  return new Promise((resolve, reject) => {
    function handler(payload: T) {
      if (predicate(payload)) reject(new Error(`received "${event}" but expected none`));
    }
    socket.on(event, handler);
    setTimeout(() => {
      socket.off(event, handler);
      resolve();
    }, wait);
  });
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const hasMember = (userId: string, status?: string) => (update: PresenceUpdate) =>
  update.members.some((m) => m.userId === userId && (!status || m.status === status));

async function joinServer(socket: ClientSocket, serverId: string) {
  const confirmed = waitFor<PresenceUpdate>(socket, "presence:update", (u) => u.serverId === serverId);
  socket.emit("server:join", serverId);
  return confirmed;
}

async function joinVoice(socket: ClientSocket, channelId: string) {
  const confirmed = waitFor(socket, "voice:participants");
  socket.emit("voice:join", channelId);
  await confirmed;
}

beforeAll(async () => {
  const [userA, userB] = await Promise.all([
    prisma.user.create({ data: { email: "rel-a@t.local", username: "rel_a", passwordHash: "x" } }),
    prisma.user.create({ data: { email: "rel-b@t.local", username: "rel_b", passwordHash: "x" } }),
  ]);
  userAId = userA.id;
  userBId = userB.id;
  const [s, t] = await Promise.all([
    prisma.server.create({ data: { name: "Reliability S", ownerId: userA.id } }),
    prisma.server.create({ data: { name: "Reliability T", ownerId: userB.id } }),
  ]);
  serverS = s.id;
  serverT = t.id;
  await prisma.serverMember.createMany({
    data: [
      { serverId: serverS, userId: userAId, role: "owner" },
      { serverId: serverS, userId: userBId, role: "member" },
      { serverId: serverT, userId: userBId, role: "owner" },
    ],
  });
  const [v, hv] = await Promise.all([
    prisma.channel.create({ data: { serverId: serverS, name: "Voice", type: "voice" } }),
    prisma.channel.create({ data: { serverId: serverS, name: "Hidden voice", type: "voice" } }),
  ]);
  voiceV = v.id;
  hiddenVoice = hv.id;
  await prisma.channelPermission.create({
    data: { channelId: hiddenVoice, role: "member", canView: false, canSend: false },
  });
  tokenA = createToken({ userId: userAId, username: userA.username });
  tokenB = createToken({ userId: userBId, username: userB.username });

  httpServer = createServer();
  io = attachSocketIO(httpServer);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  port = (httpServer.address() as AddressInfo).port;
});

afterEach(async () => {
  for (const socket of openSockets) socket.disconnect();
  openSockets.length = 0;
  await delay(80);
});

afterAll(async () => {
  io.close();
  httpServer.close();
  await prisma.$disconnect();
});

describe("session revalidation", () => {
  it("only reports invalid for a definite answer, not a database failure", async () => {
    expect(await checkSessionToken(tokenA)).toBe("valid");
    expect(await checkSessionToken("not.a.jwt")).toBe("invalid");

    const spy = vi.spyOn(prisma.user, "findUnique").mockRejectedValueOnce(new Error("db down"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await checkSessionToken(tokenA)).toBe("unavailable");
    } finally {
      spy.mockRestore();
      errors.mockRestore();
    }

    await prisma.user.update({ where: { id: userAId }, data: { tokenVersion: { increment: 1 } } });
    try {
      expect(await checkSessionToken(tokenA)).toBe("invalid");
    } finally {
      await prisma.user.update({ where: { id: userAId }, data: { tokenVersion: 0 } });
    }
  });
});

describe("per-user presence", () => {
  it("lists a member online in every server while any of their sockets is connected", async () => {
    const a = await connect(tokenA);
    await joinServer(a, serverS);

    // B never opens S, but is a member: A must see B online.
    const sawB = waitFor<PresenceUpdate>(a, "presence:update", hasMember(userBId));
    const b = await connect(tokenB);
    await joinServer(b, serverT);
    await sawB;

    // A second B tab opening and then leaving S must not take B offline in S.
    const secondB = await connect(tokenB);
    await joinServer(secondB, serverS);
    const noDrop = expectNoEvent<PresenceUpdate>(
      a,
      "presence:update",
      (u) => u.serverId === serverS && !hasMember(userBId)(u),
    );
    secondB.emit("server:leave", serverS);
    secondB.disconnect();
    await noDrop;

    // B's last socket going away is what takes B offline.
    const dropped = waitFor<PresenceUpdate>(
      a,
      "presence:update",
      (u) => u.serverId === serverS && !hasMember(userBId)(u),
    );
    b.disconnect();
    await dropped;
  });

  it("keeps a chosen status when the same user opens another tab", async () => {
    const a = await connect(tokenA);
    await joinServer(a, serverS);
    const firstB = await connect(tokenB);
    const dnd = waitFor<PresenceUpdate>(a, "presence:update", hasMember(userBId, "dnd"));
    firstB.emit("presence:status", "dnd");
    await dnd;

    const secondB = await connect(tokenB);
    const seen = await joinServer(secondB, serverS);
    expect(hasMember(userBId, "dnd")(seen)).toBe(true);
  });
});

describe("voice rosters on server open", () => {
  it("sends current rosters for visible voice rooms when a server is opened", async () => {
    const b = await connect(tokenB);
    await joinVoice(b, voiceV);

    const a = await connect(tokenA);
    const roster = waitFor<RosterUpdate>(a, "voice:participants-update", (u) => u.channelId === voiceV);
    a.emit("server:join", serverS);
    expect((await roster).participants.map((p) => p.userId)).toEqual([userBId]);
  });

  it("never sends a hidden room's roster to a member who cannot view it", async () => {
    const a = await connect(tokenA);
    await joinVoice(a, hiddenVoice);

    const b = await connect(tokenB);
    const noHidden = expectNoEvent<RosterUpdate>(
      b,
      "voice:participants-update",
      (u) => u.channelId === hiddenVoice,
    );
    await joinServer(b, serverS);
    await noHidden;
  });
});

describe("server mute enforcement", () => {
  it("refuses a self-unmute and re-applies the server mute on rejoin", async () => {
    const mod = await connect(tokenA);
    const target = await connect(tokenB);
    await joinVoice(mod, voiceV);
    await joinVoice(target, voiceV);

    const forced = waitFor<{ muted: boolean }>(target, "mod:force-mute");
    mod.emit("mod:server-mute", { channelId: voiceV, targetUserId: userBId, muted: true });
    expect(await forced).toMatchObject({ muted: true });

    try {
      const reasserted = waitFor<{ muted: boolean }>(target, "mod:force-mute");
      target.emit("voice:mute", { channelId: voiceV, muted: false });
      expect(await reasserted).toMatchObject({ muted: true });

      target.emit("voice:leave", voiceV);
      await delay(50);
      const reapplied = waitFor<{ muted: boolean }>(target, "mod:force-mute");
      const roster = waitFor<RosterUpdate>(
        mod,
        "voice:participants-update",
        (u) => u.channelId === voiceV && u.participants.some((p) => p.userId === userBId),
      );
      await joinVoice(target, voiceV);
      expect(await reapplied).toMatchObject({ muted: true });
      expect((await roster).participants.find((p) => p.userId === userBId)).toMatchObject({
        muted: true,
        serverMuted: true,
      });
    } finally {
      mod.emit("mod:server-mute", { channelId: voiceV, targetUserId: userBId, muted: false });
      await delay(50);
    }
  });
});

describe("voice lifecycle signals", () => {
  it("relays speaking flips past the shared limiter with their own per-second budget", async () => {
    const a = await connect(tokenA);
    const b = await connect(tokenB);
    await joinVoice(a, voiceV);
    await joinVoice(b, voiceV);

    let relayed = 0;
    b.on("voice:speaking", () => { relayed += 1; });
    for (let burst = 0; burst < 4; burst += 1) {
      for (let flip = 0; flip < 12; flip += 1) {
        a.emit("voice:speaking", { channelId: voiceV, speaking: flip % 2 === 0 });
      }
      await delay(1_100);
    }
    // 10 per second survive each burst: 40 total, well past the old 30/min cap.
    expect(relayed).toBe(40);
  });

  it("tells peers to drop a departing user's screen share", async () => {
    const a = await connect(tokenA);
    const b = await connect(tokenB);
    await joinVoice(a, voiceV);
    await joinVoice(b, voiceV);

    const stopped = waitFor<{ userId: string }>(a, "screen:stopped");
    b.emit("voice:leave", voiceV);
    expect(await stopped).toEqual({ userId: userBId });
  });

  it("tells an evicted participant to leave the room", async () => {
    const b = await connect(tokenB);
    await joinVoice(b, voiceV);

    await prisma.channelPermission.create({
      data: { channelId: voiceV, role: "member", canView: false, canSend: false },
    });
    try {
      const evicted = waitFor<{ channelId: string; error: string }>(b, "voice:error");
      await notifyRealtimeAuthorizationChange({ scope: "channel", channelId: voiceV });
      expect(await evicted).toMatchObject({ channelId: voiceV });
    } finally {
      await prisma.channelPermission.delete({
        where: { channelId_role: { channelId: voiceV, role: "member" } },
      });
    }
  });
});
