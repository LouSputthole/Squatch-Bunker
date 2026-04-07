import { createServer, Server as HttpServer } from "http";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { parse } from "cookie";

const JWT_SECRET = process.env.JWT_SECRET || "campfire-secret-change-me";
const COOKIE_NAME = process.env.COOKIE_NAME || "squatch-token";
const SOCKET_PATH = process.env.SOCKET_PATH || "/api/socketio";

// CORS — in self-hosted mode, accept any origin so LAN/remote clients can connect.
const SELF_HOSTED = !process.env.CORS_ORIGINS && !process.env.STRICT_CORS;
const rawOrigins = process.env.CORS_ORIGINS || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const CORS_ORIGIN: string | string[] | true = SELF_HOSTED
  ? true
  : rawOrigins.includes(",") ? rawOrigins.split(",").map((s) => s.trim()) : rawOrigins;

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
const HEARTBEAT_INTERVAL = 15000;
const HEARTBEAT_TIMEOUT = 45000;

function roleLevel(role: string): number {
  const levels: Record<string, number> = { owner: 4, admin: 3, mod: 2, member: 1 };
  return levels[role] || 0;
}

interface TokenPayload { userId: string; username: string; }

/**
 * Attach Socket.IO to any HTTP server. Works for:
 * - Unified server (single port with Next.js)
 * - Standalone mode (separate port)
 */
export function attachSocketIO(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: { origin: CORS_ORIGIN, credentials: true },
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
      const payload = jwt.verify(token, JWT_SECRET) as TokenPayload;
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
    socket.on("heartbeat", () => { heartbeats.set(socket.id, Date.now()); });
    userStatus.set(currentUserId, "online");

    // ─── Channel Rooms ───
    socket.on("channel:join", (channelId: string) => { socket.join(`channel:${channelId}`); });
    socket.on("channel:leave", (channelId: string) => { socket.leave(`channel:${channelId}`); });

    // ─── Server Presence ───
    socket.on("server:join", (data: string | { serverId: string; role?: string }) => {
      const serverId = typeof data === "string" ? data : data.serverId;
      const role = typeof data === "string" ? "member" : (data.role || "member");
      socket.join(`server:${serverId}`);
      if (!memberRoles.has(serverId)) memberRoles.set(serverId, new Map());
      memberRoles.get(serverId)!.set(currentUserId, role);
      if (!onlineUsers.has(serverId)) onlineUsers.set(serverId, new Map());
      onlineUsers.get(serverId)!.set(currentUserId, { username: currentUsername, socketId: socket.id });
      broadcastPresence(serverId);
    });

    socket.on("server:leave", (serverId: string) => {
      socket.leave(`server:${serverId}`);
      removeFromPresence(serverId, currentUserId);
    });

    // ─── Messages ───
    socket.on("message:send", (data: { channelId: string; message: { id: string; content: string; createdAt: string; author: { id: string; username: string } } }) => {
      socket.to(`channel:${data.channelId}`).emit(`message:channel:${data.channelId}`, data.message);
    });

    socket.on("message:edit", (data: { channelId: string; messageId: string; content: string; updatedAt: string }) => {
      socket.to(`channel:${data.channelId}`).emit(`message:edited:${data.channelId}`, { messageId: data.messageId, content: data.content, updatedAt: data.updatedAt });
    });

    socket.on("message:delete", (data: { channelId: string; messageId: string }) => {
      socket.to(`channel:${data.channelId}`).emit(`message:deleted:${data.channelId}`, { messageId: data.messageId });
    });

    socket.on("message:react", (data: { channelId: string; messageId: string; reactions: Record<string, { count: number; users: string[]; userIds: string[] }> }) => {
      socket.to(`channel:${data.channelId}`).emit(`message:reacted:${data.channelId}`, { messageId: data.messageId, reactions: data.reactions });
    });

    // ─── Presence Status ───
    socket.on("presence:status", (status: string) => {
      if (!["online", "idle", "dnd", "invisible"].includes(status)) return;
      userStatus.set(currentUserId, status as PresenceStatus);
      for (const [serverId, members] of onlineUsers) {
        if (members.has(currentUserId)) broadcastPresence(serverId);
      }
    });

    // ─── Typing ───
    socket.on("typing:start", (channelId: string) => {
      socket.to(`channel:${channelId}`).emit("typing:update", { channelId, userId: currentUserId, username: currentUsername, isTyping: true });
    });
    socket.on("typing:stop", (channelId: string) => {
      socket.to(`channel:${channelId}`).emit("typing:update", { channelId, userId: currentUserId, username: currentUsername, isTyping: false });
    });

    // ─── Voice Chat (WebRTC Signaling) ───
    socket.on("voice:join", (data: string | { channelId: string; serverId?: string; avatar?: string | null }) => {
      const channelId = typeof data === "string" ? data : data.channelId;
      const serverId = typeof data === "string" ? undefined : data.serverId;
      const avatar = typeof data === "string" ? undefined : data.avatar;

      const prevChannel = userVoiceChannel.get(currentUserId);
      if (prevChannel && prevChannel !== channelId) leaveVoiceChannel(prevChannel);
      userVoiceChannel.set(currentUserId, channelId);
      socket.join(`voice:${channelId}`);
      if (serverId) voiceChannelServer.set(channelId, serverId);
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
    });

    socket.on("voice:leave", (channelId: string) => { leaveVoiceChannel(channelId); });

    socket.on("voice:mute", (data: { channelId: string; muted: boolean }) => {
      const room = voiceRooms.get(data.channelId);
      if (room?.has(currentUserId)) { room.get(currentUserId)!.muted = data.muted; broadcastVoiceParticipants(data.channelId); }
    });

    socket.on("voice:deafen", (data: { channelId: string; deafened: boolean }) => {
      const room = voiceRooms.get(data.channelId);
      if (room?.has(currentUserId)) {
        room.get(currentUserId)!.deafened = data.deafened;
        if (data.deafened) room.get(currentUserId)!.muted = true;
        broadcastVoiceParticipants(data.channelId);
      }
    });

    socket.on("voice:camera", (data: { channelId: string; camera: boolean }) => {
      const room = voiceRooms.get(data.channelId);
      if (room?.has(currentUserId)) { room.get(currentUserId)!.camera = data.camera; broadcastVoiceParticipants(data.channelId); }
    });

    socket.on("voice:speaking", (data: { channelId: string; speaking: boolean }) => {
      socket.to(`voice:${data.channelId}`).emit("voice:speaking", { userId: currentUserId, speaking: data.speaking });
    });

    // ─── Ember Reactions ───
    socket.on("ember:react", (data: { channelId: string; emoji: string }) => {
      const ALLOWED = ["laugh", "applause", "agree", "wow", "skull", "clink", "nod"];
      if (!ALLOWED.includes(data.emoji)) return;
      socket.to(`voice:${data.channelId}`).emit("ember:reaction", { userId: currentUserId, username: currentUsername, emoji: data.emoji });
    });

    // ─── Screen Share ───
    socket.on("screen:start", (data: { channelId: string }) => {
      socket.to(`voice:${data.channelId}`).emit("screen:started", { userId: currentUserId, username: currentUsername, socketId: socket.id });
    });
    socket.on("screen:stop", (data: { channelId: string }) => {
      socket.to(`voice:${data.channelId}`).emit("screen:stopped", { userId: currentUserId });
    });
    socket.on("screen:offer", (data: { to: string; offer: RTCSessionDescriptionInit }) => {
      io.to(data.to).emit("screen:offer", { from: socket.id, fromUserId: currentUserId, fromUsername: currentUsername, offer: data.offer });
    });
    socket.on("screen:answer", (data: { to: string; answer: RTCSessionDescriptionInit }) => {
      io.to(data.to).emit("screen:answer", { from: socket.id, answer: data.answer });
    });
    socket.on("screen:ice-candidate", (data: { to: string; candidate: RTCIceCandidateInit }) => {
      io.to(data.to).emit("screen:ice-candidate", { from: socket.id, candidate: data.candidate });
    });

    // ─── Moderation ───
    function getModRole(channelId: string): { serverId: string; callerRole: number } | null {
      const serverId = voiceChannelServer.get(channelId);
      if (!serverId) return null;
      return { serverId, callerRole: roleLevel(memberRoles.get(serverId)?.get(currentUserId) || "member") };
    }
    function getTargetRole(serverId: string, targetUserId: string): number {
      return roleLevel(memberRoles.get(serverId)?.get(targetUserId) || "member");
    }

    socket.on("mod:server-mute", (data: { channelId: string; targetUserId: string; muted: boolean }) => {
      const ctx = getModRole(data.channelId);
      if (!ctx || ctx.callerRole < 2 || ctx.callerRole <= getTargetRole(ctx.serverId, data.targetUserId)) return;
      const key = `${ctx.serverId}:${data.targetUserId}`;
      if (data.muted) serverMuted.add(key); else serverMuted.delete(key);
      const room = voiceRooms.get(data.channelId);
      if (room?.has(data.targetUserId)) { room.get(data.targetUserId)!.muted = data.muted; broadcastVoiceParticipants(data.channelId); }
      const targetEntry = room?.get(data.targetUserId);
      if (targetEntry) io.to(targetEntry.socketId).emit("mod:force-mute", { muted: data.muted, by: currentUsername });
    });

    socket.on("mod:server-deafen", (data: { channelId: string; targetUserId: string; deafened: boolean }) => {
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
    });

    socket.on("mod:kick-voice", (data: { channelId: string; targetUserId: string }) => {
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
    });

    socket.on("mod:move-user", (data: { fromChannelId: string; toChannelId: string; targetUserId: string }) => {
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
    });

    // ─── WebRTC Signaling ───
    socket.on("voice:offer", (data: { to: string; offer: RTCSessionDescriptionInit }) => {
      io.to(data.to).emit("voice:offer", { from: socket.id, fromUserId: currentUserId, fromUsername: currentUsername, offer: data.offer });
    });
    socket.on("voice:answer", (data: { to: string; answer: RTCSessionDescriptionInit }) => {
      io.to(data.to).emit("voice:answer", { from: socket.id, answer: data.answer });
    });
    socket.on("voice:ice-candidate", (data: { to: string; candidate: RTCIceCandidateInit }) => {
      io.to(data.to).emit("voice:ice-candidate", { from: socket.id, candidate: data.candidate });
    });

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
    socket.on("dm:typing", (data: { conversationId: string; userId: string }) => {
      socket.to(`conv:${data.conversationId}`).emit("dm:typing", { conversationId: data.conversationId, userId: data.userId, username: currentUsername });
    });

    // ─── Disconnect ───
    socket.on("disconnect", () => {
      console.log(`[Campfire] Disconnected: ${currentUsername}`);
      heartbeats.delete(socket.id);
      userVoiceChannel.delete(currentUserId);
      userStatus.delete(currentUserId);
      for (const [channelId] of voiceRooms) leaveVoiceChannel(channelId);
      for (const [serverId] of onlineUsers) removeFromPresence(serverId, currentUserId);
    });

    function removeFromPresence(serverId: string, userId: string) {
      const serverMap = onlineUsers.get(serverId);
      if (!serverMap) return;
      const entry = serverMap.get(userId);
      if (entry && entry.socketId === socket.id) { serverMap.delete(userId); broadcastPresence(serverId); }
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
// When run directly (npx tsx realtime/server.ts), start on its own port
const PORT = parseInt(process.env.SOCKET_PORT || "3001", 10);
const httpServer = createServer();
const io = attachSocketIO(httpServer);

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`[Campfire] Realtime server running on 0.0.0.0:${PORT}`);
});

export { io };
