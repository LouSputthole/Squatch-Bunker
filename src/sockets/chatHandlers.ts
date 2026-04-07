import { Socket, Server as SocketServer } from 'socket.io';
import { chatService } from '../services/ChatService';
import { sessionRegistry } from '../services/SessionRegistry';

export function registerChatHandlers(io: SocketServer, socket: Socket): void {
  // chat:send — client sends a message to the room they're currently in
  socket.on('chat:send', (payload: { roomId: string; content: string }) => {
    const { roomId, content } = payload;
    if (!roomId || !content || typeof content !== 'string') return;

    const trimmed = content.trim().slice(0, 2000);
    if (!trimmed) return;

    const session = sessionRegistry.get(socket.id);
    if (!session?.userId || !session?.username) return;

    // Only allow messaging in the room the user is actually present in
    if (session.currentRoomId !== roomId) return;

    const msg = chatService.addMessage(roomId, session.userId, session.username, trimmed);
    io.to(`room:${roomId}`).emit('chat:message', msg);
  });
}
