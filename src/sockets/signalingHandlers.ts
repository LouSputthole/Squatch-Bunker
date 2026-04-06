import { Socket } from 'socket.io';
import { sessionRegistry } from '../services/SessionRegistry';

// Use plain object types since this runs in Node.js (no DOM WebRTC globals)
type SdpPayload = { type: string; sdp?: string };
type IceCandidatePayload = Record<string, unknown>;

export function registerSignalingHandlers(socket: Socket): void {
  const getCallerUserId = (): string | null => {
    const session = sessionRegistry.get(socket.id);
    return session?.userId ?? null;
  };

  // signal:offer: { targetUserId, sdp, roomId }
  socket.on(
    'signal:offer',
    (payload: { targetUserId: string; sdp: SdpPayload; roomId: string }) => {
      const { targetUserId, sdp } = payload;
      const fromUserId = getCallerUserId();
      if (!fromUserId) return;

      const targetSession = sessionRegistry.getByUserId(targetUserId);
      if (!targetSession) return;

      socket.to(targetSession.socketId).emit('signal:offer', {
        fromUserId,
        sdp,
      });
    }
  );

  // signal:answer: { targetUserId, sdp, roomId }
  socket.on(
    'signal:answer',
    (payload: { targetUserId: string; sdp: SdpPayload; roomId: string }) => {
      const { targetUserId, sdp } = payload;
      const fromUserId = getCallerUserId();
      if (!fromUserId) return;

      const targetSession = sessionRegistry.getByUserId(targetUserId);
      if (!targetSession) return;

      socket.to(targetSession.socketId).emit('signal:answer', {
        fromUserId,
        sdp,
      });
    }
  );

  // signal:ice-candidate: { targetUserId, candidate, roomId }
  socket.on(
    'signal:ice-candidate',
    (payload: { targetUserId: string; candidate: IceCandidatePayload; roomId: string }) => {
      const { targetUserId, candidate } = payload;
      const fromUserId = getCallerUserId();
      if (!fromUserId) return;

      const targetSession = sessionRegistry.getByUserId(targetUserId);
      if (!targetSession) return;

      socket.to(targetSession.socketId).emit('signal:ice-candidate', {
        fromUserId,
        candidate,
      });
    }
  );
}
