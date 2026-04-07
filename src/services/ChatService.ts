import { randomUUID } from 'crypto';
import { ChatMessage } from '../models/Message';

const MAX_HISTORY = 100;

class ChatService {
  private messages: Map<string, ChatMessage[]> = new Map();

  addMessage(
    roomId: string,
    userId: string,
    username: string,
    content: string
  ): ChatMessage {
    const msg: ChatMessage = {
      id: randomUUID(),
      roomId,
      userId,
      username,
      content,
      timestamp: Date.now(),
    };

    if (!this.messages.has(roomId)) {
      this.messages.set(roomId, []);
    }
    const list = this.messages.get(roomId)!;
    list.push(msg);
    // Keep only the most recent MAX_HISTORY messages
    if (list.length > MAX_HISTORY) {
      list.splice(0, list.length - MAX_HISTORY);
    }
    return msg;
  }

  getHistory(roomId: string): ChatMessage[] {
    return this.messages.get(roomId) ?? [];
  }
}

export const chatService = new ChatService();
