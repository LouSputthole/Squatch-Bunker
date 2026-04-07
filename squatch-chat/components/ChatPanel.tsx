"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { getSocket } from "@/lib/socket";
import { truncateName } from "@/lib/utils";
import MessageBubble from "./MessageBubble";

interface ReactionGroup {
  count: number;
  users: string[];
  userIds: string[];
}

interface Message {
  id: string;
  channelId?: string;
  content: string;
  attachmentUrl?: string | null;
  attachmentName?: string | null;
  createdAt: string;
  updatedAt?: string;
  author: { id: string; username: string; avatar?: string | null };
  reactions?: Record<string, ReactionGroup>;
  pending?: boolean;
}

interface ChatPanelProps {
  channelId: string;
  channelName: string;
  channelTopic?: string | null;
  currentUserId: string;
  currentUsername: string;
  currentAvatar?: string | null;
  canEditTopic?: boolean;
}

export default function ChatPanel({
  channelId,
  channelName,
  channelTopic,
  currentUserId,
  currentUsername,
  currentAvatar,
  canEditTopic,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [typingUsers, setTypingUsers] = useState<Map<string, string>>(new Map());
  const [topic, setTopic] = useState(channelTopic ?? "");
  const [editingTopic, setEditingTopic] = useState(false);
  const [topicDraft, setTopicDraft] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevChannelRef = useRef<string | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  let pendingIdCounter = useRef(0);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Sync topic when channel changes
  useEffect(() => {
    setTopic(channelTopic ?? "");
    setEditingTopic(false);
  }, [channelId, channelTopic]);

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

    function handleReactionUpdate(data: { messageId: string; reactions: Record<string, ReactionGroup> }) {
      setMessages((prev) =>
        prev.map((m) => (m.id === data.messageId ? { ...m, reactions: data.reactions } : m))
      );
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
    socket.on(`message:reacted:${channelId}`, handleReactionUpdate);
    socket.on("typing:update", handleTyping);

    return () => {
      socket.off(`message:channel:${channelId}`, handleChannelMessage);
      socket.off(`message:edited:${channelId}`, handleMessageEdited);
      socket.off(`message:deleted:${channelId}`, handleMessageDeleted);
      socket.off(`message:reacted:${channelId}`, handleReactionUpdate);
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
      author: { id: currentUserId, username: currentUsername, avatar: currentAvatar },
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

  async function handleReact(messageId: string, emoji: string) {
    const res = await fetch(`/api/messages/${messageId}/reactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emoji }),
    });

    if (res.ok) {
      const { reactions } = await res.json();
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, reactions } : m))
      );
      // Broadcast reaction update
      const socket = getSocket();
      socket.emit("message:react", { channelId, messageId, reactions });
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

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (fileInputRef.current) fileInputRef.current.value = "";

    if (file.size > 10 * 1024 * 1024) {
      alert("File too large. Maximum size is 10MB.");
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
      if (!uploadRes.ok) {
        const data = await uploadRes.json();
        alert(data.error || "Upload failed");
        return;
      }
      const { url, name } = await uploadRes.json();

      // Create message with attachment
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId,
          content: "",
          attachmentUrl: url,
          attachmentName: name,
        }),
      });

      if (res.ok) {
        const { message } = await res.json();
        setMessages((prev) => [...prev, message]);
        setTimeout(scrollToBottom, 50);
        const socket = getSocket();
        socket.emit("message:send", { channelId, message });
      }
    } catch {
      alert("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  async function saveTopic() {
    const trimmed = topicDraft.trim();
    const res = await fetch(`/api/channels/${channelId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: trimmed }),
    });
    if (res.ok) {
      setTopic(trimmed);
    }
    setEditingTopic(false);
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
      <div className="px-4 flex items-center border-b border-[var(--accent-2)]/30 bg-[var(--panel-2)] shrink-0 min-h-12 py-1 gap-2 flex-wrap">
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[var(--accent-2)]">#</span>
          <h3 className="font-bold text-[var(--text)]">{channelName}</h3>
        </div>
        {topic && !editingTopic && (
          <>
            <span className="text-[var(--accent-2)]/50 shrink-0">|</span>
            <span className="text-xs text-[var(--muted)] truncate max-w-xs" title={topic}>{topic}</span>
          </>
        )}
        {editingTopic ? (
          <form
            className="flex items-center gap-1 flex-1 min-w-0"
            onSubmit={(e) => { e.preventDefault(); saveTopic(); }}
          >
            <input
              autoFocus
              type="text"
              value={topicDraft}
              onChange={(e) => setTopicDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") setEditingTopic(false); }}
              placeholder="Set a channel topic..."
              className="flex-1 min-w-0 text-xs px-2 py-1 bg-[var(--panel)] text-[var(--text)] border border-[var(--accent-2)] rounded focus:outline-none"
            />
            <button type="submit" className="text-xs px-2 py-1 bg-[var(--accent-2)] text-[var(--text)] rounded hover:bg-[var(--accent)] transition-colors shrink-0">Save</button>
            <button type="button" onClick={() => setEditingTopic(false)} className="text-xs text-[var(--muted)] hover:text-[var(--text)] shrink-0">Cancel</button>
          </form>
        ) : canEditTopic && (
          <button
            onClick={() => { setTopicDraft(topic); setEditingTopic(true); }}
            className="ml-auto text-[var(--muted)] hover:text-[var(--text)] shrink-0"
            title="Edit topic"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
        )}
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
              currentUserId={currentUserId}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onReact={handleReact}
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
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="px-3 py-3 text-[var(--muted)] hover:text-[var(--text)] transition-colors disabled:opacity-30"
            title="Upload file"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf,.txt,.zip"
            onChange={handleFileUpload}
            className="hidden"
          />
          <input
            type="text"
            value={newMessage}
            onChange={handleInputChange}
            placeholder={uploading ? "Uploading..." : `Message #${channelName}`}
            className="flex-1 px-2 py-3 bg-transparent text-[var(--text)] focus:outline-none placeholder:text-[var(--muted)]"
            disabled={uploading}
          />
          <button
            type="submit"
            disabled={!newMessage.trim() || uploading}
            className="px-4 py-3 text-[var(--accent-2)] hover:text-[var(--accent)] disabled:opacity-30 transition-colors"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
