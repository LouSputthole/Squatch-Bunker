"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { getSocket } from "@/lib/socket";
import MessageBubble from "./MessageBubble";

interface Message {
  id: string;
  channelId?: string;
  content: string;
  createdAt: string;
  author: { id: string; username: string };
}

interface ChatPanelProps {
  channelId: string;
  channelName: string;
  currentUserId: string;
}

export default function ChatPanel({
  channelId,
  channelName,
  currentUserId,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevChannelRef = useRef<string | null>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Load message history
  useEffect(() => {
    setLoading(true);
    setMessages([]);

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

    // Leave previous channel room
    if (prevChannelRef.current) {
      socket.emit("channel:leave", prevChannelRef.current);
    }

    // Join new channel room
    socket.emit("channel:join", channelId);
    prevChannelRef.current = channelId;

    function handleNewMessage(message: Message) {
      if (message.channelId === channelId) return; // handled below
      // Messages for other channels are ignored
    }

    function handleChannelMessage(message: Message) {
      setMessages((prev) => {
        if (prev.some((m) => m.id === message.id)) return prev;
        return [...prev, message];
      });
      setTimeout(scrollToBottom, 100);
    }

    socket.on("message:new", handleNewMessage);
    socket.on(`message:channel:${channelId}`, handleChannelMessage);

    return () => {
      socket.off("message:new", handleNewMessage);
      socket.off(`message:channel:${channelId}`, handleChannelMessage);
    };
  }, [channelId, scrollToBottom]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!newMessage.trim()) return;

    const content = newMessage.trim();
    setNewMessage("");

    const res = await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelId, content }),
    });

    if (res.ok) {
      const { message } = await res.json();
      setMessages((prev) => {
        if (prev.some((m) => m.id === message.id)) return prev;
        return [...prev, message];
      });
      setTimeout(scrollToBottom, 100);

      // Also emit to socket for other clients
      const socket = getSocket();
      socket.emit("message:send", { channelId, message });
    }
  }

  return (
    <div className="flex-1 flex flex-col bg-[var(--panel-2)]">
      {/* Channel header */}
      <div className="h-12 px-4 flex items-center border-b border-[var(--accent-2)]/30 bg-[var(--panel-2)]">
        <span className="text-[var(--accent-2)] mr-1">#</span>
        <h3 className="font-bold text-[var(--text)]">{channelName}</h3>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-2">
        {loading ? (
          <div className="flex items-center justify-center h-full text-[var(--muted)]">
            Loading tracks...
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[var(--muted)]">
            <div className="text-center">
              <p className="text-lg mb-1">No messages yet</p>
              <p className="text-sm">
                Be the first to howl in #{channelName}
              </p>
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              isOwn={msg.author.id === currentUserId}
            />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Message composer */}
      <form
        onSubmit={handleSend}
        className="px-4 pb-4 pt-2"
      >
        <div className="flex items-center bg-[var(--panel)] rounded-lg border border-[var(--accent-2)]/30">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
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
