export interface Session {
  socketId: string;
  userId: string;
  username: string;
  currentRoomId: string | null;
  connectedAt: number;
}
