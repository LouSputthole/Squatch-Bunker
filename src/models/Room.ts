export type RoomType = 'voice' | 'stage' | 'private_voice';

export interface RoomPermissions {
  allowedRoles: string[]; // empty = everyone
  canSpeak: string[];     // empty = everyone
  canStream: string[];
  canVideo: string[];
}

export interface Room {
  id: string;
  serverId: string;
  name: string;
  type: RoomType;
  capacity: number; // 0 = unlimited
  permissions: RoomPermissions;
  createdAt: number;
}
