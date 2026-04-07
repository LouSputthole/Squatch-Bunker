"use client";

import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

function getSocketUrl(): string {
  // If NEXT_PUBLIC_SOCKET_URL is explicitly set, use it (dev mode: separate port)
  const envUrl = process.env.NEXT_PUBLIC_SOCKET_URL;
  if (envUrl) return envUrl;

  // Single-port mode: Socket.IO runs on the same origin as the page
  if (typeof window !== "undefined") return window.location.origin;

  return "http://localhost:3000";
}

export function getSocket(): Socket {
  if (!socket) {
    const url = getSocketUrl();
    const path = process.env.NEXT_PUBLIC_SOCKET_PATH || "/api/socketio";
    socket = io(url, {
      path,
      autoConnect: false,
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });
  }
  return socket;
}

export function connectSocket(): Socket {
  const s = getSocket();
  if (!s.connected) s.connect();
  if (!heartbeatInterval) {
    heartbeatInterval = setInterval(() => {
      if (s.connected) s.emit("heartbeat");
    }, 15000);
  }
  return s;
}

export function disconnectSocket(): void {
  if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
  if (socket) { socket.disconnect(); socket = null; }
}

export function setPresenceStatus(status: "online" | "idle" | "dnd" | "invisible"): void {
  const s = getSocket();
  if (s.connected) s.emit("presence:status", status);
}
