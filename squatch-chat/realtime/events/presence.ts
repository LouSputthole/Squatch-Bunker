// Presence event types - reserved for future use

export interface UserPresence {
  userId: string;
  username: string;
  status: "online" | "idle" | "offline";
}

export const PRESENCE_EVENTS = {
  USER_ONLINE: "presence:online",
  USER_OFFLINE: "presence:offline",
} as const;
