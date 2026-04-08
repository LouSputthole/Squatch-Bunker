import { Socket, Server as SocketServer } from 'socket.io';
import { presenceService } from '../services/PresenceService';
import { sessionRegistry } from '../services/SessionRegistry';
import { roomService } from '../services/RoomService';
import { chatService } from '../services/ChatService';

export function registerRoomHandlers(io: SocketServer, socket: Socket): void {
  // join-room: { roomId, userId, username }
  socket.on(
    'join-room',
    (payload: { roomId: string; userId: string; username: string }) => {
      const { roomId, userId, username } = payload;

      if (!roomId || !userId || !username) return;

      // Verify room exists
      const room = roomService.getRoom(roomId);
      if (!room) {
        socket.emit('error', { message: 'Room not found' });
        return;
      }

      // Check if user is already in a room — if so, auto-leave first
      const existingRoomId = presenceService.getUserRoom(userId);
      if (existingRoomId && existingRoomId !== roomId) {
        presenceService.leaveRoom(existingRoomId, userId);
        socket.leave(`room:${existingRoomId}`);
        sessionRegistry.updateRoom(socket.id, null);
        io.to(`room:${existingRoomId}`).emit('presence:member-left', {
          userId,
          roomId: existingRoomId,
        });
      } else if (existingRoomId === roomId) {
        // Already in this room, just refresh state
        const members = presenceService.getRoomPresence(roomId);
        socket.emit('room:state', { roomId, members });
        return;
      }

      const now = Date.now();
      const memberState = {
        userId,
        socketId: socket.id,
        username,
        muted: false,
        deafened: false,
        speaking: false,
        streaming: false,
        video: false,
        joinedAt: now,
        lastHeartbeat: now,
      };

      presenceService.joinRoom(roomId, memberState);
      sessionRegistry.updateRoom(socket.id, roomId);
      socket.join(`room:${roomId}`);

      // Tell everyone else in the room about the new member
      socket.to(`room:${roomId}`).emit('presence:member-joined', {
        roomId,
        member: memberState,
      });

      // Send current room state back to the joining socket
      const members = presenceService.getRoomPresence(roomId);
      socket.emit('room:state', { roomId, members });

      // Broadcast updated member list to all clients for sidebar presence
      io.to('lobby').emit('lobby:room-update', { roomId, members });

      // Send chat history to the joining user
      const history = chatService.getHistory(roomId);
      if (history.length > 0) {
        socket.emit('chat:history', { roomId, messages: history });
      }
    }
  );

  // leave-room: { roomId }
  socket.on('leave-room', (payload: { roomId: string }) => {
    const { roomId } = payload;
    if (!roomId) return;

    const session = sessionRegistry.get(socket.id);
    const userId = session?.userId;
    if (!userId) return;

    presenceService.leaveRoom(roomId, userId);
    socket.leave(`room:${roomId}`);
    sessionRegistry.updateRoom(socket.id, null);

    io.to(`room:${roomId}`).emit('presence:member-left', { userId, roomId });

    // Broadcast updated member list to all clients for sidebar presence
    const updatedMembers = presenceService.getRoomPresence(roomId);
    io.to('lobby').emit('lobby:room-update', { roomId, members: updatedMembers });
  });

  // heartbeat: { roomId }
  socket.on('heartbeat', (_payload: { roomId: string }) => {
    presenceService.heartbeat(socket.id);
  });

  // mute-toggle: { roomId, muted }
  socket.on('mute-toggle', (payload: { roomId: string; muted: boolean }) => {
    const { roomId, muted } = payload;
    if (!roomId) return;

    const session = sessionRegistry.get(socket.id);
    const userId = session?.userId;
    if (!userId) return;

    presenceService.updateMemberState(roomId, userId, { muted });
    io.to(`room:${roomId}`).emit('presence:state-update', {
      roomId,
      userId,
      muted,
    });
  });

  // deafen-toggle: { roomId, deafened }
  socket.on(
    'deafen-toggle',
    (payload: { roomId: string; deafened: boolean }) => {
      const { roomId, deafened } = payload;
      if (!roomId) return;

      const session = sessionRegistry.get(socket.id);
      const userId = session?.userId;
      if (!userId) return;

      presenceService.updateMemberState(roomId, userId, { deafened });
      io.to(`room:${roomId}`).emit('presence:state-update', {
        roomId,
        userId,
        deafened,
      });
    }
  );

  // speaking: { roomId, speaking }
  socket.on('speaking', (payload: { roomId: string; speaking: boolean }) => {
    const { roomId, speaking } = payload;
    if (!roomId) return;

    const session = sessionRegistry.get(socket.id);
    const userId = session?.userId;
    if (!userId) return;

    const presence = presenceService.getRoomPresence(roomId);
    const current = presence.find(m => m.userId === userId);
    // Throttle: only broadcast if speaking state changed
    if (current && current.speaking === speaking) return;

    presenceService.updateMemberState(roomId, userId, { speaking });
    io.to(`room:${roomId}`).emit('presence:state-update', {
      roomId,
      userId,
      speaking,
    });
  });

  // Built-in disconnect event
  socket.on('disconnect', () => {
    const session = sessionRegistry.unregister(socket.id);
    if (!session) return;

    const { userId, currentRoomId } = session;
    if (currentRoomId) {
      presenceService.leaveRoom(currentRoomId, userId);
      io.to(`room:${currentRoomId}`).emit('presence:member-left', {
        userId,
        roomId: currentRoomId,
      });
      // Broadcast updated member list to all clients for sidebar presence
      const updatedMembers = presenceService.getRoomPresence(currentRoomId);
      io.to('lobby').emit('lobby:room-update', { roomId: currentRoomId, members: updatedMembers });
    }
  });
}
