import { Session } from '../models/Session';

class SessionRegistry {
  private sessions: Map<string, Session> = new Map();
  private userToSocket: Map<string, string> = new Map();

  register(session: Session): void {
    this.sessions.set(session.socketId, session);
    // Only index a real userId. New sockets register with an empty userId
    // (populated later via identify()); seeding '' would collide across sockets.
    if (session.userId) {
      this.userToSocket.set(session.userId, session.socketId);
    }
  }

  /**
   * Associate a connected socket with a real user identity. Must be called
   * when the client identifies itself; otherwise getByUserId() (used by
   * WebRTC signaling to route offers/answers/ICE) can never resolve the user.
   */
  identify(socketId: string, userId: string, username: string): void {
    const session = this.sessions.get(socketId);
    if (!session) return;
    // Drop any stale reverse-mapping for this socket's previous identity.
    if (session.userId && session.userId !== userId) {
      if (this.userToSocket.get(session.userId) === socketId) {
        this.userToSocket.delete(session.userId);
      }
    }
    session.userId = userId;
    session.username = username;
    if (userId) {
      this.userToSocket.set(userId, socketId);
    }
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
