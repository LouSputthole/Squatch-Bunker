import { createServer } from "http";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { parse } from "cookie";

const PORT = parseInt(process.env.SOCKET_PORT || "3001", 10);
const CLIENT_ORIGIN = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const JWT_SECRET = process.env.JWT_SECRET || "campfire-secret-change-me";
const COOKIE_NAME = "squatch-token";

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: {
    origin: CLIENT_ORIGIN,
    credentials: true,
  },
  path: "/api/socketio",
});

// Track online users per server: serverId -> Map<userId, {username, socketId}>
const onlineUsers = new Map<string, Map<string, { username: string; socketId: string }>>();

// Track voice channel participants: channelId -> Map<userId, {username, socketId, muted, deafened}>
const voiceRooms = new Map<string, Map<string, { username: string; socketId: string; muted: boolean; deafened: boolean }>>();

// Track which server each voice channel belongs to: channelId -> serverId
const voiceChannelServer = new Map<string, string>();

// Track which voice channel each user is in: userId -> channelId (enforce single room)
const userVoiceChannel = new Map<string, string>();

// Presence statuses: userId -> status
type PresenceStatus = "online" | "idle" | "dnd" | "invisible";
const userStatus = new Map<string, PresenceStatus>();

// Heartbeat tracking: socketId -> last heartbeat timestamp
const heartbeats = new Map<string, number>();
const HEARTBEAT_INTERVAL = 15000; // 15s
const HEARTBEAT_TIMEOUT = 45000; // 45s — 3 missed beats

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
  socket.on("server:join", (serverId: string) => {
    socket.join(`server:${serverId}`);

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
  socket.on("voice:join", (data: string | { channelId: string; serverId?: string }) => {
    // Support both old format (just channelId string) and new format ({channelId, serverId})
    const channelId = typeof data === "string" ? data : data.channelId;
    const serverId = typeof data === "string" ? undefined : data.serverId;

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
      ([userId, info]) => ({ userId, username: info.username, socketId: info.socketId, muted: info.muted, deafened: info.deafened })
    );
    socket.emit("voice:participants", { channelId, participants: existing });

    // Add the new user
    voiceRooms.get(channelId)!.set(currentUserId, {
      username: currentUsername,
      socketId: socket.id,
      muted: false,
      deafened: false,
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

  // Speaking indicator — relay to voice room
  socket.on("voice:speaking", (data: { channelId: string; speaking: boolean }) => {
    socket.to(`voice:${data.channelId}`).emit("voice:speaking", {
      userId: currentUserId,
      speaking: data.speaking,
    });
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
