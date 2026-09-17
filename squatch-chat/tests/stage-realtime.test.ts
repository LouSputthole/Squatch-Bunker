import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { io as ioc, type Socket as ClientSocket } from "socket.io-client";
import type { Server as IOServer } from "socket.io";
import { prisma } from "@/lib/db";
import { createToken } from "@/lib/auth";
import { attachSocketIO } from "@/realtime/server";

const SOCKET_PATH = "/api/socketio";

interface StageState {
  channelId: string;
  active: boolean;
  hostId: string | null;
  speakers: { userId: string; username: string }[];
  queue: { userId: string; username: string }[];
  limits: { maxSpeakers: number };
}

interface StageError {
  channelId: string;
  code: string;
  message: string;
}

let httpServer: HttpServer;
let io: IOServer;
let port: number;
let stageChannelId: string;
let hangoutChannelId: string;
const userIds: string[] = [];
const tokens: string[] = [];
let modToken: string;
let modUserId: string;
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

function waitForStage(
  socket: ClientSocket,
  predicate: (state: StageState) => boolean,
  timeout = 2_000,
): Promise<StageState> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("stage:update", onUpdate);
      reject(new Error("timed out waiting for matching stage:update"));
    }, timeout);
    function onUpdate(state: StageState) {
      if (!predicate(state)) return;
      clearTimeout(timer);
      socket.off("stage:update", onUpdate);
      resolve(state);
    }
    socket.on("stage:update", onUpdate);
  });
}

async function joinVoice(socket: ClientSocket, voiceChannelId: string) {
  const participants = waitFor(socket, "voice:participants");
  socket.emit("voice:join", voiceChannelId);
  await participants;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeAll(async () => {
  // Nine members fill the eight-speaker stage plus one camper past capacity.
  const users = await Promise.all(
    Array.from({ length: 9 }, (_, index) =>
      prisma.user.create({
        data: {
          email: `stage-${index}@t.local`,
          username: `stage_user_${index}`,
          passwordHash: "x",
        },
      })),
  );
  const mod = await prisma.user.create({
    data: { email: "stage-mod@t.local", username: "stage_mod", passwordHash: "x" },
  });
  userIds.push(...users.map((user) => user.id));
  tokens.push(...users.map((user) => createToken({ userId: user.id, username: user.username })));
  modUserId = mod.id;
  modToken = createToken({ userId: mod.id, username: mod.username });

  const server = await prisma.server.create({
    data: { name: "Stage test", ownerId: users[0].id },
  });
  await prisma.serverMember.createMany({
    data: [
      ...users.map((user, index) => ({
        serverId: server.id,
        userId: user.id,
        role: index === 0 ? "owner" : "member",
      })),
      { serverId: server.id, userId: mod.id, role: "mod" },
    ],
  });

  const [stageChannel, hangoutChannel] = await Promise.all([
    prisma.channel.create({
      data: {
        serverId: server.id,
        name: "Fireside",
        type: "voice",
        roomMode: "fireside-stage",
        roomScene: "night",
      },
    }),
    prisma.channel.create({
      data: { serverId: server.id, name: "Hangout", type: "voice" },
    }),
  ]);
  stageChannelId = stageChannel.id;
  hangoutChannelId = hangoutChannel.id;

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

describe("Fireside Stage realtime state", () => {
  it("makes the first arrival host and later arrivals audience", async () => {
    const host = await connect(tokens[0]);
    const hostState = waitFor<StageState>(host, "stage:update");
    await joinVoice(host, stageChannelId);
    const initial = await hostState;
    expect(initial.active).toBe(true);
    expect(initial.hostId).toBe(userIds[0]);
    expect(initial.speakers.map((s) => s.userId)).toEqual([userIds[0]]);
    expect(initial.limits.maxSpeakers).toBe(8);

    const listener = await connect(tokens[1]);
    const listenerState = waitFor<StageState>(listener, "stage:update");
    await joinVoice(listener, stageChannelId);
    const synced = await listenerState;
    expect(synced.hostId).toBe(userIds[0]);
    expect(synced.speakers.map((s) => s.userId)).toEqual([userIds[0]]);
    expect(synced.queue).toEqual([]);
  });

  it("queues raised hands, promotes through the host, and supports withdraw and step down", async () => {
    const host = await connect(tokens[0]);
    const camper = await connect(tokens[1]);
    const other = await connect(tokens[2]);
    await joinVoice(host, stageChannelId);
    await joinVoice(camper, stageChannelId);
    await joinVoice(other, stageChannelId);

    const queued = waitForStage(host, (s) => s.queue.length === 1);
    camper.emit("stage:request", stageChannelId);
    expect((await queued).queue[0].userId).toBe(userIds[1]);

    // Withdraw empties the queue again.
    const withdrawn = waitForStage(host, (s) => s.queue.length === 0);
    camper.emit("stage:withdraw", stageChannelId);
    await withdrawn;

    // A non-controller cannot promote.
    const forbidden = waitFor<StageError>(other, "stage:error");
    other.emit("stage:promote", { channelId: stageChannelId, targetUserId: userIds[2] });
    expect((await forbidden).code).toBe("stage_forbidden");

    // The host promotes; the camper becomes a speaker everywhere.
    const promoted = waitForStage(camper, (s) => s.speakers.length === 2);
    host.emit("stage:promote", { channelId: stageChannelId, targetUserId: userIds[1] });
    expect((await promoted).speakers.map((s) => s.userId)).toContain(userIds[1]);

    // The speaker steps down voluntarily.
    const steppedDown = waitForStage(host, (s) => s.speakers.length === 1);
    camper.emit("stage:demote", { channelId: stageChannelId, targetUserId: userIds[1] });
    await steppedDown;

    // A non-controller cannot demote someone else.
    const demoteForbidden = waitFor<StageError>(other, "stage:error");
    other.emit("stage:demote", { channelId: stageChannelId, targetUserId: userIds[0] });
    expect((await demoteForbidden).code).toBe("stage_forbidden");
  });

  it("lets a moderator promote and demote without being host", async () => {
    const host = await connect(tokens[0]);
    const camper = await connect(tokens[1]);
    const mod = await connect(modToken);
    await joinVoice(host, stageChannelId);
    await joinVoice(camper, stageChannelId);
    await joinVoice(mod, stageChannelId);

    const promoted = waitForStage(host, (s) => s.speakers.length === 2);
    mod.emit("stage:promote", { channelId: stageChannelId, targetUserId: userIds[1] });
    expect((await promoted).speakers.map((s) => s.userId)).toContain(userIds[1]);

    const demoted = waitForStage(host, (s) => s.speakers.length === 1);
    mod.emit("stage:demote", { channelId: stageChannelId, targetUserId: userIds[1] });
    await demoted;
    expect(modUserId).toBeTruthy();
  });

  it("enforces the eight-speaker capacity", async () => {
    const sockets: ClientSocket[] = [];
    for (let index = 0; index < 9; index += 1) {
      const socket = await connect(tokens[index]);
      await joinVoice(socket, stageChannelId);
      sockets.push(socket);
    }
    const host = sockets[0];

    for (let index = 1; index < 8; index += 1) {
      const grew = waitForStage(host, (s) => s.speakers.length === index + 1);
      host.emit("stage:promote", { channelId: stageChannelId, targetUserId: userIds[index] });
      await grew;
    }

    const capacity = waitFor<StageError>(host, "stage:error");
    host.emit("stage:promote", { channelId: stageChannelId, targetUserId: userIds[8] });
    expect((await capacity).code).toBe("speaker_capacity");
  });

  it("transfers the host role when the host disconnects", async () => {
    const host = await connect(tokens[0]);
    const speaker = await connect(tokens[1]);
    const listener = await connect(tokens[2]);
    await joinVoice(host, stageChannelId);
    await joinVoice(speaker, stageChannelId);
    await joinVoice(listener, stageChannelId);

    const promoted = waitForStage(listener, (s) => s.speakers.length === 2);
    host.emit("stage:promote", { channelId: stageChannelId, targetUserId: userIds[1] });
    await promoted;

    const transferred = waitForStage(
      listener,
      (s) => s.hostId === userIds[1] && s.speakers.length === 1,
    );
    host.disconnect();
    const after = await transferred;
    expect(after.active).toBe(true);
    expect(after.speakers.map((s) => s.userId)).toEqual([userIds[1]]);
  });

  it("keeps non-stage rooms inert and rejects requests from outside the room", async () => {
    const camperInHangout = await connect(tokens[0]);
    const hangoutUpdates: StageState[] = [];
    camperInHangout.on("stage:update", (state: StageState) => hangoutUpdates.push(state));
    await joinVoice(camperInHangout, hangoutChannelId);
    await delay(150);
    expect(hangoutUpdates).toEqual([]);

    const inactive = waitFor<StageError>(camperInHangout, "stage:error");
    camperInHangout.emit("stage:request", hangoutChannelId);
    expect((await inactive).code).toBe("stage_inactive");

    // A user who never joined the stage channel's voice room is ignored.
    const outsider = await connect(tokens[1]);
    const outsiderUpdates: StageState[] = [];
    outsider.on("stage:update", (state: StageState) => outsiderUpdates.push(state));
    outsider.emit("stage:request", stageChannelId);
    await delay(150);
    expect(outsiderUpdates).toEqual([]);
  });
});
