import { createServer } from "http";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { parse } from "cookie";

const PORT = parseInt(process.env.SOCKET_PORT || "3001", 10);
const JWT_SECRET = process.env.JWT_SECRET || "campfire-secret-change-me";
const COOKIE_NAME = process.env.COOKIE_NAME || "squatch-token";
const SOCKET_PATH = process.env.SOCKET_PATH || "/api/socketio";

// CORS — supports comma-separated origins via CORS_ORIGINS, falls back to app URL
const rawOrigins = process.env.CORS_ORIGINS || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const CORS_ORIGIN = rawOrigins.includes(",") ? rawOrigins.split(",").map((s) => s.trim()) : rawOrigins;

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: {
    origin: CORS_ORIGIN,
    credentials: true,
  },
  path: SOCKET_PATH,
});

// Track online users per server: serverId -> Map<userId, {username, socketId}>
const onlineUsers = new Map<string, Map<string, { username: string; socketId: string }>>();

// Track voice channel participants: channelId -> Map<userId, {username, socketId, muted, deafened, camera, avatar}>
const voiceRooms = new Map<string, Map<string, { username: string; socketId: string; muted: boolean; deafened: boolean; camera: boolean; avatar?: string | null }>>();

// Track which server each voice channel belongs to: channelId -> serverId
const voiceChannelServer = new Map<string, string>();

// Track which voice channel each user is in: userId -> channelId (enforce single room)
const userVoiceChannel = new Map<string, string>();

// Presence statuses: userId -> status
type PresenceStatus = "online" | "idle" | "dnd" | "invisible";
const userStatus = new Map<string, PresenceStatus>();

// Track member roles per server: serverId -> Map<userId, role>
const memberRoles = new Map<string, Map<string, string>>();

// Server-muted / server-deafened users: Set of `${serverId}:${userId}`
const serverMuted = new Set<string>();
const serverDeafened = new Set<string>();

// Heartbeat tracking: socketId -> last heartbeat timestamp
const heartbeats = new Map<string, number>();
const HEARTBEAT_INTERVAL = 15000; // 15s
const HEARTBEAT_TIMEOUT = 45000; // 45s — 3 missed beats

// Role level check (must match lib/permissions.ts)
function roleLevel(role: string): number {
  const levels: Record<string, number> = { owner: 4, admin: 3, mod: 2, member: 1 };
  return levels[role] || 0;
}

interface TokenPayload {
  userId: string;
  username: string;
}

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

// Stale session cleanup — runs every HEARTBEAT_INTERVAL
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

io.on("connection", (socket) => {
  const currentUserId = socket.data.userId as string;
  const currentUsername = socket.data.username as string;
  console.log(`[Campfire] Authenticated socket: ${currentUsername}`);

  // Start heartbeat tracking
  heartbeats.set(socket.id, Date.now());
  socket.on("heartbeat", () => { heartbeats.set(socket.id, Date.now()); });

  // Default presence
  userStatus.set(currentUserId, "online");

  // Join a channel room
  socket.on("channel:join", (channelId: string) => {
    socket.join(`channel:${channelId}`);
  });

  // Leave a channel room
  socket.on("channel:leave", (channelId: string) => {
    socket.leave(`channel:${channelId}`);
  });

  // Join a server room (for presence)
  socket.on("server:join", (data: string | { serverId: string; role?: string }) => {
    const serverId = typeof data === "string" ? data : data.serverId;
    const role = typeof data === "string" ? "member" : (data.role || "member");

    socket.join(`server:${serverId}`);

    // Track role
    if (!memberRoles.has(serverId)) {
      memberRoles.set(serverId, new Map());
    }
    memberRoles.get(serverId)!.set(currentUserId, role);

    // Track presence
    if (!onlineUsers.has(serverId)) {
      onlineUsers.set(serverId, new Map());
    }
    onlineUsers.get(serverId)!.set(currentUserId, {
      username: currentUsername,
      socketId: socket.id,
    });

    broadcastPresence(serverId);
  });

  // Leave a server room
  socket.on("server:leave", (serverId: string) => {
    socket.leave(`server:${serverId}`);
    removeFromPresence(serverId, currentUserId);
  });

  // Handle message send - broadcast to channel room
  socket.on("message:send", (data: {
    channelId: string;
    message: {
      id: string;
      content: string;
      createdAt: string;
      author: { id: string; username: string };
    };
  }) => {
    const { channelId, message } = data;
    // Broadcast to everyone in the channel room except sender
    socket.to(`channel:${channelId}`).emit(`message:channel:${channelId}`, message);
  });

  // Handle message edit - broadcast to channel room
  socket.on("message:edit", (data: {
    channelId: string;
    messageId: string;
    content: string;
    updatedAt: string;
  }) => {
    socket.to(`channel:${data.channelId}`).emit(`message:edited:${data.channelId}`, {
      messageId: data.messageId,
      content: data.content,
      updatedAt: data.updatedAt,
    });
  });

  // Handle message delete - broadcast to channel room
  socket.on("message:delete", (data: {
    channelId: string;
    messageId: string;
  }) => {
    socket.to(`channel:${data.channelId}`).emit(`message:deleted:${data.channelId}`, {
      messageId: data.messageId,
    });
  });

  // Handle reaction update - broadcast to channel room
  socket.on("message:react", (data: {
    channelId: string;
    messageId: string;
    reactions: Record<string, { count: number; users: string[]; userIds: string[] }>;
  }) => {
    socket.to(`channel:${data.channelId}`).emit(`message:reacted:${data.channelId}`, {
      messageId: data.messageId,
      reactions: data.reactions,
    });
  });

  // Presence status change
  socket.on("presence:status", (status: string) => {
    if (!["online", "idle", "dnd", "invisible"].includes(status)) return;
    userStatus.set(currentUserId, status as PresenceStatus);
    // Re-broadcast presence to all servers this user is in
    for (const [serverId, members] of onlineUsers) {
      if (members.has(currentUserId)) {
        broadcastPresence(serverId);
      }
    }
  });

  // Typing indicator
  socket.on("typing:start", (channelId: string) => {
    socket.to(`channel:${channelId}`).emit("typing:update", {
      channelId,
      userId: currentUserId,
      username: currentUsername,
      isTyping: true,
    });
  });

  socket.on("typing:stop", (channelId: string) => {
    socket.to(`channel:${channelId}`).emit("typing:update", {
      channelId,
      userId: currentUserId,
      username: currentUsername,
      isTyping: false,
    });
  });

  // ─── Voice Chat (WebRTC Signaling) ───

  // Join a voice channel
  socket.on("voice:join", (data: string | { channelId: string; serverId?: string; avatar?: string | null }) => {
    // Support both old format (just channelId string) and new format ({channelId, serverId, avatar})
    const channelId = typeof data === "string" ? data : data.channelId;
    const serverId = typeof data === "string" ? undefined : data.serverId;
    const avatar = typeof data === "string" ? undefined : data.avatar;

    // Enforce single voice room — auto-leave previous
    const prevChannel = userVoiceChannel.get(currentUserId);
    if (prevChannel && prevChannel !== channelId) {
      leaveVoiceChannel(prevChannel);
    }
    userVoiceChannel.set(currentUserId, channelId);

    socket.join(`voice:${channelId}`);

    if (serverId) {
      voiceChannelServer.set(channelId, serverId);
    }

    if (!voiceRooms.has(channelId)) {
      voiceRooms.set(channelId, new Map());
    }

    // Tell the new user about existing participants (so they can create offers)
    const existing = Array.from(voiceRooms.get(channelId)!.entries()).map(
      ([userId, info]) => ({ userId, username: info.username, socketId: info.socketId, muted: info.muted, deafened: info.deafened, camera: info.camera, avatar: info.avatar })
    );
    socket.emit("voice:participants", { channelId, participants: existing });

    // Add the new user
    voiceRooms.get(channelId)!.set(currentUserId, {
      username: currentUsername,
      socketId: socket.id,
      muted: false,
      deafened: false,
      camera: false,
      avatar: avatar || null,
    });

    // Notify others that someone joined
    socket.to(`voice:${channelId}`).emit("voice:user-joined", {
      channelId,
      userId: currentUserId,
      username: currentUsername,
      socketId: socket.id,
    });

    // Broadcast updated participant list to the server room (for UI badges)
    broadcastVoiceParticipants(channelId);
  });

  // Leave a voice channel
  socket.on("voice:leave", (channelId: string) => {
    leaveVoiceChannel(channelId);
  });

  // Toggle mute
  socket.on("voice:mute", (data: { channelId: string; muted: boolean }) => {
    const room = voiceRooms.get(data.channelId);
    if (room && room.has(currentUserId)) {
      room.get(currentUserId)!.muted = data.muted;
      broadcastVoiceParticipants(data.channelId);
    }
  });

  // Toggle deafen
  socket.on("voice:deafen", (data: { channelId: string; deafened: boolean }) => {
    const room = voiceRooms.get(data.channelId);
    if (room && room.has(currentUserId)) {
      room.get(currentUserId)!.deafened = data.deafened;
      if (data.deafened) room.get(currentUserId)!.muted = true;
      broadcastVoiceParticipants(data.channelId);
    }
  });

  // Toggle camera
  socket.on("voice:camera", (data: { channelId: string; camera: boolean }) => {
    const room = voiceRooms.get(data.channelId);
    if (room && room.has(currentUserId)) {
      room.get(currentUserId)!.camera = data.camera;
      broadcastVoiceParticipants(data.channelId);
    }
  });

  // Speaking indicator — relay to voice room
  socket.on("voice:speaking", (data: { channelId: string; speaking: boolean }) => {
    socket.to(`voice:${data.channelId}`).emit("voice:speaking", {
      userId: currentUserId,
      speaking: data.speaking,
    });
  });

  // ─── Ember Reactions ───

  socket.on("ember:react", (data: { channelId: string; emoji: string }) => {
    const ALLOWED = ["laugh", "applause", "agree", "wow", "skull", "clink", "nod"];
    if (!ALLOWED.includes(data.emoji)) return;
    socket.to(`voice:${data.channelId}`).emit("ember:reaction", {
      userId: currentUserId,
      username: currentUsername,
      emoji: data.emoji,
    });
  });

  // ─── Screen Share ───

  // Notify room that a user started sharing screen
  socket.on("screen:start", (data: { channelId: string }) => {
    socket.to(`voice:${data.channelId}`).emit("screen:started", {
      userId: currentUserId,
      username: currentUsername,
      socketId: socket.id,
    });
  });

  // Notify room that a user stopped sharing
  socket.on("screen:stop", (data: { channelId: string }) => {
    socket.to(`voice:${data.channelId}`).emit("screen:stopped", {
      userId: currentUserId,
    });
  });

  // Relay screen share offer (separate from voice offers to avoid collision)
  socket.on("screen:offer", (data: { to: string; offer: RTCSessionDescriptionInit }) => {
    io.to(data.to).emit("screen:offer", {
      from: socket.id,
      fromUserId: currentUserId,
      fromUsername: currentUsername,
      offer: data.offer,
    });
  });

  socket.on("screen:answer", (data: { to: string; answer: RTCSessionDescriptionInit }) => {
    io.to(data.to).emit("screen:answer", {
      from: socket.id,
      answer: data.answer,
    });
  });

  socket.on("screen:ice-candidate", (data: { to: string; candidate: RTCIceCandidateInit }) => {
    io.to(data.to).emit("screen:ice-candidate", {
      from: socket.id,
      candidate: data.candidate,
    });
  });

  // ─── Moderation Actions ───

  // Helper: get caller's role in a voice channel's server
  function getModRole(channelId: string): { serverId: string; callerRole: number } | null {
    const serverId = voiceChannelServer.get(channelId);
    if (!serverId) return null;
    const roles = memberRoles.get(serverId);
    const callerRole = roleLevel(roles?.get(currentUserId) || "member");
    return { serverId, callerRole };
  }

  function getTargetRole(serverId: string, targetUserId: string): number {
    const roles = memberRoles.get(serverId);
    return roleLevel(roles?.get(targetUserId) || "member");
  }

  // Server mute a user (mod+ only, must outrank target)
  socket.on("mod:server-mute", (data: { channelId: string; targetUserId: string; muted: boolean }) => {
    const ctx = getModRole(data.channelId);
    if (!ctx || ctx.callerRole < 2) return; // need mod+
    if (ctx.callerRole <= getTargetRole(ctx.serverId, data.targetUserId)) return; // can't mod equal/higher

    const key = `${ctx.serverId}:${data.targetUserId}`;
    if (data.muted) serverMuted.add(key); else serverMuted.delete(key);

    // Force mute in voice room data
    const room = voiceRooms.get(data.channelId);
    if (room?.has(data.targetUserId)) {
      room.get(data.targetUserId)!.muted = data.muted;
      broadcastVoiceParticipants(data.channelId);
    }

    // Notify the target user
    const targetEntry = room?.get(data.targetUserId);
    if (targetEntry) {
      io.to(targetEntry.socketId).emit("mod:force-mute", { muted: data.muted, by: currentUsername });
    }
  });

  // Server deafen a user (mod+ only)
  socket.on("mod:server-deafen", (data: { channelId: string; targetUserId: string; deafened: boolean }) => {
    const ctx = getModRole(data.channelId);
    if (!ctx || ctx.callerRole < 2) return;
    if (ctx.callerRole <= getTargetRole(ctx.serverId, data.targetUserId)) return;

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

  // Kick user from voice (mod+ only)
  socket.on("mod:kick-voice", (data: { channelId: string; targetUserId: string }) => {
    const ctx = getModRole(data.channelId);
    if (!ctx || ctx.callerRole < 2) return;
    if (ctx.callerRole <= getTargetRole(ctx.serverId, data.targetUserId)) return;

    const room = voiceRooms.get(data.channelId);
    const targetEntry = room?.get(data.targetUserId);
    if (targetEntry) {
      // Notify target before removing
      io.to(targetEntry.socketId).emit("mod:kicked-from-voice", { channelId: data.channelId, by: currentUsername });
      // Remove from room
      room!.delete(data.targetUserId);
      userVoiceChannel.delete(data.targetUserId);
      // Notify others
      io.to(`voice:${data.channelId}`).emit("voice:user-left", {
        channelId: data.channelId,
        userId: data.targetUserId,
        socketId: targetEntry.socketId,
      });
      // Force target socket to leave voice room
      const targetSocket = io.sockets.sockets.get(targetEntry.socketId);
      if (targetSocket) targetSocket.leave(`voice:${data.channelId}`);
      broadcastVoiceParticipants(data.channelId);
    }
  });

  // Move user to another voice channel (mod+ only)
  socket.on("mod:move-user", (data: { fromChannelId: string; toChannelId: string; targetUserId: string }) => {
    const ctx = getModRole(data.fromChannelId);
    if (!ctx || ctx.callerRole < 2) return;
    if (ctx.callerRole <= getTargetRole(ctx.serverId, data.targetUserId)) return;

    const room = voiceRooms.get(data.fromChannelId);
    const targetEntry = room?.get(data.targetUserId);
    if (!targetEntry) return;

    // Remove from old channel
    room!.delete(data.targetUserId);
    const targetSocket = io.sockets.sockets.get(targetEntry.socketId);
    if (targetSocket) targetSocket.leave(`voice:${data.fromChannelId}`);
    io.to(`voice:${data.fromChannelId}`).emit("voice:user-left", {
      channelId: data.fromChannelId,
      userId: data.targetUserId,
      socketId: targetEntry.socketId,
    });
    broadcastVoiceParticipants(data.fromChannelId);

    // Add to new channel
    if (targetSocket) targetSocket.join(`voice:${data.toChannelId}`);
    if (!voiceRooms.has(data.toChannelId)) voiceRooms.set(data.toChannelId, new Map());
    voiceRooms.get(data.toChannelId)!.set(data.targetUserId, {
      username: targetEntry.username,
      socketId: targetEntry.socketId,
      muted: targetEntry.muted,
      deafened: targetEntry.deafened,
      camera: targetEntry.camera,
      avatar: targetEntry.avatar,
    });
    userVoiceChannel.set(data.targetUserId, data.toChannelId);
    voiceChannelServer.set(data.toChannelId, ctx.serverId);

    // Notify target to switch channels client-side
    if (targetSocket) {
      targetSocket.emit("mod:moved-to-channel", {
        fromChannelId: data.fromChannelId,
        toChannelId: data.toChannelId,
        by: currentUsername,
      });
    }

    // Notify new room
    io.to(`voice:${data.toChannelId}`).emit("voice:user-joined", {
      channelId: data.toChannelId,
      userId: data.targetUserId,
      username: targetEntry.username,
      socketId: targetEntry.socketId,
    });
    broadcastVoiceParticipants(data.toChannelId);
  });

  // WebRTC signaling: relay offer to a specific peer
  socket.on("voice:offer", (data: { to: string; offer: RTCSessionDescriptionInit }) => {
    io.to(data.to).emit("voice:offer", {
      from: socket.id,
      fromUserId: currentUserId,
      fromUsername: currentUsername,
      offer: data.offer,
    });
  });

  // WebRTC signaling: relay answer to a specific peer
  socket.on("voice:answer", (data: { to: string; answer: RTCSessionDescriptionInit }) => {
    io.to(data.to).emit("voice:answer", {
      from: socket.id,
      answer: data.answer,
    });
  });

  // WebRTC signaling: relay ICE candidate to a specific peer
  socket.on("voice:ice-candidate", (data: { to: string; candidate: RTCIceCandidateInit }) => {
    io.to(data.to).emit("voice:ice-candidate", {
      from: socket.id,
      candidate: data.candidate,
    });
  });

  function leaveVoiceChannel(channelId: string) {
    socket.leave(`voice:${channelId}`);
    const room = voiceRooms.get(channelId);
    if (!room) return;
    const entry = room.get(currentUserId);
    if (entry && entry.socketId === socket.id) {
      room.delete(currentUserId);
      if (userVoiceChannel.get(currentUserId) === channelId) {
        userVoiceChannel.delete(currentUserId);
      }
      socket.to(`voice:${channelId}`).emit("voice:user-left", {
        channelId,
        userId: currentUserId,
        socketId: socket.id,
      });
      if (room.size === 0) {
        voiceRooms.delete(channelId);
      }
      broadcastVoiceParticipants(channelId);
    }
  }

  function broadcastVoiceParticipants(channelId: string) {
    const room = voiceRooms.get(channelId);
    const participants = room
      ? Array.from(room.entries()).map(([userId, info]) => ({
          userId,
          username: info.username,
          muted: info.muted,
          deafened: info.deafened,
          camera: info.camera,
          avatar: info.avatar,
        }))
      : [];
    const payload = { channelId, participants };
    // Emit to voice room members
    io.to(`voice:${channelId}`).emit("voice:participants-update", payload);
    // Emit to the server room so ALL server members see voice indicators in sidebar
    const serverId = voiceChannelServer.get(channelId);
    if (serverId) {
      io.to(`server:${serverId}`).emit("voice:participants-update", payload);
    }
  }

  // ─── Disconnect ───

  socket.on("disconnect", () => {
    console.log(`[Campfire] Disconnected: ${currentUsername}`);
    heartbeats.delete(socket.id);
    userVoiceChannel.delete(currentUserId);
    userStatus.delete(currentUserId);
    // Remove from all voice rooms
    for (const [channelId] of voiceRooms) {
      leaveVoiceChannel(channelId);
    }
    // Remove from all server presence maps
    for (const [serverId] of onlineUsers) {
      removeFromPresence(serverId, currentUserId);
    }
  });

  function removeFromPresence(serverId: string, userId: string) {
    const serverMap = onlineUsers.get(serverId);
    if (!serverMap) return;
    const entry = serverMap.get(userId);
    if (entry && entry.socketId === socket.id) {
      serverMap.delete(userId);
      broadcastPresence(serverId);
    }
    if (serverMap.size === 0) {
      onlineUsers.delete(serverId);
    }
  }

  function broadcastPresence(serverId: string) {
    const serverMap = onlineUsers.get(serverId);
    if (!serverMap) return;
    const members = Array.from(serverMap.entries()).map(
      ([userId, info]) => ({
        userId,
        username: info.username,
        status: userStatus.get(userId) || "online",
      })
    );
    io.to(`server:${serverId}`).emit("presence:update", { serverId, members });
  }
});

httpServer.listen(PORT, () => {
  console.log(`[Campfire] Realtime server running on port ${PORT}`);
});

export { io };
