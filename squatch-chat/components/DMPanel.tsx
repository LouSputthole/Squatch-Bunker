"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Avatar from "@/components/Avatar";
import { displayName, truncateName } from "@/lib/utils";
import { getSocket } from "@/lib/socket";
import { toast, toastResponseError } from "@/lib/toast";

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
  conversationId?: string;
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
  /** Conversation to open once the list loads (e.g. from an inbox notification). */
  initialConversationId?: string | null;
  onClose: () => void;
}

export default function DMPanel({ currentUserId, initialConversationId, onClose }: DMPanelProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<DMMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState(false);
  const [msgLoading, setMsgLoading] = useState(false);
  const [msgError, setMsgError] = useState(false);
  const [sending, setSending] = useState(false);
  const [typingUser, setTypingUser] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards against a slow response for a conversation the user already left.
  const activeConvIdRef = useRef<string | null>(null);

  const loadMessages = useCallback(async (convId: string) => {
    setMsgLoading(true);
    setMsgError(false);
    try {
      const res = await fetch(`/api/dm/${convId}`);
      if (activeConvIdRef.current !== convId) return;
      if (!res.ok) {
        setMsgError(true);
        return;
      }
      const data = await res.json();
      if (activeConvIdRef.current !== convId) return;
      setMessages(data.messages || []);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    } catch {
      if (activeConvIdRef.current === convId) setMsgError(true);
    } finally {
      if (activeConvIdRef.current === convId) setMsgLoading(false);
    }
  }, []);

  const openConversation = useCallback((conversation: Conversation | null) => {
    activeConvIdRef.current = conversation?.id ?? null;
    setActiveConv(conversation);
    setMessages([]);
    setMsgError(false);
    setTypingUser(null);
    if (conversation) void loadMessages(conversation.id);
  }, [loadMessages]);

  const loadConversations = useCallback(async (openId?: string | null) => {
    setLoading(true);
    setListError(false);
    try {
      const res = await fetch("/api/dm");
      if (!res.ok) {
        setListError(true);
        return;
      }
      const data = await res.json();
      const list: Conversation[] = data.conversations || [];
      setConversations(list);
      const target = openId ? list.find((c) => c.id === openId) : undefined;
      if (target) openConversation(target);
    } catch {
      setListError(true);
    } finally {
      setLoading(false);
    }
  }, [openConversation]);

  // Fetch conversation list once. The parent remounts this panel (key) when
  // the target conversation changes.
  useEffect(() => {
    const timer = setTimeout(() => { void loadConversations(initialConversationId); }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Join the conversation room and receive messages/typing in realtime.
  useEffect(() => {
    if (!activeConv) return;
    const conversationId = activeConv.id;
    const socket = getSocket();
    socket.emit("dm:join", conversationId);

    // Room membership is lost when the socket reconnects — rejoin.
    function handleConnect() {
      socket.emit("dm:join", conversationId);
    }

    function handleTyping(data: { conversationId: string; username: string; userId: string }) {
      if (data.conversationId !== conversationId) return;
      if (data.userId === currentUserId) return;
      setTypingUser(data.username);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => setTypingUser(null), 3000);
    }

    function handleMessage(message: DMMessage) {
      if (message.conversationId && message.conversationId !== conversationId) return;
      setMessages((previous) => {
        if (previous.some((item) => item.id === message.id)) return previous;
        return [...previous, message];
      });
      setConversations((previous) => previous
        .map((conversation) => conversation.id === conversationId
          ? {
              ...conversation,
              lastMessage: {
                content: message.content,
                createdAt: message.createdAt,
                authorId: message.authorId,
              },
              updatedAt: message.createdAt,
            }
          : conversation)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }

    socket.on("connect", handleConnect);
    socket.on("dm:typing", handleTyping);
    socket.on("dm:message", handleMessage);
    return () => {
      socket.off("connect", handleConnect);
      socket.off("dm:typing", handleTyping);
      socket.off("dm:message", handleMessage);
      socket.emit("dm:leave", conversationId);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, [activeConv, currentUserId]);

  async function sendMessage() {
    if (!input.trim() || !activeConv || sending) return;
    const conversationId = activeConv.id;
    const content = input;
    setInput("");
    setSending(true);

    try {
      const res = await fetch(`/api/dm/${conversationId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        // Give the text back so nothing typed is lost (e.g. 403 when blocked).
        setInput((current) => (current ? current : content));
        await toastResponseError(res, "Message failed to send");
        return;
      }
      const data = await res.json();
      getSocket().emit("dm:send", { conversationId, messageId: data.message.id });
      if (activeConvIdRef.current === conversationId) {
        setMessages((prev) => (prev.some((m) => m.id === data.message.id) ? prev : [...prev, data.message]));
      }
      const now = new Date().toISOString();
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conversationId
            ? { ...c, lastMessage: { content, createdAt: now, authorId: currentUserId }, updatedAt: now }
            : c
        ).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      );
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch {
      setInput((current) => (current ? current : content));
      toast("Message failed to send — check your connection", "error");
    } finally {
      setSending(false);
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
              <button
                onClick={() => openConversation(null)}
                aria-label="Back to conversations"
                title="Back to conversations"
                className="text-[var(--muted)] hover:text-[var(--text)]"
              >
                &larr;
              </button>
              <Avatar username={activeConv.otherUser.username} avatarUrl={activeConv.otherUser.avatar} size={24} />
              {displayName(activeConv.otherUser.username)}
            </span>
          ) : (
            "Direct Messages"
          )}
        </span>
        <button onClick={onClose} aria-label="Close direct messages" className="text-[var(--muted)] hover:text-[var(--text)] text-xs">Close</button>
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
          ) : listError ? (
            <div className="flex flex-col items-center justify-center gap-2 p-8 text-center text-sm text-[var(--muted)]">
              <p>Couldn&apos;t load your conversations.</p>
              <button
                onClick={() => void loadConversations()}
                className="rounded-lg bg-[var(--accent-2)]/30 px-3 py-1.5 text-xs text-[var(--text)] hover:bg-[var(--accent-2)]/50"
              >
                Try again
              </button>
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
                onClick={() => openConversation(c)}
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
            {msgError && messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-[var(--muted)]">
                <p>Couldn&apos;t load this conversation.</p>
                <button
                  onClick={() => void loadMessages(activeConv.id)}
                  className="rounded-lg bg-[var(--accent-2)]/30 px-3 py-1.5 text-xs text-[var(--text)] hover:bg-[var(--accent-2)]/50"
                >
                  Try again
                </button>
              </div>
            ) : msgLoading && messages.length === 0 ? (
              <div className="flex items-center justify-center h-full text-[var(--muted)] text-sm">Loading…</div>
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
                        className={`inline-block whitespace-pre-wrap break-words px-3 py-1.5 rounded-2xl text-sm text-left ${
                          isSelf
                            ? "bg-[var(--accent-2)]/35 text-[var(--text)] rounded-br-sm"
                            : "bg-[var(--panel)] text-[var(--text)] rounded-bl-sm"
                        }`}
                      >
                        {m.content}
                      </div>
                      {m.attachmentUrl && (
                        <a href={m.attachmentUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-[var(--accent)] hover:underline block mt-0.5">
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
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void sendMessage();
                  }
                }}
                aria-label={`Message ${displayName(activeConv.otherUser.username)}`}
                placeholder={`Message ${truncateName(activeConv.otherUser.username)}`}
                className="flex-1 bg-[var(--panel-2)] text-[var(--text)] text-sm px-3 py-2 rounded-lg border border-[var(--accent-2)]/30 focus:outline-none focus:border-[var(--accent)]/60"
              />
              <button
                onClick={() => void sendMessage()}
                disabled={!input.trim() || sending}
                className="px-3 py-2 bg-[var(--accent-2)]/40 text-[var(--text)] rounded-lg text-sm hover:bg-[var(--accent-2)]/60 disabled:opacity-30 transition-colors"
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
