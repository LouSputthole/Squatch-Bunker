import { Session } from '../models/Session';

class SessionRegistry {
  private sessions: Map<string, Session> = new Map();
  private userToSocket: Map<string, string> = new Map();

  register(session: Session): void {
    this.sessions.set(session.socketId, session);
    this.userToSocket.set(session.userId, session.socketId);
  }

  unregister(socketId: string): Session | undefined {
    const session = this.sessions.get(socketId);
    if (!session) return undefined;
    this.sessions.delete(socketId);
    if (this.userToSocket.get(session.userId) === socketId) {
      this.userToSocket.delete(session.userId);
    }
    return session;
  }

  get(socketId: string): Session | undefined {
    return this.sessions.get(socketId);
  }

  getByUserId(userId: string): Session | undefined {
    const socketId = this.userToSocket.get(userId);
    if (!socketId) return undefined;
    return this.sessions.get(socketId);
  }

  updateRoom(socketId: string, roomId: string | null): void {
    const session = this.sessions.get(socketId);
    if (session) {
      session.currentRoomId = roomId;
    }
  }
}

export const sessionRegistry = new SessionRegistry();
