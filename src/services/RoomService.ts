import { v4 as uuidv4 } from 'uuid';
import { Room, RoomType, RoomPermissions } from '../models/Room';

const defaultPermissions = (): RoomPermissions => ({
  allowedRoles: [],
  canSpeak: [],
  canStream: [],
  canVideo: [],
});

class RoomService {
  private rooms: Map<string, Room> = new Map();

  constructor() {
    this.initializeDefaults();
  }

  private initializeDefaults(): void {
    const defaultRooms: Array<{ name: string; type: RoomType }> = [
      { name: 'General', type: 'voice' },
      { name: 'Gaming', type: 'voice' },
      { name: 'Music', type: 'voice' },
    ];

    for (const def of defaultRooms) {
      const room: Room = {
        id: uuidv4(),
        serverId: 'default',
        name: def.name,
        type: def.type,
        capacity: 0,
        permissions: defaultPermissions(),
        createdAt: Date.now(),
      };
      this.rooms.set(room.id, room);
    }
  }

  createRoom(data: {
    name: string;
    serverId: string;
    type?: RoomType;
    capacity?: number;
    permissions?: Partial<RoomPermissions>;
  }): Room {
    const room: Room = {
      id: uuidv4(),
      serverId: data.serverId,
      name: data.name,
      type: data.type ?? 'voice',
      capacity: data.capacity ?? 0,
      permissions: {
        ...defaultPermissions(),
        ...(data.permissions ?? {}),
      },
      createdAt: Date.now(),
    };
    this.rooms.set(room.id, room);
    return room;
  }

  getRoom(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  getRoomsByServer(serverId: string): Room[] {
    return Array.from(this.rooms.values()).filter(r => r.serverId === serverId);
  }

  deleteRoom(id: string): boolean {
    return this.rooms.delete(id);
  }

  // Stub: always allow access
  checkPermission(_userId: string, _roomId: string, _permission: string): boolean {
    return true;
  }

  getAllRooms(): Room[] {
    return Array.from(this.rooms.values());
  }
}

export const roomService = new RoomService();
