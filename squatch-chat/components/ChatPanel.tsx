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

interface ReplySnippet {
  id: string;
  content: string;
  author: { id: string; username: string };
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
  replyTo?: ReplySnippet | null;
  pending?: boolean;
}

interface ChatPanelProps {
  channelId: string;
  channelName: string;
  currentUserId: string;
  currentUsername: string;
  currentAvatar?: string | null;
}

export default function ChatPanel({
  channelId,
  channelName,
  currentUserId,
  currentUsername,
  currentAvatar,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [typingUsers, setTypingUsers] = useState<Map<string, string>>(new Map());
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [firstUnreadId, setFirstUnreadId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const prevChannelRef = useRef<string | null>(null);
  const lastReadIdRef = useRef<string | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  let pendingIdCounter = useRef(0);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const scrollToMessage = useCallback((messageId: string) => {
    const el = messageRefs.current.get(messageId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-1", "ring-[var(--accent-2)]", "rounded");
      setTimeout(() => el.classList.remove("ring-1", "ring-[var(--accent-2)]", "rounded"), 1500);
    }
  }, []);

  function playMessageNotification() {
    try {
      const saved = localStorage.getItem("campfire-audio-settings");
      if (saved) {
        const s = JSON.parse(saved);
        if (s.messageNotifications === false) return;
      }
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.25);
      setTimeout(() => ctx.close(), 400);
    } catch {
      // Audio not supported
    }
  }

  // Load message history
  useEffect(() => {
    setLoading(true);
    setMessages([]);
    setTypingUsers(new Map());
    setReplyingTo(null);
    setFirstUnreadId(null);
    lastReadIdRef.current = null;

    fetch(`/api/messages?channelId=${channelId}`)
      .then((res) => res.json())
      .then((data) => {
        const msgs: Message[] = data.messages || [];
        setMessages(msgs);
        lastReadIdRef.current = msgs.length > 0 ? msgs[msgs.length - 1].id : null;
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
      // Mark first incoming message as the unread boundary (only for others' messages)
      if (message.author.id !== currentUserId) {
        setFirstUnreadId((prev) => prev ?? message.id);
      }
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
      // Notify when tab is in the background and message is from someone else
      if (message.author.id !== currentUserId && document.hidden) {
        playMessageNotification();
      }
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
    setFirstUnreadId(null);

    // Stop typing
    isTypingRef.current = false;
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    const socket = getSocket();
    socket.emit("typing:stop", channelId);

    // Capture and clear reply state before async work
    const replyTarget = replyingTo;
    setReplyingTo(null);

    // Optimistic: show message immediately
    const tempId = `pending-${Date.now()}-${pendingIdCounter.current++}`;
    const optimisticMsg: Message = {
      id: tempId,
      content,
      createdAt: new Date().toISOString(),
      author: { id: currentUserId, username: currentUsername, avatar: currentAvatar },
      replyTo: replyTarget ? { id: replyTarget.id, content: replyTarget.content, author: { id: replyTarget.author.id, username: replyTarget.author.username } } : null,
      pending: true,
    };
    setMessages((prev) => [...prev, optimisticMsg]);
    setTimeout(scrollToBottom, 50);

    const res = await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelId, content, ...(replyTarget ? { replyToId: replyTarget.id } : {}) }),
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

  const typingNames = Array.from(typingUsers.values()).map((name) => truncateName(name));
  const typingLabel =
    typingNames.length === 1
      ? `${typingNames[0]} is typing`
      : typingNames.length === 2
        ? `${typingNames[0]} and ${typingNames[1]} are typing`
        : typingNames.length > 2
          ? `${typingNames[0]} and ${typingNames.length - 1} others are typing`
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
            <div
              key={msg.id}
              ref={(el) => { if (el) messageRefs.current.set(msg.id, el); else messageRefs.current.delete(msg.id); }}
            >
              {firstUnreadId === msg.id && (
                <div className="flex items-center gap-2 my-2 px-1">
                  <div className="flex-1 h-px bg-red-500/60" />
                  <span className="text-[10px] font-bold text-red-400 uppercase tracking-widest px-1">New</span>
                  <div className="flex-1 h-px bg-red-500/60" />
                </div>
              )}
              <MessageBubble
                message={msg}
                isOwn={msg.author.id === currentUserId}
                currentUserId={currentUserId}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onReact={handleReact}
                onReply={setReplyingTo}
                onScrollToMessage={scrollToMessage}
              />
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="h-6 px-4 shrink-0 flex items-center">
        {typingLabel && (
          <span className="flex items-center gap-1.5 text-xs text-[var(--muted)] italic">
            {typingLabel}
            <span className="flex items-end gap-0.5 not-italic" aria-hidden>
              <span className="w-1 h-1 rounded-full bg-current animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-1 h-1 rounded-full bg-current animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-1 h-1 rounded-full bg-current animate-bounce" style={{ animationDelay: "300ms" }} />
            </span>
          </span>
        )}
      </div>

      {replyingTo && (
        <div className="mx-4 mb-0 px-3 py-1.5 bg-[var(--panel)] border border-b-0 border-[var(--accent-2)]/30 rounded-t-lg flex items-center gap-2 text-xs text-[var(--muted)]">
          <span className="shrink-0">↩ Replying to</span>
          <span className="font-medium text-[var(--accent-2)]">{replyingTo.author.username}</span>
          <span className="truncate flex-1 text-[var(--muted)]">
            {replyingTo.content ? replyingTo.content.slice(0, 60) + (replyingTo.content.length > 60 ? "…" : "") : "attachment"}
          </span>
          <button
            type="button"
            onClick={() => setReplyingTo(null)}
            className="shrink-0 text-[var(--muted)] hover:text-[var(--danger)] transition-colors ml-1"
          >
            ✕
          </button>
        </div>
      )}

      <form onSubmit={handleSend} className={`px-4 pb-4 shrink-0 ${replyingTo ? "pt-0" : "pt-1"}`}>
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
