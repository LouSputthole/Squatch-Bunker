import { createServer } from "http";
import { Server } from "socket.io";
import { verifyToken } from "../lib/auth";
import { prisma } from "../lib/db";

const PORT = parseInt(process.env.SOCKET_PORT || "3001", 10);

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: {
    origin: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    credentials: true,
  },
  path: "/api/socketio",
});

// Auth middleware
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (token) {
    const payload = verifyToken(token);
    if (payload) {
      socket.data.userId = payload.userId;
      socket.data.username = payload.username;
      return next();
    }
  }
  // Allow anonymous connections for now (auth via cookie in API routes)
  socket.data.userId = "anonymous";
  socket.data.username = "anonymous";
  next();
});

io.on("connection", (socket) => {
  console.log(`[SquatchChat] Socket connected: ${socket.data.username}`);

  // Join a channel room
  socket.on("channel:join", (channelId: string) => {
    socket.join(`channel:${channelId}`);
    console.log(`[SquatchChat] ${socket.data.username} joined channel:${channelId}`);
  });

  // Leave a channel room
  socket.on("channel:leave", (channelId: string) => {
    socket.leave(`channel:${channelId}`);
  });

  // Handle message send - broadcast to room
  socket.on("message:send", async (data: { channelId: string; message: { id: string; content: string; createdAt: string; author: { id: string; username: string } } }) => {
    const { channelId, message } = data;

    // Broadcast to everyone in the channel room except sender
    socket.to(`channel:${channelId}`).emit(`message:channel:${channelId}`, message);
  });

  socket.on("disconnect", () => {
    console.log(`[SquatchChat] Socket disconnected: ${socket.data.username}`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`[SquatchChat] Realtime server running on port ${PORT}`);
});

export { io };
