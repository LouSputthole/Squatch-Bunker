"use client";

import { io, Socket } from "socket.io-client";
import { getRuntimeConfig } from "@/hooks/useRuntimeConfig";

let socket: Socket | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

function getSocketConfig() {
  const runtime = getRuntimeConfig();
  if (runtime?.socketUrl) {
    return { url: runtime.socketUrl, path: runtime.socketPath || "/api/socketio" };
  }

  // Fallback: derive from current page location (works for LAN/remote access)
  if (typeof window !== "undefined") {
    const hostname = window.location.hostname;
    const protocol = window.location.protocol === "https:" ? "https" : "http";
    const socketPort = process.env.NEXT_PUBLIC_SOCKET_PORT || "3001";
    return {
      url: `${protocol}://${hostname}:${socketPort}`,
      path: process.env.NEXT_PUBLIC_SOCKET_PATH || "/api/socketio",
    };
  }

  return {
    url: process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001",
    path: process.env.NEXT_PUBLIC_SOCKET_PATH || "/api/socketio",
  };
}

export function getSocket(): Socket {
  if (!socket) {
    const config = getSocketConfig();
    socket = io(config.url, {
      path: config.path,
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
  if (!s.connected) {
    s.connect();
  }
  // Start heartbeat
  if (!heartbeatInterval) {
    heartbeatInterval = setInterval(() => {
      if (s.connected) s.emit("heartbeat");
    }, 15000);
  }
  return s;
}

export function disconnectSocket(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function setPresenceStatus(status: "online" | "idle" | "dnd" | "invisible"): void {
  const s = getSocket();
  if (s.connected) s.emit("presence:status", status);
}
