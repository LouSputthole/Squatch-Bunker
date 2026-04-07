export interface Channel {
  id: string;
  name: string;
  type?: string;
  topic?: string | null;
}

export interface Server {
  id: string;
  name: string;
  channels: Channel[];
  _count: { members: number };
}

export interface User {
  id: string;
  username: string;
  email: string;
  avatar?: string | null;
}

export interface VoiceParticipant {
  userId: string;
  username: string;
  muted: boolean;
  deafened?: boolean;
  speaking?: boolean;
  avatar?: string | null;
}
