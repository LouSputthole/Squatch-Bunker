import express from 'express';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import cors from 'cors';
import path from 'path';

import roomsRouter from './routes/rooms';
import usersRouter from './routes/users';
import { registerRoomHandlers } from './sockets/roomHandlers';
import { registerSignalingHandlers } from './sockets/signalingHandlers';
import { registerChatHandlers } from './sockets/chatHandlers';
import { presenceService } from './services/PresenceService';
import { sessionRegistry } from './services/SessionRegistry';

const app = express();
const httpServer = createServer(app);

const io = new SocketServer(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// Pass io to presence service so it can emit cleanup events
presenceService.setIO(io);

// Middleware
app.use(cors());
app.use(express.json());

// Serve client static files
app.use(express.static(path.join(__dirname, '..', 'client')));

// REST routes
app.use('/api/rooms', roomsRouter);
app.use('/api/users', usersRouter);

// Fallback: serve index.html for any non-API route
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
  }
});

// Socket.io connection handler
io.on('connection', (socket) => {
  console.log(`[socket] connected: ${socket.id}`);

  // Register session on connect (will be populated on join-room)
  sessionRegistry.register({
    socketId: socket.id,
    userId: '',
    username: '',
    currentRoomId: null,
    connectedAt: Date.now(),
  });

  // Update session with userId/username when first provided via join-room
  socket.on('identify', (payload: { userId: string; username: string }) => {
    const session = sessionRegistry.get(socket.id);
    if (session) {
      session.userId = payload.userId;
      session.username = payload.username;
    }
  });

  registerRoomHandlers(io, socket);
  registerSignalingHandlers(socket);
  registerChatHandlers(io, socket);

  socket.on('disconnect', () => {
    console.log(`[socket] disconnected: ${socket.id}`);
  });
});

// Start presence heartbeat cleanup
presenceService.startCleanup();

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
httpServer.listen(PORT, () => {
  console.log(`Squatch-Bunker server running on http://localhost:${PORT}`);
});

export { app, io };
