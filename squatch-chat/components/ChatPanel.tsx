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
  pinned?: boolean;
  parentMessageId?: string | null;
  replyCount?: number;
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
  channelTopic?: string | null;
  channelSlowMode?: number;
  currentUserId: string;
  currentUsername: string;
  currentAvatar?: string | null;
  canPin?: boolean;
  canEditTopic?: boolean;
}

export default function ChatPanel({
  channelId,
  channelName,
  channelTopic,
  channelSlowMode = 0,
  currentUserId,
  currentUsername,
  currentAvatar,
  canPin,
  canEditTopic,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [typingUsers, setTypingUsers] = useState<Map<string, string>>(new Map());
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [firstUnreadId, setFirstUnreadId] = useState<string | null>(null);
  const [showPinned, setShowPinned] = useState(false);
  const [threadParent, setThreadParent] = useState<{ id: string; author: { id: string; username: string } } | null>(null);
  const [threadMessages, setThreadMessages] = useState<Message[]>([]);
  const [threadInput, setThreadInput] = useState("");
  const [threadLoading, setThreadLoading] = useState(false);
  const [topic, setTopic] = useState(channelTopic ?? "");
  const [editingTopic, setEditingTopic] = useState(false);
  const [topicDraft, setTopicDraft] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const prevChannelRef = useRef<string | null>(null);
  const lastReadIdRef = useRef<string | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const userTypingTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [slowRemaining, setSlowRemaining] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);
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
      // Clear safety timeout for the user who just sent a message
      const safetyTimeout = userTypingTimeoutsRef.current.get(message.author.id);
      if (safetyTimeout) {
        clearTimeout(safetyTimeout);
        userTypingTimeoutsRef.current.delete(message.author.id);
      }
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
          // Clear any existing safety timeout for this user
          const existing = userTypingTimeoutsRef.current.get(data.userId);
          if (existing) clearTimeout(existing);
          // Set 4s safety timeout to remove user even if no isTyping:false arrives
          const safetyTimeout = setTimeout(() => {
            setTypingUsers((m) => {
              const updated = new Map(m);
              updated.delete(data.userId);
              return updated;
            });
            userTypingTimeoutsRef.current.delete(data.userId);
          }, 4000);
          userTypingTimeoutsRef.current.set(data.userId, safetyTimeout);
        } else {
          next.delete(data.userId);
          // Clear safety timeout when explicit stop arrives
          const existing = userTypingTimeoutsRef.current.get(data.userId);
          if (existing) {
            clearTimeout(existing);
            userTypingTimeoutsRef.current.delete(data.userId);
          }
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
    }, 3000);
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

      // Start slow mode countdown
      if (channelSlowMode > 0) {
        if (cooldownRef.current) clearInterval(cooldownRef.current);
        setSlowRemaining(channelSlowMode);
        cooldownRef.current = setInterval(() => {
          setSlowRemaining((prev) => {
            if (prev <= 1) {
              clearInterval(cooldownRef.current!);
              cooldownRef.current = null;
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      }
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

  async function handlePin(messageId: string, pinned: boolean) {
    const res = await fetch(`/api/messages/${messageId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned }),
    });
    if (res.ok) {
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, pinned } : m))
      );
    }
  }

  async function openThread(messageId: string, author: { id: string; username: string }) {
    setThreadParent({ id: messageId, author });
    setThreadLoading(true);
    const res = await fetch(`/api/messages?channelId=${channelId}&parentId=${messageId}`);
    if (res.ok) {
      const { messages: replies } = await res.json();
      setThreadMessages(replies || []);
    }
    setThreadLoading(false);
  }

  async function sendThreadMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!threadInput.trim() || !threadParent) return;
    const content = threadInput.trim();
    setThreadInput("");
    const res = await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelId, content, parentMessageId: threadParent.id }),
    });
    if (res.ok) {
      const { message } = await res.json();
      setThreadMessages((prev) => [...prev, message]);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === threadParent.id ? { ...m, replyCount: (m.replyCount ?? 0) + 1 } : m
        )
      );
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

  async function handleFileDrop(file: File) {
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
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId, content: "", attachmentUrl: url, attachmentName: name }),
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
  const typingLabel =
    typingNames.length === 1
      ? `${typingNames[0]} is typing...`
      : typingNames.length === 2
        ? `${typingNames[0]} and ${typingNames[1]} are typing...`
        : typingNames.length > 2
          ? "Several people are typing..."
          : null;

  return (
    <div
      className="flex-1 flex bg-[var(--panel-2)] min-w-0 relative"
      onDragEnter={(e) => {
        e.preventDefault();
        dragCounterRef.current++;
        if (e.dataTransfer.types.includes("Files")) setIsDragging(true);
      }}
      onDragOver={(e) => { e.preventDefault(); }}
      onDragLeave={() => {
        dragCounterRef.current--;
        if (dragCounterRef.current <= 0) { dragCounterRef.current = 0; setIsDragging(false); }
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragCounterRef.current = 0;
        setIsDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) handleFileDrop(file);
      }}
    >
      {/* Drop zone overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[var(--accent)]/10 border-2 border-dashed border-[var(--accent)] rounded pointer-events-none">
          <div className="text-center">
            <p className="text-lg font-semibold text-[var(--accent)]">Drop file to upload</p>
            <p className="text-sm text-[var(--muted)] mt-1">Supports images, PDF, TXT, ZIP (max 10MB)</p>
          </div>
        </div>
      )}

      {/* Main chat column */}
      <div className="flex-1 flex flex-col min-w-0">
      <div className="px-4 flex items-center border-b border-[var(--accent-2)]/30 bg-[var(--panel-2)] shrink-0 min-h-12 py-1 gap-2 flex-wrap justify-between">
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
            className="text-[var(--muted)] hover:text-[var(--text)] shrink-0"
            title="Edit topic"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
        )}
        {messages.some((m) => m.pinned) && (
          <button
            onClick={() => setShowPinned((p) => !p)}
            className={`text-xs px-2 py-1 rounded transition-colors ${showPinned ? "bg-yellow-500/20 text-yellow-400" : "text-[var(--muted)] hover:text-yellow-400"}`}
            title="Pinned messages"
          >
            📌 {messages.filter((m) => m.pinned).length}
          </button>
        )}
      </div>

      {/* Pinned messages panel */}
      {showPinned && (
        <div className="border-b border-[var(--accent-2)]/30 bg-[var(--panel)] max-h-48 overflow-y-auto">
          <div className="px-4 py-2 text-xs font-semibold text-yellow-400 uppercase tracking-wide">Pinned Messages</div>
          {messages.filter((m) => m.pinned).map((msg) => (
            <div key={msg.id} className="px-4 py-1.5 border-t border-[var(--accent-2)]/10 hover:bg-[var(--panel-2)]/50">
              <span className="text-xs font-medium text-[var(--accent-2)] mr-2">{msg.author.username}</span>
              <span className="text-xs text-[var(--text)] break-words">{msg.content || "[attachment]"}</span>
            </div>
          ))}
        </div>
      )}

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
          messages.filter((m) => !m.parentMessageId).map((msg) => (
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
                canPin={canPin}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onReact={handleReact}
                onReply={setReplyingTo}
                onScrollToMessage={scrollToMessage}
                onPin={handlePin}
                onThread={openThread}
              />
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="h-5 px-4 shrink-0 flex items-center transition-opacity duration-150" style={{ opacity: typingLabel ? 1 : 0 }}>
        {typingLabel && (
          <span className="flex items-center text-xs text-[var(--muted)] italic">
            {typingLabel}
            <span className="inline-flex gap-0.5 items-end ml-1" aria-hidden>
              <span className="w-1 h-1 rounded-full bg-[var(--muted)] animate-pulse" style={{ animationDelay: "0ms" }} />
              <span className="w-1 h-1 rounded-full bg-[var(--muted)] animate-pulse" style={{ animationDelay: "200ms" }} />
              <span className="w-1 h-1 rounded-full bg-[var(--muted)] animate-pulse" style={{ animationDelay: "400ms" }} />
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
            placeholder={uploading ? "Uploading..." : slowRemaining > 0 ? `Wait ${slowRemaining}s to send again` : `Message #${channelName}`}
            className="flex-1 px-2 py-3 bg-transparent text-[var(--text)] focus:outline-none placeholder:text-[var(--muted)]"
            disabled={uploading || slowRemaining > 0}
          />
          <button
            type="submit"
            disabled={!newMessage.trim() || uploading || slowRemaining > 0}
            className="px-4 py-3 text-[var(--accent-2)] hover:text-[var(--accent)] disabled:opacity-30 transition-colors"
          >
            Send
          </button>
        </div>
      </form>
      </div>{/* end main chat column */}

      {/* Thread panel */}
      {threadParent && (
        <div className="w-72 flex flex-col border-l border-[var(--accent-2)]/30 bg-[var(--panel)] shrink-0">
          <div className="h-12 px-3 flex items-center justify-between border-b border-[var(--accent-2)]/30 shrink-0">
            <span className="text-sm font-semibold text-[var(--text)]">Thread</span>
            <button onClick={() => setThreadParent(null)} className="text-[var(--muted)] hover:text-[var(--text)] text-lg leading-none">&times;</button>
          </div>
          <div className="px-3 py-2 border-b border-[var(--accent-2)]/10 text-xs text-[var(--muted)]">
            Reply to <span className="text-[var(--text)] font-medium">{threadParent.author.username}</span>
          </div>
          <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
            {threadLoading ? (
              <div className="text-xs text-[var(--muted)] italic px-1">Loading...</div>
            ) : threadMessages.length === 0 ? (
              <div className="text-xs text-[var(--muted)] italic px-1">No replies yet</div>
            ) : (
              threadMessages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  isOwn={msg.author.id === currentUserId}
                  currentUserId={currentUserId}
                  onEdit={handleEdit}
                  onDelete={(id) => {
                    handleDelete(id);
                    setThreadMessages((prev) => prev.filter((m) => m.id !== id));
                  }}
                  onReact={handleReact}
                />
              ))
            )}
          </div>
          <form onSubmit={sendThreadMessage} className="px-3 pb-3 pt-1 shrink-0">
            <div className="flex items-center bg-[var(--panel-2)] rounded-lg border border-[var(--accent-2)]/30">
              <input
                type="text"
                value={threadInput}
                onChange={(e) => setThreadInput(e.target.value)}
                placeholder="Reply in thread..."
                className="flex-1 px-2 py-2 bg-transparent text-[var(--text)] focus:outline-none placeholder:text-[var(--muted)] text-sm"
              />
              <button
                type="submit"
                disabled={!threadInput.trim()}
                className="px-3 py-2 text-[var(--accent-2)] hover:text-[var(--accent)] disabled:opacity-30 transition-colors text-sm"
              >
                Send
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
