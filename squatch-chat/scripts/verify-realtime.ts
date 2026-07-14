#!/usr/bin/env -S npx tsx

import { randomUUID } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import { createToken } from "../lib/auth";
import { createPrismaClient } from "../lib/db";

const applicationUrl = process.argv[2] ?? "http://127.0.0.1:3000";
const configuredOrigin = process.env.CORS_ORIGINS?.split(",")
  .map((origin) => origin.trim())
  .find(Boolean);
const allowedOrigin = new URL(
  process.argv[3] ??
    configuredOrigin ??
    process.env.NEXT_PUBLIC_APP_URL ??
    applicationUrl,
).origin;
const socketPath = process.env.SOCKET_PATH || process.env.NEXT_PUBLIC_SOCKET_PATH || "/api/socketio";
const cookieName = process.env.COOKIE_NAME || "squatch-token";
const marker = randomUUID().replaceAll("-", "");
const userId = `realtime-smoke-${marker}`;
const username = `realtime_smoke_${marker.slice(0, 20)}`;
const prisma = createPrismaClient();
const openSockets = new Set<Socket>();

function connect(token: string, origin: string): Promise<Socket> {
  const socket = io(applicationUrl, {
    path: socketPath,
    transports: ["websocket"],
    reconnection: false,
    forceNew: true,
    timeout: 5_000,
    extraHeaders: {
      cookie: `${cookieName}=${token}`,
      origin,
    },
  });
  openSockets.add(socket);

  return new Promise((resolve, reject) => {
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", reject);
  });
}

async function main() {
try {
  const user = await prisma.user.create({
    data: {
      id: userId,
      email: `${username}@example.invalid`,
      username,
      passwordHash: "realtime-smoke-not-a-real-password-hash",
    },
  });
  const token = createToken({
    userId: user.id,
    username: user.username,
    tokenVersion: user.tokenVersion,
  });

  const allowedSocket = await connect(token, allowedOrigin);
  if (!allowedSocket.connected) {
    throw new Error("[Campfire] Authenticated realtime connection did not open.");
  }
  allowedSocket.disconnect();

  let hostileConnected = false;
  try {
    const hostileSocket = await connect(token, "https://evil.example");
    hostileConnected = hostileSocket.connected;
    hostileSocket.disconnect();
  } catch {
    // Expected: Engine.IO must reject a browser Origin outside the policy.
  }
  if (hostileConnected) {
    throw new Error("[Campfire] Hostile realtime Origin was accepted.");
  }

  console.log(
    `[Campfire] Authenticated realtime smoke passed for ${applicationUrl}; hostile Origin rejected.`,
  );
} finally {
  for (const socket of openSockets) socket.disconnect();
  await prisma.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
  await prisma.$disconnect();
}
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
