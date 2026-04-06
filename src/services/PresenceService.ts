import { Server as SocketServer } from 'socket.io';

export interface MemberState {
  userId: string;
  socketId: string;
  username: string;
  muted: boolean;
  deafened: boolean;
  speaking: boolean;
  streaming: boolean;
  video: boolean;
  joinedAt: number;
  lastHeartbeat: number;
}

export interface RoomPresence {
  roomId: string;
  members: Map<string, MemberState>;
}

class PresenceService {
  private rooms: Map<string, RoomPresence> = new Map();
  private socketToUser: Map<string, { userId: string; roomId: string }> = new Map();
  private io: SocketServer | null = null;

  setIO(io: SocketServer): void {
    this.io = io;
  }

  private ensureRoom(roomId: string): RoomPresence {
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, { roomId, members: new Map() });
    }
    return this.rooms.get(roomId)!;
  }

  joinRoom(roomId: string, memberState: MemberState): void {
    const presence = this.ensureRoom(roomId);
    presence.members.set(memberState.userId, memberState);
    this.socketToUser.set(memberState.socketId, { userId: memberState.userId, roomId });
  }

  leaveRoom(roomId: string, userId: string): MemberState | undefined {
    const presence = this.rooms.get(roomId);
    if (!presence) return undefined;
    const member = presence.members.get(userId);
    if (!member) return undefined;
    presence.members.delete(userId);
    this.socketToUser.delete(member.socketId);
    if (presence.members.size === 0) {
      this.rooms.delete(roomId);
    }
    return member;
  }

  updateMemberState(
    roomId: string,
    userId: string,
    patch: Partial<MemberState>
  ): MemberState | undefined {
    const presence = this.rooms.get(roomId);
    if (!presence) return undefined;
    const member = presence.members.get(userId);
    if (!member) return undefined;
    const updated = { ...member, ...patch };
    presence.members.set(userId, updated);
    return updated;
  }

  getRoomPresence(roomId: string): MemberState[] {
    const presence = this.rooms.get(roomId);
    if (!presence) return [];
    return Array.from(presence.members.values());
  }

  heartbeat(socketId: string): void {
    const info = this.socketToUser.get(socketId);
    if (!info) return;
    const presence = this.rooms.get(info.roomId);
    if (!presence) return;
    const member = presence.members.get(info.userId);
    if (!member) return;
    member.lastHeartbeat = Date.now();
  }

  getUserRoom(userId: string): string | null {
    for (const [roomId, presence] of this.rooms.entries()) {
      if (presence.members.has(userId)) {
        return roomId;
      }
    }
    return null;
  }

  startCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      const threshold = 30_000;

      for (const [roomId, presence] of this.rooms.entries()) {
        const stale: MemberState[] = [];
        for (const member of presence.members.values()) {
          if (now - member.lastHeartbeat > threshold) {
            stale.push(member);
          }
        }
        for (const member of stale) {
          presence.members.delete(member.userId);
          this.socketToUser.delete(member.socketId);
          if (this.io) {
            this.io.to(`room:${roomId}`).emit('presence:member-left', {
              userId: member.userId,
              roomId,
            });
          }
        }
        if (presence.members.size === 0) {
          this.rooms.delete(roomId);
        }
      }
    }, 15_000);
  }
}

export const presenceService = new PresenceService();
