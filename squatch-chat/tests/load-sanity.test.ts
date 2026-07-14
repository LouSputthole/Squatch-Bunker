import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { io as ioc, type Socket as ClientSocket } from "socket.io-client";
import type { Server as IOServer } from "socket.io";
import { prisma } from "@/lib/db";
import { createToken } from "@/lib/auth";
import { attachSocketIO } from "@/realtime/server";

// Load sanity (HOSTED.md launch checklist): N concurrent socket clients on
// one box — connect, authorize, join one channel, and fan a message burst
// out to everyone. This is a sanity gate with generous budgets, not a
// benchmark. Gated behind LOAD_TEST=1 so the normal suite and CI stay fast:
//   bash:        LOAD_TEST=1 npx vitest run tests/load-sanity.test.ts
//   powershell:  $env:LOAD_TEST="1"; npx vitest run tests/load-sanity.test.ts

const CLIENTS = Number(process.env.LOAD_CLIENTS || 200);
const BATCH = 25;
const SENDERS = 20;
const SOCKET_PATH = "/api/socketio";

let httpServer: HttpServer;
let io: IOServer;
let port: number;
let channelId: string;
const sockets: ClientSocket[] = [];

function connect(token: string): Promise<ClientSocket> {
  const socket = ioc(`http://localhost:${port}`, {
    path: SOCKET_PATH,
    transports: ["websocket"],
    reconnection: false,
    forceNew: true,
    extraHeaders: { cookie: `squatch-token=${token}` },
  });
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", (err) => reject(err));
  });
}

describe.runIf(process.env.LOAD_TEST === "1")("load sanity", () => {
  beforeAll(async () => {
    httpServer = createServer();
    io = attachSocketIO(httpServer);
    await new Promise<void>((r) => httpServer.listen(0, "127.0.0.1", r));
    port = (httpServer.address() as AddressInfo).port;

    const owner = await prisma.user.create({
      data: { email: "load-owner@t.local", username: "load_owner", passwordHash: "x" },
    });
    const server = await prisma.server.create({ data: { name: "load", ownerId: owner.id } });
    const channel = await prisma.channel.create({ data: { serverId: server.id, name: "general" } });
    channelId = channel.id;

    await prisma.user.createMany({
      data: Array.from({ length: CLIENTS }, (_, i) => ({
        id: `load-user-${i}`,
        email: `load-${i}@t.local`,
        username: `load_${i}`,
        passwordHash: "x",
      })),
    });
    await prisma.serverMember.createMany({
      data: Array.from({ length: CLIENTS }, (_, i) => ({
        serverId: server.id,
        userId: `load-user-${i}`,
      })),
    });
  }, 60_000);

  afterAll(async () => {
    sockets.forEach((s) => s.disconnect());
    await new Promise<void>((r) => io.close(() => r()));
    await new Promise<void>((r) => httpServer.close(() => r()));
    await prisma.serverMember.deleteMany({ where: { userId: { startsWith: "load-user-" } } });
    await prisma.message.deleteMany({ where: { channelId } });
    await prisma.channel.deleteMany({ where: { name: "general", server: { name: "load" } } });
    await prisma.server.deleteMany({ where: { name: "load" } });
    await prisma.user.deleteMany({ where: { username: { startsWith: "load_" } } });
  }, 60_000);

  it(`connects ${CLIENTS} clients, joins one channel, and fans out a ${SENDERS}-message burst`, async () => {
    // Phase 1: connect in batches so we measure the server, not a SYN storm.
    const t0 = Date.now();
    for (let i = 0; i < CLIENTS; i += BATCH) {
      await Promise.all(
        Array.from({ length: Math.min(BATCH, CLIENTS - i) }, (_, j) => {
          const idx = i + j;
          return connect(createToken({ userId: `load-user-${idx}`, username: `load_${idx}` }));
        }),
      );
    }
    const connectMs = Date.now() - t0;
    expect(sockets).toHaveLength(CLIENTS);
    expect(sockets.every((s) => s.connected)).toBe(true);

    // Phase 2: everyone joins the channel room (server-side membership check
    // per join — this is the DB-heavy part).
    let received = 0;
    const event = `message:channel:${channelId}`;
    for (const s of sockets) {
      s.on(event, () => received++);
      s.emit("channel:join", channelId);
    }
    // channel:join has no ack; give the join+membership lookups a moment.
    await new Promise((r) => setTimeout(r, 2000));

    // Probe: one message must reach every OTHER client (broadcast excludes
    // the sender) — proves all room joins actually landed.
    const t1 = Date.now();
    const probeMessage = await prisma.message.create({
      data: {
        channelId,
        authorId: "load-user-0",
        content: "probe",
      },
    });

    sockets[0].emit("message:send", {
      channelId,
      message: { id: probeMessage.id },
    });
    await waitUntil(() => received >= CLIENTS - 1, 10_000);
    const probeMs = Date.now() - t1;
    expect(received).toBe(CLIENTS - 1);

    // Phase 3: burst — SENDERS distinct clients send one message each.
    received = 0;
    const burstPrefix = Date.now();
    const burstMessages = Array.from({ length: SENDERS }, (_, index) => ({
      id: `load-burst-${burstPrefix}-${index}`,
      channelId,
      authorId: `load-user-${index + 1}`,
      content: "burst",
    }));
    await prisma.message.createMany({
      data: burstMessages,
    });

    const expected = SENDERS * (CLIENTS - 1);
    const t2 = Date.now();
    for (let i = 1; i <= SENDERS; i++) {
      sockets[i].emit("message:send", {
        channelId,
        message: { id: burstMessages[i - 1].id },
      });
    }
    await waitUntil(() => received >= expected, 20_000);
    const burstMs = Date.now() - t2;
    expect(received).toBe(expected);

    console.log(
      `[load-sanity] clients=${CLIENTS} connect=${connectMs}ms probe-fanout=${probeMs}ms ` +
        `burst=${SENDERS}x${CLIENTS - 1}=${expected} deliveries in ${burstMs}ms`,
    );

    // Generous sanity budgets — failures mean something is structurally wrong,
    // not that the box was busy.
    expect(connectMs).toBeLessThan(30_000);
    expect(probeMs).toBeLessThan(10_000);
    expect(burstMs).toBeLessThan(20_000);
  }, 120_000);
});

function waitUntil(cond: () => boolean, timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (cond()) return resolve();
      if (Date.now() - start > timeout) return reject(new Error("waitUntil timed out"));
      setTimeout(tick, 50);
    };
    tick();
  });
}
