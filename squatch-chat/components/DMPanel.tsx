"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Avatar from "@/components/Avatar";
import ImageLightbox from "@/components/ImageLightbox";
import { AttachmentPreview } from "@/components/MessageBubble";
import { VoiceNoteRecorder } from "@/components/VoiceNoteRecorder";
import { displayName, truncateName } from "@/lib/utils";
import { getSocket } from "@/lib/socket";
import { toast, toastResponseError } from "@/lib/toast";
import { checkUploadAllowed, UPLOAD_ACCEPT, uploadPrivateAttachment } from "@/lib/attachmentUpload";

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

interface LastMessage {
  content: string;
  attachmentName?: string | null;
  createdAt: string;
  authorId: string;
}

interface Conversation {
  id: string;
  otherUser: DMUser;
  lastMessage: LastMessage | null;
  /** The other participant's messages this user has not opened yet. */
  unreadCount?: number;
  updatedAt: string;
}

interface DMPanelProps {
  currentUserId: string;
  currentUsername: string;
  currentAvatar?: string | null;
  /** Conversation to open once the list loads (e.g. from an inbox notification). */
  initialConversationId?: string | null;
  /** Total unread DMs across conversations, reported whenever it changes. */
  onUnreadChange?: (total: number) => void;
  onClose: () => void;
}

function lastMessageOf(message: DMMessage): LastMessage {
  return {
    content: message.content,
    attachmentName: message.attachmentName ?? null,
    createdAt: message.createdAt,
    authorId: message.authorId,
  };
}

function byRecent(a: Conversation, b: Conversation) {
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

function previewText(message: LastMessage): string {
  if (message.content) return message.content;
  return message.attachmentName ? `📎 ${message.attachmentName}` : "📎 Attachment";
}

export default function DMPanel({ currentUserId, initialConversationId, onUnreadChange, onClose }: DMPanelProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<DMMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState(false);
  const [listLoaded, setListLoaded] = useState(false);
  const [msgLoading, setMsgLoading] = useState(false);
  const [msgError, setMsgError] = useState(false);
  const [sending, setSending] = useState(false);
  const [typingUser, setTypingUser] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const uploading = uploadProgress > 0;
  const [isDragging, setIsDragging] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markReadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards against a slow response for a conversation the user already left.
  const activeConvIdRef = useRef<string | null>(null);
  const onUnreadChangeRef = useRef(onUnreadChange);
  const conversationsRef = useRef<Conversation[]>([]);

  useEffect(() => {
    onUnreadChangeRef.current = onUnreadChange;
  });
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  const totalUnread = conversations.reduce((sum, c) => sum + (c.unreadCount ?? 0), 0);
  useEffect(() => {
    if (listLoaded) onUnreadChangeRef.current?.(totalUnread);
  }, [listLoaded, totalUnread]);

  /** Mark the other participant's messages read, server-side and in the list badge. */
  const markRead = useCallback((conversationId: string) => {
    setConversations((previous) => previous.map((conversation) =>
      conversation.id === conversationId && conversation.unreadCount
        ? { ...conversation, unreadCount: 0 }
        : conversation));
    void fetch(`/api/dm/${conversationId}/read`, { method: "POST" }).catch(() => {
      // Best effort: the badge comes back from the server on the next list load.
    });
  }, []);

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
      markRead(convId);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    } catch {
      if (activeConvIdRef.current === convId) setMsgError(true);
    } finally {
      if (activeConvIdRef.current === convId) setMsgLoading(false);
    }
  }, [markRead]);

  const openConversation = useCallback((conversation: Conversation | null) => {
    activeConvIdRef.current = conversation?.id ?? null;
    setActiveConv(conversation);
    setMessages([]);
    setMsgError(false);
    setTypingUser(null);
    if (conversation) void loadMessages(conversation.id);
  }, [loadMessages]);

  const loadConversations = useCallback(async (openId?: string | null, silent = false) => {
    if (!silent) {
      setLoading(true);
      setListError(false);
    }
    try {
      const res = await fetch("/api/dm");
      if (!res.ok) {
        if (!silent) setListError(true);
        return;
      }
      const data = await res.json();
      const list: Conversation[] = data.conversations || [];
      setConversations(list);
      setListLoaded(true);
      const target = openId ? list.find((c) => c.id === openId) : undefined;
      if (target) openConversation(target);
    } catch {
      if (!silent) setListError(true);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [openConversation]);

  // Fetch conversation list once. The parent remounts this panel (key) when
  // the target conversation changes.
  useEffect(() => {
    const timer = setTimeout(() => { void loadConversations(initialConversationId); }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // New DMs in conversations that are not open: bump their unread badge. The
  // open conversation is handled (deduped) by the per-conversation effect below.
  useEffect(() => {
    const socket = getSocket();
    function handleNotification(message: DMMessage) {
      if (!message.conversationId || message.authorId === currentUserId) return;
      if (message.conversationId === activeConvIdRef.current) return;
      if (!conversationsRef.current.some((conversation) => conversation.id === message.conversationId)) {
        // A brand-new conversation: pull the list so it shows up with its badge.
        void loadConversations(null, true);
        return;
      }
      setConversations((previous) => previous
        .map((conversation) => conversation.id === message.conversationId
          ? {
              ...conversation,
              lastMessage: lastMessageOf(message),
              unreadCount: (conversation.unreadCount ?? 0) + 1,
              updatedAt: message.createdAt,
            }
          : conversation)
        .sort(byRecent));
    }
    socket.on("dm:notification", handleNotification);
    return () => {
      socket.off("dm:notification", handleNotification);
    };
  }, [currentUserId, loadConversations]);

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

    // Also fed by the user-room `dm:notification`: right after opening or reconnecting,
    // dm:join may not have landed yet and that copy is the only one that arrives.
    function handleMessage(message: DMMessage) {
      if (message.conversationId && message.conversationId !== conversationId) return;
      setMessages((previous) => {
        if (previous.some((item) => item.id === message.id)) return previous;
        return [...previous, message];
      });
      setConversations((previous) => previous
        .map((conversation) => conversation.id === conversationId
          ? { ...conversation, lastMessage: lastMessageOf(message), updatedAt: message.createdAt }
          : conversation)
        .sort(byRecent));
      // The conversation is on screen: whatever just arrived has been seen.
      // Coalesce a burst of messages into one read request.
      if (message.authorId !== currentUserId && !markReadTimerRef.current) {
        markReadTimerRef.current = setTimeout(() => {
          markReadTimerRef.current = null;
          if (activeConvIdRef.current === conversationId) markRead(conversationId);
        }, 500);
      }
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }

    socket.on("connect", handleConnect);
    socket.on("dm:typing", handleTyping);
    socket.on("dm:message", handleMessage);
    socket.on("dm:notification", handleMessage);
    return () => {
      socket.off("connect", handleConnect);
      socket.off("dm:typing", handleTyping);
      socket.off("dm:message", handleMessage);
      socket.off("dm:notification", handleMessage);
      socket.emit("dm:leave", conversationId);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (markReadTimerRef.current) {
        clearTimeout(markReadTimerRef.current);
        markReadTimerRef.current = null;
      }
    };
  }, [activeConv, currentUserId, markRead]);

  /** Shared tail of every successful send: realtime fan-out + local list/thread update. */
  function afterSend(conversationId: string, message: DMMessage) {
    getSocket().emit("dm:send", { conversationId, messageId: message.id });
    if (activeConvIdRef.current === conversationId) {
      setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
    }
    setConversations((prev) =>
      prev.map((c) =>
        c.id === conversationId
          ? { ...c, lastMessage: lastMessageOf(message), updatedAt: message.createdAt }
          : c
      ).sort(byRecent)
    );
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }

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
      afterSend(conversationId, data.message);
    } catch {
      setInput((current) => (current ? current : content));
      toast("Message failed to send — check your connection", "error");
    } finally {
      setSending(false);
    }
  }

  /**
   * Upload a private attachment, then send it as its own DM. The DM route
   * claims the upload for this conversation (owner-bound, single use).
   * Throws a user-facing Error on failure.
   */
  async function deliverAttachment(conversationId: string, file: File) {
    setUploadProgress(1);
    try {
      const { attachmentId } = await uploadPrivateAttachment(file, (pct) => setUploadProgress(Math.max(1, pct)));
      const res = await fetch(`/api/dm/${conversationId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "", attachmentId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || "Attachment failed to send");
      }
      const data = await res.json();
      afterSend(conversationId, data.message);
    } finally {
      setUploadProgress(0);
    }
  }

  async function sendAttachment(file: File) {
    if (!activeConv || uploading) return;
    const conversationId = activeConv.id;
    if (!(await checkUploadAllowed(file))) return;
    try {
      await deliverAttachment(conversationId, file);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Attachment failed to send", "error");
    }
  }

  async function sendVoiceNote(file: File): Promise<void> {
    if (!activeConv) return;
    // The recorder shows a thrown error next to its preview.
    await deliverAttachment(activeConv.id, file);
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
                aria-label={totalUnread > 0 ? `Back to conversations (${totalUnread} unread)` : "Back to conversations"}
                title="Back to conversations"
                className="text-[var(--muted)] hover:text-[var(--text)]"
              >
                &larr;
              </button>
              <Avatar username={activeConv.otherUser.username} avatarUrl={activeConv.otherUser.avatar} size={24} />
              {displayName(activeConv.otherUser.username)}
              {totalUnread > 0 && (
                <span className="rounded-full bg-[var(--danger)] px-1.5 text-[10px] font-bold leading-4 text-white" title="Unread in other conversations">
                  {totalUnread > 99 ? "99+" : totalUnread}
                </span>
              )}
            </span>
          ) : (
            <span className="flex items-center gap-2">
              Direct Messages
              {totalUnread > 0 && (
                <span className="rounded-full bg-[var(--danger)] px-1.5 text-[10px] font-bold leading-4 text-white">
                  {totalUnread > 99 ? "99+" : totalUnread}
                  <span className="sr-only"> unread</span>
                </span>
              )}
            </span>
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
            conversations.map((c) => {
              const unread = c.unreadCount ?? 0;
              return (
                <button
                  key={c.id}
                  onClick={() => openConversation(c)}
                  aria-label={unread > 0 ? `${displayName(c.otherUser.username)}, ${unread} unread` : undefined}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--panel)]/50 transition-colors text-left"
                >
                  <Avatar username={c.otherUser.username} avatarUrl={c.otherUser.avatar} size={40} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className={`text-sm text-[var(--text)] truncate ${unread > 0 ? "font-bold" : "font-medium"}`}>{displayName(c.otherUser.username)}</span>
                      {c.lastMessage && (
                        <span className="text-[10px] text-[var(--muted)] shrink-0 ml-2">{formatTime(c.lastMessage.createdAt)}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {c.lastMessage && (
                        <p className={`flex-1 min-w-0 text-xs truncate ${unread > 0 ? "text-[var(--text)]" : "text-[var(--muted)]"}`}>
                          {c.lastMessage.authorId === currentUserId ? "You: " : ""}
                          {previewText(c.lastMessage)}
                        </p>
                      )}
                      {unread > 0 && (
                        <span className="ml-auto shrink-0 rounded-full bg-[var(--danger)] px-1.5 text-[10px] font-bold leading-4 text-white" aria-hidden="true">
                          {unread > 99 ? "99+" : unread}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      ) : (
        /* Message view */
        <div
          className="relative flex flex-1 min-h-0 flex-col"
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
            const files = e.dataTransfer.files;
            if (files.length > 1) {
              toast("Only one file can be uploaded at a time — sending the first one.", "info");
            }
            if (files[0]) void sendAttachment(files[0]);
          }}
        >
          {isDragging && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-[var(--accent)]/10 border-2 border-dashed border-[var(--accent)] rounded-lg pointer-events-none">
              <div className="text-center">
                <p className="text-lg font-bold text-[var(--accent)]">Drop to send</p>
                <p className="text-xs text-[var(--muted)] mt-1">Images (JPG, PNG, GIF, WebP), PDFs, text files and .zip archives</p>
              </div>
            </div>
          )}
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
                      {m.content && (
                        <div
                          className={`inline-block whitespace-pre-wrap break-words px-3 py-1.5 rounded-2xl text-sm text-left ${
                            isSelf
                              ? "bg-[var(--accent-2)]/35 text-[var(--text)] rounded-br-sm"
                              : "bg-[var(--panel)] text-[var(--text)] rounded-bl-sm"
                          }`}
                        >
                          {m.content}
                        </div>
                      )}
                      {m.attachmentUrl && (
                        <div className={`flex ${isSelf ? "justify-end" : ""}`}>
                          <AttachmentPreview
                            url={m.attachmentUrl}
                            name={m.attachmentName}
                            onOpenLightbox={setLightboxSrc}
                          />
                        </div>
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
            {uploading && (
              <div className="mb-2 h-1.5 bg-[var(--panel-2)] rounded-full overflow-hidden" role="progressbar" aria-label="Uploading attachment" aria-valuenow={uploadProgress} aria-valuemin={0} aria-valuemax={100}>
                <div
                  className="h-full bg-[var(--accent-2)] transition-all duration-100"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="px-1 py-2 text-[var(--muted)] hover:text-[var(--text)] transition-colors disabled:opacity-30"
                title="Attach a file"
                aria-label="Attach a file"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                </svg>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept={UPLOAD_ACCEPT}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void sendAttachment(file);
                }}
                className="hidden"
              />
              <VoiceNoteRecorder
                key={activeConv.id}
                disabled={uploading}
                onSend={sendVoiceNote}
              />
              <input
                type="text"
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  getSocket().emit("dm:typing", { conversationId: activeConv.id, userId: currentUserId });
                }}
                onPaste={(e) => {
                  // Pasted screenshot/file → upload. Anything carrying plain text pastes as text.
                  const file = e.clipboardData.files[0];
                  if (!file || e.clipboardData.getData("text/plain")) return;
                  e.preventDefault();
                  void sendAttachment(file);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void sendMessage();
                  }
                }}
                aria-label={`Message ${displayName(activeConv.otherUser.username)}`}
                placeholder={uploading ? "Uploading..." : `Message ${truncateName(activeConv.otherUser.username)}`}
                disabled={uploading}
                className="flex-1 min-w-0 bg-[var(--panel-2)] text-[var(--text)] text-sm px-3 py-2 rounded-lg border border-[var(--accent-2)]/30 focus:outline-none focus:border-[var(--accent)]/60"
              />
              <button
                onClick={() => void sendMessage()}
                disabled={!input.trim() || sending || uploading}
                className="px-3 py-2 bg-[var(--accent-2)]/40 text-[var(--text)] rounded-lg text-sm hover:bg-[var(--accent-2)]/60 disabled:opacity-30 transition-colors"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}

      {lightboxSrc && (
        <ImageLightbox
          src={lightboxSrc}
          allSrcs={[lightboxSrc]}
          onClose={() => setLightboxSrc(null)}
          onNavigate={setLightboxSrc}
        />
      )}
    </div>
  );
}
