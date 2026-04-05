import { createServer } from "http";
import { Server } from "socket.io";

const PORT = parseInt(process.env.SOCKET_PORT || "3001", 10);
const CLIENT_ORIGIN = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: {
    origin: CLIENT_ORIGIN,
    credentials: true,
  },
  path: "/api/socketio",
});

// Track online users per server: serverId -> Set<{userId, username, socketId}>
const onlineUsers = new Map<string, Map<string, { username: string; socketId: string }>>();

io.on("connection", (socket) => {
  let currentUserId = "anonymous";
  let currentUsername = "anonymous";

  // Client identifies itself after connecting
  socket.on("auth:identify", (data: { userId: string; username: string }) => {
    currentUserId = data.userId;
    currentUsername = data.username;
    console.log(`[SquatchChat] Identified: ${currentUsername}`);
  });

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

    // Broadcast updated presence to server room
    const members = Array.from(onlineUsers.get(serverId)!.entries()).map(
      ([userId, info]) => ({ userId, username: info.username })
    );
    io.to(`server:${serverId}`).emit("presence:update", { serverId, members });
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

  socket.on("disconnect", () => {
    console.log(`[SquatchChat] Disconnected: ${currentUsername}`);
    // Remove from all server presence maps
    for (const [serverId] of onlineUsers) {
      removeFromPresence(serverId, currentUserId);
    }
  });

  function removeFromPresence(serverId: string, userId: string) {
    const serverMap = onlineUsers.get(serverId);
    if (!serverMap) return;
    // Only remove if this socket owns the presence entry
    const entry = serverMap.get(userId);
    if (entry && entry.socketId === socket.id) {
      serverMap.delete(userId);
      const members = Array.from(serverMap.entries()).map(
        ([uid, info]) => ({ userId: uid, username: info.username })
      );
      io.to(`server:${serverId}`).emit("presence:update", { serverId, members });
    }
    if (serverMap.size === 0) {
      onlineUsers.delete(serverId);
    }
  }
});

httpServer.listen(PORT, () => {
  console.log(`[SquatchChat] Realtime server running on port ${PORT}`);
});

export { io };
