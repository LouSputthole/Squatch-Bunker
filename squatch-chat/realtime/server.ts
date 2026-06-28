import { createServer, Server as HttpServer } from "http";
import { pathToFileURL } from "url";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { parse } from "cookie";
import { config } from "@/lib/config";
import { prisma } from "@/lib/db";
import { requireMembership, requireChannelMembership } from "@/lib/membership";
import { canManageMessages } from "@/lib/permissions";
import { checkRateLimit } from "@/lib/rateLimit";

const COOKIE_NAME = process.env.COOKIE_NAME || "squatch-token";
const SOCKET_PATH = process.env.SOCKET_PATH || "/api/socketio";

// CORS — never reflect arbitrary origins (that allows cross-site WebSocket
// hijacking when credentials are sent). Same-origin connections (the unified
// single-port server) are not subject to browser CORS at all, so they keep
// working regardless. Cross-origin connections must be explicitly allow-listed,
// plus — in self-hosted mode — private-LAN origins so "share the Network URL"
// and cross-port dev still work without exposing the box to public origins.
const SELF_HOSTED = !process.env.CORS_ORIGINS && !process.env.STRICT_CORS;
const ALLOWED_ORIGINS = new Set<string>();
{
  const raw = process.env.CORS_ORIGINS || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  for (const o of raw.split(",").map((s) => s.trim()).filter(Boolean)) ALLOWED_ORIGINS.add(o);
}

function isPrivateLanOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") return true;
    // RFC1918 private ranges + link-local — not public internet origins.
    return /^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname);
  } catch {
    return false;
  }
}

function isOriginAllowed(origin: string | undefined): boolean {
  // No Origin header (native apps, server-to-server) carries no ambient-cookie
  // CSWSH risk.
  if (!origin) return true;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  if (SELF_HOSTED && isPrivateLanOrigin(origin)) return true;
  return false;
}

// ─── Process-level safety nets ───
// A malformed packet or rejected promise must never take down the shared
// process that also serves Next.js. Log and keep running.
process.on("uncaughtException", (err) => {
  console.error("[Campfire] uncaughtException:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[Campfire] unhandledRejection:", reason);
});

// ─── Shared State ───
const onlineUsers = new Map<string, Map<string, { username: string; socketId: string }>>();
const voiceRooms = new Map<string, Map<string, { username: string; socketId: string; muted: boolean; deafened: boolean; camera: boolean; avatar?: string | null }>>();
const voiceChannelServer = new Map<string, string>();
const userVoiceChannel = new Map<string, string>();
type PresenceStatus = "online" | "idle" | "dnd" | "invisible";
const userStatus = new Map<string, PresenceStatus>();
const memberRoles = new Map<string, Map<string, string>>();
const serverMuted = new Set<string>();
const serverDeafened = new Set<string>();
const heartbeats = new Map<string, number>();
// Track every live socket per user so presence/voice are only torn down when a
// user's LAST tab disconnects (multi-tab no longer creates ghost seats).
const userSockets = new Map<string, Set<string>>();
const HEARTBEAT_INTERVAL = 15000;
const HEARTBEAT_TIMEOUT = 45000;

function roleLevel(role: string): number {
  const levels: Record<string, number> = { owner: 4, admin: 3, mod: 2, member: 1 };
  return levels[role] || 0;
}

// Wrap a socket handler so a thrown error (sync) or a rejected promise (async)
// is logged instead of crashing the shared server.
function safeHandler<A extends unknown[]>(fn: (...args: A) => void | Promise<void>) {
  return (...args: A) => {
    try {
      const result = fn(...args);
      if (result instanceof Promise) {
        result.catch((err) => console.error("[Campfire] handler error:", err));
      }
    } catch (err) {
      console.error("[Campfire] handler error:", err);
    }
  };
}

interface TokenPayload { userId: string; username: string; }

/**
 * Attach Socket.IO to any HTTP server. Works for:
 * - Unified server (single port with Next.js)
 * - Standalone mode (separate port)
 */
export function attachSocketIO(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => callback(null, isOriginAllowed(origin)),
      credentials: true,
    },
    path: SOCKET_PATH,
  });

  // Auth middleware
  io.use((socket, next) => {
    const rawCookie = socket.handshake.headers.cookie;
    if (!rawCookie) return next(new Error("Unauthorized"));
    const parsed = parse(rawCookie);
    const token = parsed[COOKIE_NAME];
    if (!token) return next(new Error("Unauthorized"));
    try {
      const payload = jwt.verify(token, config.jwtSecret) as TokenPayload;
      socket.data.userId = payload.userId;
      socket.data.username = payload.username;
      next();
    } catch {
      next(new Error("Unauthorized"));
    }
  });

  // Heartbeat cleanup
  setInterval(() => {
    const now = Date.now();
    for (const [socketId, lastBeat] of heartbeats) {
      if (now - lastBeat > HEARTBEAT_TIMEOUT) {
        const sock = io.sockets.sockets.get(socketId);
        if (sock) {
          console.log(`[Campfire] Heartbeat timeout: ${sock.data.username}`);
          sock.disconnect(true);
        }
        heartbeats.delete(socketId);
      }
    }
  }, HEARTBEAT_INTERVAL);

  // Connection handler
  io.on("connection", (socket) => {
    const currentUserId = socket.data.userId as string;
    const currentUsername = socket.data.username as string;
    console.log(`[Campfire] Authenticated socket: ${currentUsername}`);

    heartbeats.set(socket.id, Date.now());
    if (!userSockets.has(currentUserId)) userSockets.set(currentUserId, new Set());
    userSockets.get(currentUserId)!.add(socket.id);
    socket.on("heartbeat", safeHandler(() => { heartbeats.set(socket.id, Date.now()); }));
    userStatus.set(currentUserId, "online");

    // Drop high-frequency / broadcast emits that exceed the shared rate limit.
    // Keyed per socket + event so each event type has its own budget.
    function overLimit(event: string): boolean {
      return !checkRateLimit(`${socket.id}:${event}`).allowed;
    }

    // ─── Channel Rooms ───
    socket.on("channel:join", safeHandler(async (channelId: string) => {
      if (typeof channelId !== "string") return;
      // Only members of the channel's server may subscribe to its messages.
      const ctx = await requireChannelMembership(channelId, currentUserId);
      if (!ctx) return;
      socket.join(`channel:${channelId}`);
    }));
    socket.on("channel:leave", safeHandler((channelId: string) => {
      if (typeof channelId !== "string") return;
      socket.leave(`channel:${channelId}`);
    }));

    // ─── Server Presence ───
    socket.on("server:join", safeHandler(async (data: string | { serverId: string }) => {
      const serverId = typeof data === "string" ? data : data?.serverId;
      if (typeof serverId !== "string") return;
      // Authoritative role comes from the DB — never trust a client-supplied
      // role. Non-members (or banned users) get no presence and no role.
      const membership = await requireMembership(serverId, currentUserId);
      if (!membership) return;
      socket.join(`server:${serverId}`);
      if (!memberRoles.has(serverId)) memberRoles.set(serverId, new Map());
      memberRoles.get(serverId)!.set(currentUserId, membership.role);
      if (!onlineUsers.has(serverId)) onlineUsers.set(serverId, new Map());
      onlineUsers.get(serverId)!.set(currentUserId, { username: currentUsername, socketId: socket.id });
      broadcastPresence(serverId);
    }));

    socket.on("server:leave", safeHandler((serverId: string) => {
      if (typeof serverId !== "string") return;
      socket.leave(`server:${serverId}`);
      removeFromPresence(serverId, currentUserId);
    }));

    // ─── Messages ───
    socket.on("message:send", safeHandler(async (data: { channelId: string; message: { id: string; content: string; createdAt: string; author: { id: string; username: string } } }) => {
      if (!data || typeof data.channelId !== "string" || !data.message) return;
      const ctx = await requireChannelMembership(data.channelId, currentUserId);
      if (!ctx) return;
      // Never trust the client's claimed identity — stamp the real author.
      const message = {
        ...data.message,
        author: { ...data.message.author, id: currentUserId, username: currentUsername },
      };
      socket.to(`channel:${data.channelId}`).emit(`message:channel:${data.channelId}`, message);
    }));

    socket.on("message:edit", safeHandler(async (data: { channelId: string; messageId: string; content: string; updatedAt: string }) => {
      if (!data || typeof data.channelId !== "string" || typeof data.messageId !== "string") return;
      const ctx = await requireChannelMembership(data.channelId, currentUserId);
      if (!ctx) return;
      const msg = await prisma.message.findUnique({ where: { id: data.messageId }, select: { authorId: true, channelId: true } });
      if (!msg || msg.channelId !== data.channelId) return;
      if (msg.authorId !== currentUserId && !canManageMessages(ctx.membership.role)) return;
      socket.to(`channel:${data.channelId}`).emit(`message:edited:${data.channelId}`, { messageId: data.messageId, content: data.content, updatedAt: data.updatedAt });
    }));

    socket.on("message:delete", safeHandler(async (data: { channelId: string; messageId: string }) => {
      if (!data || typeof data.channelId !== "string" || typeof data.messageId !== "string") return;
      const ctx = await requireChannelMembership(data.channelId, currentUserId);
      if (!ctx) return;
      // The REST DELETE (already authorized) usually removed the row before this
      // notification fires, so a missing row is the normal case. If the row
      // still exists, only its author or a manager may broadcast its removal.
      const msg = await prisma.message.findUnique({ where: { id: data.messageId }, select: { authorId: true, channelId: true } });
      if (msg) {
        if (msg.channelId !== data.channelId) return;
        if (msg.authorId !== currentUserId && !canManageMessages(ctx.membership.role)) return;
      }
      socket.to(`channel:${data.channelId}`).emit(`message:deleted:${data.channelId}`, { messageId: data.messageId });
    }));

    socket.on("message:react", safeHandler(async (data: { channelId: string; messageId: string; reactions: Record<string, { count: number; users: string[]; userIds: string[] }> }) => {
      if (!data || typeof data.channelId !== "string" || typeof data.messageId !== "string") return;
      const ctx = await requireChannelMembership(data.channelId, currentUserId);
      if (!ctx) return;
      socket.to(`channel:${data.channelId}`).emit(`message:reacted:${data.channelId}`, { messageId: data.messageId, reactions: data.reactions });
    }));

    // ─── Presence Status ───
    socket.on("presence:status", safeHandler((status: string) => {
      if (typeof status !== "string" || !["online", "idle", "dnd", "invisible"].includes(status)) return;
      userStatus.set(currentUserId, status as PresenceStatus);
      for (const [serverId, members] of onlineUsers) {
        if (members.has(currentUserId)) broadcastPresence(serverId);
      }
    }));

    // ─── Typing ───
    socket.on("typing:start", safeHandler((channelId: string) => {
      if (typeof channelId !== "string") return;
      socket.to(`channel:${channelId}`).emit("typing:update", { channelId, userId: currentUserId, username: currentUsername, isTyping: true });
    }));
    socket.on("typing:stop", safeHandler((channelId: string) => {
      if (typeof channelId !== "string") return;
      socket.to(`channel:${channelId}`).emit("typing:update", { channelId, userId: currentUserId, username: currentUsername, isTyping: false });
    }));

    // ─── Voice Chat (WebRTC Signaling) ───
    socket.on("voice:join", safeHandler(async (data: string | { channelId: string; serverId?: string; avatar?: string | null }) => {
      const channelId = typeof data === "string" ? data : data?.channelId;
      const avatar = typeof data === "string" ? undefined : data?.avatar;
      if (typeof channelId !== "string") return;

      // Must be a member of the channel's server to join its voice room.
      const ctx = await requireChannelMembership(channelId, currentUserId);
      if (!ctx) {
        socket.emit("voice:error", { channelId, error: "Not authorized to join this voice channel" });
        return;
      }
      const serverId = ctx.serverId;

      const prevChannel = userVoiceChannel.get(currentUserId);
      if (prevChannel && prevChannel !== channelId) leaveVoiceChannel(prevChannel);
      userVoiceChannel.set(currentUserId, channelId);
      socket.join(`voice:${channelId}`);
      voiceChannelServer.set(channelId, serverId);
      if (!voiceRooms.has(channelId)) voiceRooms.set(channelId, new Map());

      const existing = Array.from(voiceRooms.get(channelId)!.entries()).map(
        ([userId, info]) => ({ userId, username: info.username, socketId: info.socketId, muted: info.muted, deafened: info.deafened, camera: info.camera, avatar: info.avatar })
      );
      socket.emit("voice:participants", { channelId, participants: existing });

      voiceRooms.get(channelId)!.set(currentUserId, {
        username: currentUsername, socketId: socket.id, muted: false, deafened: false, camera: false, avatar: avatar || null,
      });

      socket.to(`voice:${channelId}`).emit("voice:user-joined", { channelId, userId: currentUserId, username: currentUsername, socketId: socket.id });
      broadcastVoiceParticipants(channelId);
    }));

    socket.on("voice:leave", safeHandler((channelId: string) => {
      if (typeof channelId !== "string") return;
      leaveVoiceChannel(channelId);
    }));

    socket.on("voice:mute", safeHandler((data: { channelId: string; muted: boolean }) => {
      if (!data || typeof data.channelId !== "string") return;
      const room = voiceRooms.get(data.channelId);
      if (room?.has(currentUserId)) { room.get(currentUserId)!.muted = data.muted; broadcastVoiceParticipants(data.channelId); }
    }));

    socket.on("voice:deafen", safeHandler((data: { channelId: string; deafened: boolean }) => {
      if (!data || typeof data.channelId !== "string") return;
      const room = voiceRooms.get(data.channelId);
      if (room?.has(currentUserId)) {
        room.get(currentUserId)!.deafened = data.deafened;
        if (data.deafened) room.get(currentUserId)!.muted = true;
        broadcastVoiceParticipants(data.channelId);
      }
    }));

    socket.on("voice:camera", safeHandler((data: { channelId: string; camera: boolean }) => {
      if (!data || typeof data.channelId !== "string") return;
      const room = voiceRooms.get(data.channelId);
      if (room?.has(currentUserId)) { room.get(currentUserId)!.camera = data.camera; broadcastVoiceParticipants(data.channelId); }
    }));

    socket.on("voice:speaking", safeHandler((data: { channelId: string; speaking: boolean }) => {
      if (!data || typeof data.channelId !== "string") return;
      if (overLimit("voice:speaking")) return;
      if (!voiceRooms.get(data.channelId)?.has(currentUserId)) return;
      socket.to(`voice:${data.channelId}`).emit("voice:speaking", { userId: currentUserId, speaking: data.speaking });
    }));

    // Soundboard — relay a one-shot sound to everyone else in the voice channel.
    // The clicker plays it locally; this broadcasts to the rest of the room.
    socket.on("soundboard:play", safeHandler((data: { channelId: string; src: string; name?: string }) => {
      if (!data?.channelId || typeof data.src !== "string") return;
      if (overLimit("soundboard:play")) return;
      // Must actually be in that voice channel.
      if (!voiceRooms.get(data.channelId)?.has(currentUserId)) return;
      // Allowlist the source: built-in static path or an inline audio data URL only
      // (stops it being used to make every client fetch an arbitrary attacker URL).
      const okSrc = data.src.startsWith("/soundboard/") || data.src.startsWith("data:audio/");
      if (!okSrc || data.src.length > 1_000_000) return;
      socket.to(`voice:${data.channelId}`).emit("soundboard:play", { src: data.src, name: data.name, by: currentUsername });
    }));

    // ─── Ember Reactions ───
    socket.on("ember:react", safeHandler((data: { channelId: string; emoji: string }) => {
      if (!data || typeof data.channelId !== "string" || typeof data.emoji !== "string") return;
      const ALLOWED = ["laugh", "applause", "agree", "wow", "skull", "clink", "nod"];
      if (!ALLOWED.includes(data.emoji)) return;
      if (!voiceRooms.get(data.channelId)?.has(currentUserId)) return;
      socket.to(`voice:${data.channelId}`).emit("ember:reaction", { userId: currentUserId, username: currentUsername, emoji: data.emoji });
    }));

    // ─── Screen Share ───
    socket.on("screen:start", safeHandler((data: { channelId: string }) => {
      if (!data || typeof data.channelId !== "string") return;
      if (overLimit("screen:start")) return;
      if (!voiceRooms.get(data.channelId)?.has(currentUserId)) return;
      socket.to(`voice:${data.channelId}`).emit("screen:started", { userId: currentUserId, username: currentUsername, socketId: socket.id });
    }));
    socket.on("screen:stop", safeHandler((data: { channelId: string }) => {
      if (!data || typeof data.channelId !== "string") return;
      if (overLimit("screen:stop")) return;
      if (!voiceRooms.get(data.channelId)?.has(currentUserId)) return;
      socket.to(`voice:${data.channelId}`).emit("screen:stopped", { userId: currentUserId });
    }));
    socket.on("screen:offer", safeHandler((data: { to: string; offer: RTCSessionDescriptionInit }) => {
      if (!data || typeof data.to !== "string") return;
      io.to(data.to).emit("screen:offer", { from: socket.id, fromUserId: currentUserId, fromUsername: currentUsername, offer: data.offer });
    }));
    socket.on("screen:answer", safeHandler((data: { to: string; answer: RTCSessionDescriptionInit }) => {
      if (!data || typeof data.to !== "string") return;
      io.to(data.to).emit("screen:answer", { from: socket.id, answer: data.answer });
    }));
    socket.on("screen:ice-candidate", safeHandler((data: { to: string; candidate: RTCIceCandidateInit }) => {
      if (!data || typeof data.to !== "string") return;
      io.to(data.to).emit("screen:ice-candidate", { from: socket.id, candidate: data.candidate });
    }));

    // ─── Moderation ───
    function getModRole(channelId: string): { serverId: string; callerRole: number } | null {
      const serverId = voiceChannelServer.get(channelId);
      if (!serverId) return null;
      return { serverId, callerRole: roleLevel(memberRoles.get(serverId)?.get(currentUserId) || "member") };
    }
    function getTargetRole(serverId: string, targetUserId: string): number {
      return roleLevel(memberRoles.get(serverId)?.get(targetUserId) || "member");
    }

    socket.on("mod:server-mute", safeHandler((data: { channelId: string; targetUserId: string; muted: boolean }) => {
      if (!data || typeof data.channelId !== "string" || typeof data.targetUserId !== "string") return;
      const ctx = getModRole(data.channelId);
      if (!ctx || ctx.callerRole < 2 || ctx.callerRole <= getTargetRole(ctx.serverId, data.targetUserId)) return;
      const key = `${ctx.serverId}:${data.targetUserId}`;
      if (data.muted) serverMuted.add(key); else serverMuted.delete(key);
      const room = voiceRooms.get(data.channelId);
      if (room?.has(data.targetUserId)) { room.get(data.targetUserId)!.muted = data.muted; broadcastVoiceParticipants(data.channelId); }
      const targetEntry = room?.get(data.targetUserId);
      if (targetEntry) io.to(targetEntry.socketId).emit("mod:force-mute", { muted: data.muted, by: currentUsername });
    }));

    socket.on("mod:server-deafen", safeHandler((data: { channelId: string; targetUserId: string; deafened: boolean }) => {
      if (!data || typeof data.channelId !== "string" || typeof data.targetUserId !== "string") return;
      const ctx = getModRole(data.channelId);
      if (!ctx || ctx.callerRole < 2 || ctx.callerRole <= getTargetRole(ctx.serverId, data.targetUserId)) return;
      const key = `${ctx.serverId}:${data.targetUserId}`;
      if (data.deafened) serverDeafened.add(key); else serverDeafened.delete(key);
      const room = voiceRooms.get(data.channelId);
      if (room?.has(data.targetUserId)) {
        const entry = room.get(data.targetUserId)!;
        entry.deafened = data.deafened;
        if (data.deafened) entry.muted = true;
        broadcastVoiceParticipants(data.channelId);
        io.to(entry.socketId).emit("mod:force-deafen", { deafened: data.deafened, by: currentUsername });
      }
    }));

    socket.on("mod:kick-voice", safeHandler((data: { channelId: string; targetUserId: string }) => {
      if (!data || typeof data.channelId !== "string" || typeof data.targetUserId !== "string") return;
      const ctx = getModRole(data.channelId);
      if (!ctx || ctx.callerRole < 2 || ctx.callerRole <= getTargetRole(ctx.serverId, data.targetUserId)) return;
      const room = voiceRooms.get(data.channelId);
      const targetEntry = room?.get(data.targetUserId);
      if (targetEntry) {
        io.to(targetEntry.socketId).emit("mod:kicked-from-voice", { channelId: data.channelId, by: currentUsername });
        room!.delete(data.targetUserId);
        userVoiceChannel.delete(data.targetUserId);
        io.to(`voice:${data.channelId}`).emit("voice:user-left", { channelId: data.channelId, userId: data.targetUserId, socketId: targetEntry.socketId });
        const targetSocket = io.sockets.sockets.get(targetEntry.socketId);
        if (targetSocket) targetSocket.leave(`voice:${data.channelId}`);
        broadcastVoiceParticipants(data.channelId);
      }
    }));

    socket.on("mod:move-user", safeHandler((data: { fromChannelId: string; toChannelId: string; targetUserId: string }) => {
      if (!data || typeof data.fromChannelId !== "string" || typeof data.toChannelId !== "string" || typeof data.targetUserId !== "string") return;
      const ctx = getModRole(data.fromChannelId);
      if (!ctx || ctx.callerRole < 2 || ctx.callerRole <= getTargetRole(ctx.serverId, data.targetUserId)) return;
      const room = voiceRooms.get(data.fromChannelId);
      const targetEntry = room?.get(data.targetUserId);
      if (!targetEntry) return;
      room!.delete(data.targetUserId);
      const targetSocket = io.sockets.sockets.get(targetEntry.socketId);
      if (targetSocket) targetSocket.leave(`voice:${data.fromChannelId}`);
      io.to(`voice:${data.fromChannelId}`).emit("voice:user-left", { channelId: data.fromChannelId, userId: data.targetUserId, socketId: targetEntry.socketId });
      broadcastVoiceParticipants(data.fromChannelId);
      if (targetSocket) targetSocket.join(`voice:${data.toChannelId}`);
      if (!voiceRooms.has(data.toChannelId)) voiceRooms.set(data.toChannelId, new Map());
      voiceRooms.get(data.toChannelId)!.set(data.targetUserId, { username: targetEntry.username, socketId: targetEntry.socketId, muted: targetEntry.muted, deafened: targetEntry.deafened, camera: targetEntry.camera, avatar: targetEntry.avatar });
      userVoiceChannel.set(data.targetUserId, data.toChannelId);
      voiceChannelServer.set(data.toChannelId, ctx.serverId);
      if (targetSocket) targetSocket.emit("mod:moved-to-channel", { fromChannelId: data.fromChannelId, toChannelId: data.toChannelId, by: currentUsername });
      io.to(`voice:${data.toChannelId}`).emit("voice:user-joined", { channelId: data.toChannelId, userId: data.targetUserId, username: targetEntry.username, socketId: targetEntry.socketId });
      broadcastVoiceParticipants(data.toChannelId);
    }));

    // ─── WebRTC Signaling ───
    socket.on("voice:offer", safeHandler((data: { to: string; offer: RTCSessionDescriptionInit }) => {
      if (!data || typeof data.to !== "string") return;
      io.to(data.to).emit("voice:offer", { from: socket.id, fromUserId: currentUserId, fromUsername: currentUsername, offer: data.offer });
    }));
    socket.on("voice:answer", safeHandler((data: { to: string; answer: RTCSessionDescriptionInit }) => {
      if (!data || typeof data.to !== "string") return;
      io.to(data.to).emit("voice:answer", { from: socket.id, answer: data.answer });
    }));
    socket.on("voice:ice-candidate", safeHandler((data: { to: string; candidate: RTCIceCandidateInit }) => {
      if (!data || typeof data.to !== "string") return;
      io.to(data.to).emit("voice:ice-candidate", { from: socket.id, candidate: data.candidate });
    }));

    // ─── Voice Helpers ───
    function leaveVoiceChannel(channelId: string) {
      socket.leave(`voice:${channelId}`);
      const room = voiceRooms.get(channelId);
      if (!room) return;
      const entry = room.get(currentUserId);
      if (entry && entry.socketId === socket.id) {
        room.delete(currentUserId);
        if (userVoiceChannel.get(currentUserId) === channelId) userVoiceChannel.delete(currentUserId);
        socket.to(`voice:${channelId}`).emit("voice:user-left", { channelId, userId: currentUserId, socketId: socket.id });
        if (room.size === 0) voiceRooms.delete(channelId);
        broadcastVoiceParticipants(channelId);
      }
    }

    function broadcastVoiceParticipants(channelId: string) {
      const room = voiceRooms.get(channelId);
      const participants = room
        ? Array.from(room.entries()).map(([userId, info]) => ({ userId, username: info.username, muted: info.muted, deafened: info.deafened, camera: info.camera, avatar: info.avatar }))
        : [];
      const payload = { channelId, participants };
      io.to(`voice:${channelId}`).emit("voice:participants-update", payload);
      const serverId = voiceChannelServer.get(channelId);
      if (serverId) io.to(`server:${serverId}`).emit("voice:participants-update", payload);
    }

    // ─── DM Typing ───
    // Both participants subscribe to the conversation room via `dm:join`; typing
    // is then relayed there. The sender is taken from the socket session, never
    // from the client payload.
    socket.on("dm:join", safeHandler(async (conversationId: string) => {
      if (typeof conversationId !== "string") return;
      const conv = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { user1Id: true, user2Id: true } });
      if (!conv || (conv.user1Id !== currentUserId && conv.user2Id !== currentUserId)) return;
      socket.join(`conv:${conversationId}`);
    }));

    socket.on("dm:typing", safeHandler(async (data: { conversationId: string }) => {
      if (!data || typeof data.conversationId !== "string") return;
      const conv = await prisma.conversation.findUnique({ where: { id: data.conversationId }, select: { user1Id: true, user2Id: true } });
      if (!conv || (conv.user1Id !== currentUserId && conv.user2Id !== currentUserId)) return;
      socket.to(`conv:${data.conversationId}`).emit("dm:typing", { conversationId: data.conversationId, userId: currentUserId, username: currentUsername });
    }));

    // ─── Disconnect ───
    socket.on("disconnect", safeHandler(() => {
      console.log(`[Campfire] Disconnected: ${currentUsername}`);
      heartbeats.delete(socket.id);
      // Leave any voice room this specific socket occupied (guarded by socketId).
      for (const [channelId] of voiceRooms) leaveVoiceChannel(channelId);

      const sockets = userSockets.get(currentUserId);
      if (sockets) sockets.delete(socket.id);
      const lastSocket = !sockets || sockets.size === 0;
      if (lastSocket) {
        // Only the user's final tab tears down user-level presence/voice state.
        userSockets.delete(currentUserId);
        userVoiceChannel.delete(currentUserId);
        userStatus.delete(currentUserId);
        for (const [serverId] of onlineUsers) removeFromPresence(serverId, currentUserId, true);
      }
    }));

    function removeFromPresence(serverId: string, userId: string, force = false) {
      const serverMap = onlineUsers.get(serverId);
      if (!serverMap) return;
      const entry = serverMap.get(userId);
      if (entry && (force || entry.socketId === socket.id)) { serverMap.delete(userId); broadcastPresence(serverId); }
      if (serverMap.size === 0) onlineUsers.delete(serverId);
    }

    function broadcastPresence(serverId: string) {
      const serverMap = onlineUsers.get(serverId);
      if (!serverMap) return;
      const members = Array.from(serverMap.entries()).map(([userId, info]) => ({ userId, username: info.username, status: userStatus.get(userId) || "online" }));
      io.to(`server:${serverId}`).emit("presence:update", { serverId, members });
    }
  });

  return io;
}

// ─── Standalone Mode ───
// When run DIRECTLY (`npx tsx realtime/server.ts`), start on its own port.
// When merely imported (the unified `npm run host` server), do nothing here —
// otherwise we'd wrongly bind port 3001 as a side effect of the import.
let io: Server | undefined;

const isDirectRun = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  const PORT = config.socketPort;
  const httpServer = createServer();
  io = attachSocketIO(httpServer);
  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`[Campfire] Realtime server running on 0.0.0.0:${PORT}`);
  });
}

export { io };
