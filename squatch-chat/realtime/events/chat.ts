// Chat event types for Socket.IO

export interface MessageSendPayload {
  channelId: string;
  message: {
    id: string;
    content: string;
    createdAt: string;
    author: {
      id: string;
      username: string;
    };
  };
}

export interface ChannelJoinPayload {
  channelId: string;
}

// Event names
export const EVENTS = {
  CHANNEL_JOIN: "channel:join",
  CHANNEL_LEAVE: "channel:leave",
  MESSAGE_SEND: "message:send",
  MESSAGE_NEW: "message:new",
} as const;
