"use client";

import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;

function getSocketUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_SOCKET_URL;

  if (typeof window !== "undefined") {
    const isLan = window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1";

    // On LAN, ignore localhost env URLs — use page origin (single-port mode)
    if (isLan) return window.location.origin;

    // On localhost, use env URL if set (two-port dev mode)
    if (envUrl) return envUrl;

    return window.location.origin;
  }

  return envUrl || "http://localhost:3000";
}

export function getSocket(): Socket {
  if (!socket) {
    const url = getSocketUrl();
    const path = process.env.NEXT_PUBLIC_SOCKET_PATH || "/api/socketio";
    const created = io(url, {
      path,
      autoConnect: false,
      withCredentials: true,
      // Never give up: a laptop waking from sleep or a long outage should
      // come back on its own. Backoff is capped at 10s between attempts.
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });
    // The Manager only auto-reconnects after transport loss. A server-initiated
    // disconnect needs an explicit connect(); if the session really was revoked
    // the handshake is refused ("connect_error": Unauthorized) and it stops there.
    created.on("disconnect", (reason) => {
      if (reason === "io server disconnect") created.connect();
    });
    socket = created;
  }
  return socket;
}

export function connectSocket(): Socket {
  const s = getSocket();
  if (!s.connected) s.connect();
  return s;
}

export function disconnectSocket(): void {
  if (socket) { socket.disconnect(); socket = null; }
}

export function setPresenceStatus(status: "online" | "idle" | "dnd" | "invisible"): void {
  const s = getSocket();
  if (s.connected) s.emit("presence:status", status);
}
