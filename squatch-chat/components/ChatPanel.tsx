"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { getSocket } from "@/lib/socket";
import { truncateName } from "@/lib/utils";
import MessageBubble from "./MessageBubble";

interface Message {
  id: string;
  channelId?: string;
  content: string;
  createdAt: string;
  updatedAt?: string;
  author: { id: string; username: string };
  pending?: boolean;
}

interface ChatPanelProps {
  channelId: string;
  channelName: string;
  currentUserId: string;
  currentUsername: string;
}

export default function ChatPanel({
  channelId,
  channelName,
  currentUserId,
  currentUsername,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [typingUsers, setTypingUsers] = useState<Map<string, string>>(new Map());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevChannelRef = useRef<string | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  let pendingIdCounter = useRef(0);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Load message history
  useEffect(() => {
    setLoading(true);
    setMessages([]);
    setTypingUsers(new Map());

    fetch(`/api/messages?channelId=${channelId}`)
      .then((res) => res.json())
      .then((data) => {
        setMessages(data.messages || []);
        setLoading(false);
        setTimeout(scrollToBottom, 100);
      })
      .catch(() => setLoading(false));
  }, [channelId, scrollToBottom]);

  // Socket.IO realtime
  useEffect(() => {
    const socket = getSocket();

    if (prevChannelRef.current) {
      socket.emit("channel:leave", prevChannelRef.current);
    }

    socket.emit("channel:join", channelId);
    prevChannelRef.current = channelId;

    function handleChannelMessage(message: Message) {
      setMessages((prev) => {
        if (prev.some((m) => m.id === message.id)) return prev;
        return [...prev, message];
      });
      setTypingUsers((prev) => {
        const next = new Map(prev);
        next.delete(message.author.id);
        return next;
      });
      setTimeout(scrollToBottom, 100);
    }

    function handleMessageEdited(data: { messageId: string; content: string; updatedAt: string }) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === data.messageId
            ? { ...m, content: data.content, updatedAt: data.updatedAt }
            : m
        )
      );
    }

    function handleMessageDeleted(data: { messageId: string }) {
      setMessages((prev) => prev.filter((m) => m.id !== data.messageId));
    }

    function handleTyping(data: {
      channelId: string;
      userId: string;
      username: string;
      isTyping: boolean;
    }) {
      if (data.channelId !== channelId) return;
      if (data.userId === currentUserId) return;

      setTypingUsers((prev) => {
        const next = new Map(prev);
        if (data.isTyping) {
          next.set(data.userId, data.username);
        } else {
          next.delete(data.userId);
        }
        return next;
      });
    }

    socket.on(`message:channel:${channelId}`, handleChannelMessage);
    socket.on(`message:edited:${channelId}`, handleMessageEdited);
    socket.on(`message:deleted:${channelId}`, handleMessageDeleted);
    socket.on("typing:update", handleTyping);

    return () => {
      socket.off(`message:channel:${channelId}`, handleChannelMessage);
      socket.off(`message:edited:${channelId}`, handleMessageEdited);
      socket.off(`message:deleted:${channelId}`, handleMessageDeleted);
      socket.off("typing:update", handleTyping);
    };
  }, [channelId, scrollToBottom, currentUserId]);

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setNewMessage(e.target.value);

    const socket = getSocket();
    if (!isTypingRef.current && e.target.value.length > 0) {
      isTypingRef.current = true;
      socket.emit("typing:start", channelId);
    }

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      isTypingRef.current = false;
      socket.emit("typing:stop", channelId);
    }, 2000);
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!newMessage.trim()) return;

    const content = newMessage.trim();
    setNewMessage("");

    // Stop typing
    isTypingRef.current = false;
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    const socket = getSocket();
    socket.emit("typing:stop", channelId);

    // Optimistic: show message immediately
    const tempId = `pending-${Date.now()}-${pendingIdCounter.current++}`;
    const optimisticMsg: Message = {
      id: tempId,
      content,
      createdAt: new Date().toISOString(),
      author: { id: currentUserId, username: currentUsername },
      pending: true,
    };
    setMessages((prev) => [...prev, optimisticMsg]);
    setTimeout(scrollToBottom, 50);

    const res = await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelId, content }),
    });

    if (res.ok) {
      const { message } = await res.json();
      // Replace optimistic with real message
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? message : m))
      );
      socket.emit("message:send", { channelId, message });
    } else {
      // Remove failed optimistic message
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
    }
  }

  async function handleEdit(messageId: string, newContent: string) {
    const res = await fetch(`/api/messages/${messageId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: newContent }),
    });

    if (res.ok) {
      const { message } = await res.json();
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? message : m))
      );
      // Broadcast edit
      const socket = getSocket();
      socket.emit("message:edit", {
        channelId,
        messageId,
        content: newContent,
        updatedAt: message.updatedAt,
      });
    }
  }

  async function handleDelete(messageId: string) {
    const res = await fetch(`/api/messages/${messageId}`, {
      method: "DELETE",
    });

    if (res.ok) {
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
      // Broadcast delete
      const socket = getSocket();
      socket.emit("message:delete", { channelId, messageId });
    }
  }

  const typingNames = Array.from(typingUsers.values()).map((name) => truncateName(name));
  const typingText =
    typingNames.length === 1
      ? `${typingNames[0]} is typing...`
      : typingNames.length === 2
        ? `${typingNames[0]} and ${typingNames[1]} are typing...`
        : typingNames.length > 2
          ? `${typingNames[0]} and ${typingNames.length - 1} others are typing...`
          : null;

  return (
    <div className="flex-1 flex flex-col bg-[var(--panel-2)]">
      <div className="h-12 px-4 flex items-center border-b border-[var(--accent-2)]/30 bg-[var(--panel-2)] shrink-0">
        <span className="text-[var(--accent-2)] mr-1">#</span>
        <h3 className="font-bold text-[var(--text)]">{channelName}</h3>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-2">
        {loading ? (
          <div className="flex items-center justify-center h-full text-[var(--muted)]">
            Loading tracks...
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[var(--muted)]">
            <div className="text-center">
              <p className="text-lg mb-1">No messages yet</p>
              <p className="text-sm">Be the first to howl in #{channelName}</p>
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              isOwn={msg.author.id === currentUserId}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="h-6 px-4 shrink-0">
        {typingText && (
          <span className="text-xs text-[var(--muted)] italic">{typingText}</span>
        )}
      </div>

      <form onSubmit={handleSend} className="px-4 pb-4 pt-1 shrink-0">
        <div className="flex items-center bg-[var(--panel)] rounded-lg border border-[var(--accent-2)]/30">
          <input
            type="text"
            value={newMessage}
            onChange={handleInputChange}
            placeholder={`Message #${channelName}`}
            className="flex-1 px-4 py-3 bg-transparent text-[var(--text)] focus:outline-none placeholder:text-[var(--muted)]"
          />
          <button
            type="submit"
            disabled={!newMessage.trim()}
            className="px-4 py-3 text-[var(--accent-2)] hover:text-[var(--accent)] disabled:opacity-30 transition-colors"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
