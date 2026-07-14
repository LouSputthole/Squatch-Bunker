export interface Channel {
  id: string;
  name: string;
  type?: string;
  topic?: string | null;
  roomMode?: string;
  roomScene?: string;
  retentionDays?: number | null;
}

export interface Server {
  id: string;
  name: string;
  icon?: string | null;
  banner?: string | null;
  inviteCode?: string;
  inviteExpiresAt?: string | null;
  inviteMaxUses?: number | null;
  inviteUseCount?: number;
  inviteRevokedAt?: string | null;
  channels: Channel[];
  _count: { members: number };
}

export interface User {
  id: string;
  username: string;
  email: string;
  avatar?: string | null;
  statusMessage?: string | null;
}

export interface VoiceParticipant {
  userId: string;
  username: string;
  muted: boolean;
  deafened?: boolean;
  speaking?: boolean;
  camera?: boolean;
  avatar?: string | null;
}
