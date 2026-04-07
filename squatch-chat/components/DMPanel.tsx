"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Avatar from "@/components/Avatar";
import { displayName, truncateName } from "@/lib/utils";
import { getSocket } from "@/lib/socket";

interface DMUser {
  id: string;
  username: string;
  avatar?: string | null;
}

interface DMMessage {
  id: string;
  content: string;
  authorId: string;
  author: DMUser;
  attachmentUrl?: string | null;
  attachmentName?: string | null;
  createdAt: string;
}

interface Conversation {
  id: string;
  otherUser: DMUser;
  lastMessage: { content: string; createdAt: string; authorId: string } | null;
  updatedAt: string;
}

interface DMPanelProps {
  currentUserId: string;
  currentUsername: string;
  currentAvatar?: string | null;
  onClose: () => void;
}

export default function DMPanel({ currentUserId, currentUsername, currentAvatar, onClose }: DMPanelProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<DMMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [msgLoading, setMsgLoading] = useState(false);
  const [typingUser, setTypingUser] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch conversation list
  useEffect(() => {
    fetch("/api/dm")
      .then((r) => r.json())
      .then((data) => setConversations(data.conversations || []))
      .finally(() => setLoading(false));
  }, []);

  // Fetch messages when conversation selected
  const loadMessages = useCallback(async (convId: string) => {
    setMsgLoading(true);
    const res = await fetch(`/api/dm/${convId}`);
    const data = await res.json();
    setMessages(data.messages || []);
    setMsgLoading(false);
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  }, []);

  useEffect(() => {
    if (!activeConv) return;
    loadMessages(activeConv.id);

    // Poll for new messages every 3s
    pollRef.current = setInterval(async () => {
      const res = await fetch(`/api/dm/${activeConv.id}`);
      const data = await res.json();
      if (data.messages) setMessages(data.messages);
    }, 3000);

    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [activeConv, loadMessages]);

  // Join conversation room and listen for typing events
  useEffect(() => {
    if (!activeConv) return;
    const socket = getSocket();
    socket.emit("dm:join", activeConv.id);

    function handleTyping(data: { conversationId: string; username: string; userId: string }) {
      if (data.conversationId !== activeConv!.id) return;
      if (data.userId === currentUserId) return;
      setTypingUser(data.username);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => setTypingUser(null), 3000);
    }

    socket.on("dm:typing", handleTyping);
    return () => {
      socket.off("dm:typing", handleTyping);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      setTypingUser(null);
    };
  }, [activeConv, currentUserId]);

  async function sendMessage() {
    if (!input.trim() || !activeConv) return;
    const content = input;
    setInput("");

    const res = await fetch(`/api/dm/${activeConv.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (res.ok) {
      const data = await res.json();
      setMessages((prev) => [...prev, data.message]);
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeConv.id
            ? { ...c, lastMessage: { content, createdAt: new Date().toISOString(), authorId: currentUserId }, updatedAt: new Date().toISOString() }
            : c
        ).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      );
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }

  function formatTime(iso: string) {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    if (diffMs < 86400000 && d.getDate() === now.getDate()) {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  }

  return (
    <div className="flex flex-col h-full bg-[var(--panel-2)]">
      {/* Header */}
      <div className="h-12 px-4 flex items-center border-b border-[var(--accent-2)]/30 bg-[var(--panel)] justify-between shrink-0">
        <span className="text-sm font-semibold text-[var(--text)]">
          {activeConv ? (
            <span className="flex items-center gap-2">
              <button onClick={() => setActiveConv(null)} className="text-[var(--muted)] hover:text-[var(--text)]">&larr;</button>
              <Avatar username={activeConv.otherUser.username} avatarUrl={activeConv.otherUser.avatar} size={24} />
              {displayName(activeConv.otherUser.username)}
            </span>
          ) : (
            "Direct Messages"
          )}
        </span>
        <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--text)] text-xs">Close</button>
      </div>

      {!activeConv ? (
        /* Conversation list */
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 p-2">
                  <div className="w-10 h-10 rounded-full bg-[var(--accent-2)]/30 animate-pulse shrink-0" />
                  <div className="flex-1 space-y-1">
                    <div className="h-3 w-24 bg-[var(--accent-2)]/30 animate-pulse rounded" />
                    <div className="h-2 w-40 bg-[var(--accent-2)]/20 animate-pulse rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-[var(--muted)] text-sm p-8 text-center">
              <div>
                <p className="text-base mb-2">No conversations yet</p>
                <p className="text-xs">Click a user&apos;s profile to start a DM</p>
              </div>
            </div>
          ) : (
            conversations.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveConv(c)}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--panel)]/50 transition-colors text-left"
              >
                <Avatar username={c.otherUser.username} avatarUrl={c.otherUser.avatar} size={40} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-[var(--text)] truncate">{displayName(c.otherUser.username)}</span>
                    {c.lastMessage && (
                      <span className="text-[10px] text-[var(--muted)] shrink-0 ml-2">{formatTime(c.lastMessage.createdAt)}</span>
                    )}
                  </div>
                  {c.lastMessage && (
                    <p className="text-xs text-[var(--muted)] truncate">
                      {c.lastMessage.authorId === currentUserId ? "You: " : ""}
                      {c.lastMessage.content}
                    </p>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      ) : (
        /* Message view */
        <>
          <div className="flex-1 overflow-y-auto px-4 py-2 space-y-1">
            {msgLoading && messages.length === 0 ? (
              <div className="flex items-center justify-center h-full text-[var(--muted)] text-sm">Loading...</div>
            ) : messages.length === 0 ? (
              <div className="flex items-center justify-center h-full text-[var(--muted)] text-sm">
                Start of your conversation with {displayName(activeConv.otherUser.username)}
              </div>
            ) : (
              messages.map((m) => {
                const isSelf = m.authorId === currentUserId;
                return (
                  <div key={m.id} className={`flex gap-2 ${isSelf ? "flex-row-reverse" : ""}`}>
                    <Avatar
                      username={m.author.username}
                      avatarUrl={m.author.avatar}
                      size={28}
                      className="shrink-0 mt-1"
                    />
                    <div className={`max-w-[70%] ${isSelf ? "text-right" : ""}`}>
                      <div
                        className={`inline-block px-3 py-1.5 rounded-2xl text-sm ${
                          isSelf
                            ? "bg-amber-600/30 text-[var(--text)] rounded-br-sm"
                            : "bg-[var(--panel)] text-[var(--text)] rounded-bl-sm"
                        }`}
                      >
                        {m.content}
                      </div>
                      {m.attachmentUrl && (
                        <a href={m.attachmentUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-amber-400 hover:underline block mt-0.5">
                          {m.attachmentName || "Attachment"}
                        </a>
                      )}
                      <div className="text-[10px] text-[var(--muted)] mt-0.5">
                        {formatTime(m.createdAt)}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Typing indicator */}
          {typingUser && (
            <div className="text-xs text-[var(--muted)] px-4 py-1 italic">
              {typingUser} is typing...
            </div>
          )}

          {/* Input */}
          <div className="p-3 border-t border-[var(--accent-2)]/30 bg-[var(--panel)]">
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  getSocket().emit("dm:typing", { conversationId: activeConv.id, userId: currentUserId });
                }}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                placeholder={`Message ${truncateName(activeConv.otherUser.username)}`}
                className="flex-1 bg-[var(--panel-2)] text-[var(--text)] text-sm px-3 py-2 rounded-lg border border-[var(--accent-2)]/30 focus:outline-none focus:border-amber-600/50"
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim()}
                className="px-3 py-2 bg-amber-600/30 text-amber-300 rounded-lg text-sm hover:bg-amber-600/40 disabled:opacity-30 transition-colors"
              >
                Send
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
