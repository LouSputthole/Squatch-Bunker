import { v4 as uuidv4 } from 'uuid';

export interface ChatMessage {
  id: string;
  roomId: string;
  userId: string;
  username: string;
  content: string;
  timestamp: number;
}

const MAX_MESSAGES_PER_ROOM = 50;

class ChatService {
  private messages: Map<string, ChatMessage[]> = new Map();

  addMessage(
    roomId: string,
    userId: string,
    username: string,
    content: string
  ): ChatMessage {
    if (!this.messages.has(roomId)) {
      this.messages.set(roomId, []);
    }
    const msgs = this.messages.get(roomId)!;
    const message: ChatMessage = {
      id: uuidv4(),
      roomId,
      userId,
      username,
      content,
      timestamp: Date.now(),
    };
    msgs.push(message);
    if (msgs.length > MAX_MESSAGES_PER_ROOM) {
      msgs.shift();
    }
    return message;
  }

  getMessages(roomId: string): ChatMessage[] {
    return this.messages.get(roomId) ?? [];
  }

  clearRoom(roomId: string): void {
    this.messages.delete(roomId);
  }
}

export const chatService = new ChatService();
