"use client";

import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from "react";
import { getSocket } from "@/lib/socket";
import { truncateName } from "@/lib/utils";
import { sounds } from "@/lib/sounds";
import { toast, toastResponseError } from "@/lib/toast";
import { checkUploadAllowed, UPLOAD_ACCEPT, uploadPrivateAttachment } from "@/lib/attachmentUpload";
import MessageBubble from "./MessageBubble";
import PinnedMessagesPanel from "./PinnedMessagesPanel";
import SavedMessagesPanel from "./SavedMessagesPanel";
import CampJournalPanel from "./CampJournalPanel";
import CreatePollModal from "./CreatePollModal";
import type { PollData } from "./PollCard";
import EmojiPicker from "./EmojiPicker";
import GifPicker from "./GifPicker";
import SlashCommandMenu, { SLASH_COMMANDS } from "./SlashCommandMenu";
import MentionAutocomplete, { filterMentionMembers } from "./MentionAutocomplete";
import { checkAutoMod } from "./AutoModSettings";
import { VoiceNoteRecorder } from "./VoiceNoteRecorder";
import PromptDialog, { type PromptDialogRequest } from "./PromptDialog";
import ChatIcon, { type ChatIconName } from "./ChatIcons";
import { useServerEmojis } from "@/hooks/useServerEmojis";
import type { CustomEmojiMap } from "@/lib/customEmoji";

// ── Formatting toolbar ────────────────────────────────────────────────────────

function wrapSelection(
  textarea: HTMLTextAreaElement,
  before: string,
  after: string,
  placeholder: string,
  setter: (val: string) => void
) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = textarea.value.slice(start, end) || placeholder;
  const newVal =
    textarea.value.slice(0, start) +
    before +
    selected +
    after +
    textarea.value.slice(end);
  setter(newVal);
  setTimeout(() => {
    textarea.focus();
    textarea.setSelectionRange(
      start + before.length,
      start + before.length + selected.length
    );
  }, 0);
}

interface FormattingToolbarProps {
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  onChange: (val: string) => void;
  onLink: () => void;
}

function FormattingToolbar({ inputRef, onChange, onLink }: FormattingToolbarProps) {
  const btn =
    "text-xs px-2 py-1 rounded hover:bg-[var(--accent-2)]/20 text-[var(--muted)] hover:text-[var(--text)] font-mono transition-colors";

  function applyBold() {
    if (!inputRef.current) return;
    wrapSelection(inputRef.current, "**", "**", "bold text", onChange);
  }
  function applyItalic() {
    if (!inputRef.current) return;
    wrapSelection(inputRef.current, "_", "_", "italic text", onChange);
  }
  function applyCode() {
    if (!inputRef.current) return;
    wrapSelection(inputRef.current, "`", "`", "code", onChange);
  }
  function applyBullet() {
    if (!inputRef.current) return;
    const textarea = inputRef.current;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    if (start === end) {
      const newVal =
        textarea.value.slice(0, start) + "• " + textarea.value.slice(end);
      onChange(newVal);
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(start + 2, start + 2);
      }, 0);
    } else {
      const before = textarea.value.slice(0, start);
      const selected = textarea.value.slice(start, end);
      const after = textarea.value.slice(end);
      const bulleted = selected
        .split("\n")
        .map((line) => "• " + line)
        .join("\n");
      onChange(before + bulleted + after);
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(start, start + bulleted.length);
      }, 0);
    }
  }

  return (
    <div className="border border-[var(--accent-2)]/30 rounded-t-lg bg-[var(--panel)] px-2 py-1 flex items-center gap-1">
      <button type="button" onClick={applyBold} className={btn} title="Bold (Ctrl+B)" aria-label="Bold">
        <strong>B</strong>
      </button>
      <button type="button" onClick={applyItalic} className={btn} title="Italic (Ctrl+I)" aria-label="Italic">
        <em>I</em>
      </button>
      <button type="button" onClick={applyCode} className={btn} title="Inline code" aria-label="Inline code">
        {"</>"}
      </button>
      <button type="button" onClick={onLink} className={btn} title="Link (select text, then Ctrl+K)" aria-label="Insert link">
        🔗
      </button>
      <button type="button" onClick={applyBullet} className={btn} title="Bullet list" aria-label="Bullet list">
        •
      </button>
    </div>
  );
}

// ── Header / welcome pieces ─────────────────────────────────────────────────

interface HeaderButtonProps {
  icon: ChatIconName;
  label: string;
  onClick: () => void;
  active?: boolean;
  badge?: number;
}

function HeaderButton({ icon, label, onClick, active = false, badge = 0 }: HeaderButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`relative flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
        active
          ? "bg-[var(--accent)]/15 text-[var(--accent)]"
          : "text-[var(--muted)] hover:bg-[var(--panel)] hover:text-[var(--text)]"
      }`}
    >
      <ChatIcon name={icon} size={18} />
      {badge > 0 && (
        <span
          aria-hidden="true"
          className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-[var(--accent)] px-1 text-center text-[9px] font-bold leading-4 text-[var(--bg)]"
        >
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  );
}

function ChannelWelcome({ channelName, topic }: { channelName: string; topic: string }) {
  return (
    <div className="px-4 pb-4 pt-10">
      <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--accent)]/15 text-[var(--accent)]">
        <ChatIcon name="hash" size={34} />
      </div>
      <h2 className="text-2xl font-bold text-[var(--text)]">Welcome to #{channelName}!</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">This is the start of the #{channelName} channel.</p>
      {topic && <p className="mt-1 text-sm text-[var(--text)] opacity-80">{topic}</p>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

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
  editedAt?: string | null;
  author: { id: string; username: string; avatar?: string | null };
  reactions?: Record<string, ReactionGroup>;
  replyTo?: ReplySnippet | null;
  poll?: PollData | null;
  pending?: boolean;
  isSystem?: boolean;
}

interface MessagePage {
  messages?: Message[];
  nextCursor?: string | null;
}

interface MemberInfo {
  id: string;
  username: string;
  avatar?: string | null;
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
  serverId?: string;
  blockedUserIds?: ReadonlySet<string>;
  /** Scroll to and highlight this message, loading older history if needed. */
  focusMessageId?: string | null;
  /** Called once a `focusMessageId` request was handled (found or given up). */
  onFocusHandled?: () => void;
  /** Ids removed by a bulk purge in this session — hidden from the list immediately. */
  purgedMessageIds?: readonly string[];
  /** Open a message in another channel (Saved / Camp Journal jump-to). */
  onJumpToMessage?: (channelId: string, messageId: string) => void;
}

type SidePanel = "pins" | "journal" | "saved";

const PAGE_SIZE = 50;
const MAX_JUMP_PAGES = 10;
const GROUP_WINDOW_MS = 5 * 60 * 1000;

function isPendingMessage(message: Message): boolean {
  return Boolean(message.pending) || message.id.startsWith("pending-");
}

function hasOlderPage(data: MessagePage, received: number): boolean {
  // New API: nextCursor null means "no older history". Fall back to page size.
  if (data.nextCursor !== undefined) return data.nextCursor !== null;
  return received >= PAGE_SIZE;
}

function mentionsUser(content: string, username: string): boolean {
  if (!content || !username) return false;
  const lower = content.toLowerCase();
  const token = `@${username.toLowerCase()}`;
  let index = lower.indexOf(token);
  while (index !== -1) {
    const next = lower[index + token.length];
    if (next === undefined || !/[\w#]/.test(next)) return true;
    index = lower.indexOf(token, index + 1);
  }
  return false;
}

function dayKey(iso: string): string {
  return new Date(iso).toDateString();
}

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString([], { year: "numeric", month: "long", day: "numeric" });
}

// Unsent composer text survives channel switches (ChatPanelContent remounts
// per channel) and reloads. Keyed per user so a shared browser never shows
// one account's draft to the next.
function loadDraft(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function saveDraft(key: string, text: string) {
  try {
    if (text.trim()) localStorage.setItem(key, text);
    else localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export default function ChatPanel(props: ChatPanelProps) {
  // Fetched here, outside the per-channel remount, so it loads once per server.
  const customEmojis = useServerEmojis(props.serverId);
  return <ChatPanelContent key={props.channelId} {...props} customEmojis={customEmojis} />;
}

function ChatPanelContent({
  channelId,
  channelName,
  channelTopic,
  channelSlowMode = 0,
  currentUserId,
  currentUsername,
  currentAvatar,
  canPin,
  canEditTopic,
  serverId,
  blockedUserIds,
  focusMessageId,
  onFocusHandled,
  purgedMessageIds,
  onJumpToMessage,
  customEmojis,
}: ChatPanelProps & { customEmojis: CustomEmojiMap }) {
  const topicBaseline = channelTopic ?? "";
  const [messages, setMessages] = useState<Message[]>([]);
  const [bookmarkedMessageIds, setBookmarkedMessageIds] = useState<Set<string>>(new Set());
  const draftKey = `squatch:draft:${currentUserId}:${channelId}`;
  const [newMessage, setNewMessage] = useState(() => loadDraft(draftKey));
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Map<string, string>>(new Map());
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [firstUnreadId, setFirstUnreadId] = useState<string | null>(null);
  const [sidePanel, setSidePanel] = useState<SidePanel | null>(null);
  const [showPollModal, setShowPollModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [promptRequest, setPromptRequest] = useState<PromptDialogRequest | null>(null);
  const [threadParent, setThreadParent] = useState<{ id: string; author: { id: string; username: string } } | null>(null);
  const [threadMessages, setThreadMessages] = useState<Message[]>([]);
  const [threadInput, setThreadInput] = useState("");
  const [threadLoading, setThreadLoading] = useState(false);
  const [topicState, setTopicState] = useState(() => ({
    source: topicBaseline,
    value: topicBaseline,
    editing: false,
  }));
  const activeTopicState = topicState.source === topicBaseline
    ? topicState
    : { source: topicBaseline, value: topicBaseline, editing: false };
  const topic = activeTopicState.value;
  const editingTopic = activeTopicState.editing;

  function setTopic(value: string) {
    setTopicState((current) => {
      const active = current.source === topicBaseline
        ? current
        : { source: topicBaseline, value: topicBaseline, editing: false };
      return { ...active, value };
    });
  }

  function setEditingTopic(editing: boolean) {
    setTopicState((current) => {
      const active = current.source === topicBaseline
        ? current
        : { source: topicBaseline, value: topicBaseline, editing: false };
      return { ...active, editing };
    });
  }
  const [topicDraft, setTopicDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const messagesRef = useRef<Message[]>([]);
  const threadMessagesRef = useRef<Message[]>([]);
  const threadParentIdRef = useRef<string | null>(null);
  const hasMoreRef = useRef(false);
  const loadingOlderRef = useRef(false);
  const nearBottomRef = useRef(true);
  const initialScrollPendingRef = useRef(false);
  const restoreScrollRef = useRef<number | null>(null);
  const pendingFocusRef = useRef<string | null>(null);
  const onFocusHandledRef = useRef(onFocusHandled);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const userTypingTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [uploadProgress, setUploadProgress] = useState(0);
  const uploading = uploadProgress > 0;
  const [isDragging, setIsDragging] = useState(false);
  const [slowRemaining, setSlowRemaining] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [showToolbar, setShowToolbar] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [translations, setTranslations] = useState<Map<string, string>>(new Map());
  const [members, setMembers] = useState<MemberInfo[]>([]);
  const dragCounterRef = useRef(0);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingIdCounter = useRef(0);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    threadMessagesRef.current = threadMessages;
  }, [threadMessages]);
  useEffect(() => {
    onFocusHandledRef.current = onFocusHandled;
  });

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  /** Scroll a rendered message into view; `highlight` replays the glow animation. */
  const scrollToMessage = useCallback((messageId: string, highlight = true) => {
    const el = messageRefs.current.get(messageId);
    if (!el) return false;
    el.scrollIntoView({ behavior: highlight ? "smooth" : "auto", block: highlight ? "center" : "nearest" });
    if (highlight) {
      el.classList.remove("animate-search-highlight");
      void el.offsetWidth; // restart the animation
      el.classList.add("animate-search-highlight");
      setTimeout(() => el.classList.remove("animate-search-highlight"), 2000);
    }
    return true;
  }, []);

  function updateHasMore(value: boolean) {
    hasMoreRef.current = value;
    setHasMore(value);
  }

  useEffect(() => {
    saveDraft(draftKey, newMessage);
  }, [draftKey, newMessage]);

  // Composer grows with its content up to ~8 lines.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 44), 200)}px`;
  }, [newMessage]);

  // Fetch server members for @mention autocomplete
  useEffect(() => {
    if (!serverId) return;
    fetch(`/api/servers/${serverId}/members`)
      .then((r) => r.json())
      .then((data) => {
        const list = (data.members || []).map((m: { id: string; username: string; avatar?: string | null }) => ({
          id: m.id,
          username: m.username,
          avatar: m.avatar,
        }));
        setMembers(list);
      })
      .catch(() => {});
  }, [serverId]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/bookmarks", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Failed to load bookmarks");
        return response.json();
      })
      .then((data: { bookmarks?: Array<{ messageId: string }> }) => {
        setBookmarkedMessageIds(
          new Set((data.bookmarks || []).map((bookmark) => bookmark.messageId)),
        );
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          console.error("[Campfire] Failed to load bookmarks", error);
        }
      });

    return () => controller.abort();
  }, []);

  // Load the newest page of history
  useEffect(() => {
    const controller = new AbortController();

    fetch(`/api/messages?channelId=${encodeURIComponent(channelId)}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load messages");
        return res.json();
      })
      .then((data: MessagePage) => {
        const page: Message[] = data.messages || [];
        const known = new Set(page.map((m) => m.id));
        // Keep anything that arrived over the socket (or was sent) while loading.
        setMessages((prev) => [...page, ...prev.filter((m) => !known.has(m.id))]);
        updateHasMore(hasOlderPage(data, page.length));
        setLoadError(false);
        setLoading(false);
        initialScrollPendingRef.current = true;
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setLoadError(true);
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [channelId, reloadKey]);

  // Scroll bookkeeping that must happen before paint: jump to the bottom after
  // the first page renders, and keep the viewport anchored when older pages
  // are prepended above it.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (initialScrollPendingRef.current && !loading) {
      initialScrollPendingRef.current = false;
      el.scrollTop = el.scrollHeight;
      nearBottomRef.current = true;
      // Late-loading images/embeds can grow the list — settle at the bottom again.
      const settle = setTimeout(() => {
        if (nearBottomRef.current) el.scrollTop = el.scrollHeight;
      }, 300);
      return () => clearTimeout(settle);
    }
    const restore = restoreScrollRef.current;
    if (restore !== null) {
      restoreScrollRef.current = null;
      el.scrollTop = el.scrollHeight - restore;
    }
  }, [messages, loading]);

  // A jump target that just got loaded: scroll to it once it is in the DOM.
  useEffect(() => {
    const target = pendingFocusRef.current;
    if (target && scrollToMessage(target)) pendingFocusRef.current = null;
  }, [messages, scrollToMessage]);

  const loadOlder = useCallback(async (): Promise<Message[] | null> => {
    if (loadingOlderRef.current || !hasMoreRef.current) return null;
    const oldest = messagesRef.current.find((m) => !isPendingMessage(m));
    if (!oldest) return null;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const res = await fetch(
        `/api/messages?channelId=${encodeURIComponent(channelId)}&cursor=${encodeURIComponent(oldest.id)}`,
      );
      if (!res.ok) {
        await toastResponseError(res, "Couldn't load older messages");
        return null;
      }
      const data = (await res.json()) as MessagePage;
      const older = data.messages || [];
      const more = hasOlderPage(data, older.length);
      hasMoreRef.current = more;
      setHasMore(more);
      const el = scrollRef.current;
      restoreScrollRef.current = el ? el.scrollHeight - el.scrollTop : null;
      setMessages((prev) => {
        const known = new Set(prev.map((m) => m.id));
        return [...older.filter((m) => !known.has(m.id)), ...prev];
      });
      return older;
    } catch {
      toast("Couldn't load older messages", "error");
      return null;
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [channelId]);

  /**
   * Scroll to a message, paging back through history until it is loaded.
   * Gives up (with a toast) after MAX_JUMP_PAGES pages or at the channel start.
   */
  const jumpToMessage = useCallback(async (messageId: string): Promise<boolean> => {
    if (messagesRef.current.some((m) => m.id === messageId)) {
      if (!scrollToMessage(messageId)) pendingFocusRef.current = messageId;
      return true;
    }
    let pages = 0;
    let waits = 0;
    while (pages < MAX_JUMP_PAGES && hasMoreRef.current) {
      if (loadingOlderRef.current) {
        // A scroll-triggered page is already in flight — let it land first.
        if (++waits > 50) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (messagesRef.current.some((m) => m.id === messageId)) break;
        continue;
      }
      const older = await loadOlder();
      if (older === null) break;
      pages += 1;
      if (older.some((m) => m.id === messageId)) {
        pendingFocusRef.current = messageId;
        return true;
      }
    }
    if (messagesRef.current.some((m) => m.id === messageId)) {
      if (!scrollToMessage(messageId)) pendingFocusRef.current = messageId;
      return true;
    }
    toast("Message is too old to jump to", "info");
    return false;
  }, [loadOlder, scrollToMessage]);

  // Jump requests from outside (search results, saved messages in another channel).
  useEffect(() => {
    if (!focusMessageId || loading) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void jumpToMessage(focusMessageId).finally(() => {
        if (!cancelled) onFocusHandledRef.current?.();
      });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [focusMessageId, loading, jumpToMessage]);

  function handleLogScroll() {
    const el = scrollRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
    if (el.scrollTop < 200 && hasMoreRef.current && !loadingOlderRef.current && !loading) {
      void loadOlder();
    }
  }

  // Socket.IO realtime
  useEffect(() => {
    const socket = getSocket();
    socket.emit("channel:join", channelId);

    function clearTypingFor(userId: string) {
      setTypingUsers((prev) => {
        if (!prev.has(userId)) return prev;
        const next = new Map(prev);
        next.delete(userId);
        return next;
      });
      // Clear safety timeout for the user who just sent a message
      const safetyTimeout = userTypingTimeoutsRef.current.get(userId);
      if (safetyTimeout) {
        clearTimeout(safetyTimeout);
        userTypingTimeoutsRef.current.delete(userId);
      }
    }

    function handleChannelMessage(message: Message) {
      clearTypingFor(message.author.id);

      // Thread replies: bump the parent's count and feed an open thread panel.
      if (message.parentMessageId) {
        const parentId = message.parentMessageId;
        if (threadMessagesRef.current.some((m) => m.id === message.id)) return;
        if (threadParentIdRef.current === parentId) {
          setThreadMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
        }
        setMessages((prev) =>
          prev.map((m) => (m.id === parentId ? { ...m, replyCount: (m.replyCount ?? 0) + 1 } : m)),
        );
        return;
      }

      // Mark first incoming message as the unread boundary (only for others' messages)
      if (message.author.id !== currentUserId) {
        setFirstUnreadId((prev) => prev ?? message.id);
      }
      setMessages((prev) => {
        if (prev.some((m) => m.id === message.id)) return prev;
        return [...prev, message];
      });
      // Don't yank someone reading history back down to the bottom.
      if (nearBottomRef.current) setTimeout(() => scrollToBottom(), 50);
      // Play sound when message is from someone else
      if (message.author.id !== currentUserId) {
        sounds.messageReceived();
      }
    }

    function handleMessageEdited(data: { messageId: string; content: string; updatedAt?: string; editedAt?: string | null }) {
      const editedAt = data.editedAt ?? data.updatedAt ?? new Date().toISOString();
      const patch = (m: Message) => (m.id === data.messageId ? { ...m, content: data.content, editedAt } : m);
      setMessages((prev) => prev.map(patch));
      setThreadMessages((prev) => prev.map(patch));
    }

    function handleMessageDeleted(data: { messageId?: string; messageIds?: string[] }) {
      const ids = new Set<string>(Array.isArray(data.messageIds) ? data.messageIds : []);
      if (data.messageId) ids.add(data.messageId);
      if (ids.size === 0) return;
      const removedReplies = threadMessagesRef.current.filter((m) => ids.has(m.id));
      setMessages((prev) =>
        prev
          .filter((m) => !ids.has(m.id))
          .map((m) => {
            const removed = removedReplies.filter((r) => r.parentMessageId === m.id).length;
            return removed > 0 ? { ...m, replyCount: Math.max(0, (m.replyCount ?? 0) - removed) } : m;
          }),
      );
      setThreadMessages((prev) => prev.filter((m) => !ids.has(m.id)));
      if (threadParentIdRef.current && ids.has(threadParentIdRef.current)) {
        threadParentIdRef.current = null;
        setThreadParent(null);
      }
    }

    function handleReactionUpdate(data: { messageId: string; reactions: Record<string, ReactionGroup> }) {
      const patch = (m: Message) => (m.id === data.messageId ? { ...m, reactions: data.reactions } : m);
      setMessages((prev) => prev.map(patch));
      setThreadMessages((prev) => prev.map(patch));
    }

    function handlePollUpdate(poll: PollData) {
      setMessages((current) =>
        current.map((message) => message.poll?.id === poll.id ? { ...message, poll } : message),
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
    socket.on(`poll:updated:${channelId}`, handlePollUpdate);
    socket.on("typing:update", handleTyping);

    return () => {
      socket.off(`message:channel:${channelId}`, handleChannelMessage);
      socket.off(`message:edited:${channelId}`, handleMessageEdited);
      socket.off(`message:deleted:${channelId}`, handleMessageDeleted);
      socket.off(`message:reacted:${channelId}`, handleReactionUpdate);
      socket.off(`poll:updated:${channelId}`, handlePollUpdate);
      socket.emit("channel:leave", channelId);
      socket.off("typing:update", handleTyping);
    };
  }, [channelId, scrollToBottom, currentUserId]);

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    setNewMessage(val);

    // Slash command detection
    if (val.startsWith("/") && !val.includes(" ")) {
      setSlashQuery(val.slice(1));
    } else {
      setSlashQuery(null);
    }

    // @mention detection
    const mentionMatch = val.match(/@(\w*)$/);
    if (mentionMatch) {
      setMentionQuery(mentionMatch[1]);
    } else {
      setMentionQuery(null);
    }

    const socket = getSocket();
    if (!isTypingRef.current && val.length > 0) {
      isTypingRef.current = true;
      socket.emit("typing:start", channelId);
    }

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      isTypingRef.current = false;
      socket.emit("typing:stop", channelId);
    }, 3000);
  }

  function requestLink() {
    const textarea = inputRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.slice(start, end) || "link text";
    setPromptRequest({
      title: "Insert link",
      label: "URL",
      defaultValue: "https://",
      confirmLabel: "Insert",
      onConfirm: (raw) => {
        const url = raw.trim();
        if (!/^(https?:\/\/\S+|mailto:\S+)$/i.test(url)) {
          toast("Links need to start with http://, https:// or mailto:", "error");
          return;
        }
        setPromptRequest(null);
        setNewMessage((current) => current.slice(0, start) + `[${selected}](${url})` + current.slice(end));
        setTimeout(() => {
          textarea.focus();
          textarea.setSelectionRange(start + 1, start + 1 + selected.length);
        }, 0);
      },
    });
  }

  async function handleTranslate(messageId: string, text: string) {
    if (translations.has(messageId)) {
      setTranslations((prev) => { const next = new Map(prev); next.delete(messageId); return next; });
      return;
    }
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, target: "en" }),
      });
      if (!res.ok) {
        await toastResponseError(res, "Translation failed");
        return;
      }
      const data = await res.json();
      if (typeof data.translatedText !== "string" || !data.translatedText) {
        toast("Translation failed", "error");
        return;
      }
      setTranslations((prev) => new Map(prev).set(messageId, data.translatedText));
    } catch {
      toast("Translation failed — check your connection", "error");
    }
  }

  async function handleBookmark(messageId: string, bookmarked: boolean): Promise<boolean> {
    try {
      const response = await fetch("/api/bookmarks", {
        method: bookmarked ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId }),
      });
      if (!response.ok) {
        await toastResponseError(response, "Could not update your saved messages");
        return false;
      }

      setBookmarkedMessageIds((current) => {
        const next = new Set(current);
        if (bookmarked) {
          next.add(messageId);
        } else {
          next.delete(messageId);
        }
        return next;
      });
      toast(bookmarked ? "Saved — find it under Saved in the channel header" : "Removed from Saved", "success");
      return true;
    } catch {
      toast("Could not update your saved messages", "error");
      return false;
    }
  }

  function handleJournal(messageId: string) {
    if (!serverId) return;
    setPromptRequest({
      title: "Save to Camp Journal",
      message: "Keep this message in your private Camp Journal. Add a note if you like.",
      mode: "textarea",
      label: "Note (optional)",
      placeholder: "Why this one matters…",
      allowEmpty: true,
      maxLength: 500,
      confirmLabel: "Save keepsake",
      onConfirm: async (note) => {
        try {
          const response = await fetch(`/api/servers/${serverId}/journal`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messageId, note: note.trim() }),
          });
          if (!response.ok) {
            await toastResponseError(response, "Could not save this keepsake");
            return;
          }
          setPromptRequest(null);
          toast("Saved to your Camp Journal", "success");
          setSidePanel("journal");
        } catch {
          toast("Could not save this keepsake", "error");
        }
      },
    });
  }

  function handlePollCreated(value: unknown) {
    const message = value as Message;
    if (!message?.id || !message.author) return;
    setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]);
    getSocket().emit("message:send", { channelId, message });
    setTimeout(() => scrollToBottom(), 50);
  }

  /** Jump-to from a side panel: same channel scrolls here, otherwise ask the page to switch. */
  function jumpFromPanel(sourceChannelId: string, messageId: string) {
    if (sourceChannelId === channelId) {
      setSidePanel(null);
      void jumpToMessage(messageId);
      return;
    }
    if (onJumpToMessage) {
      onJumpToMessage(sourceChannelId, messageId);
      return;
    }
    toast("Open that message's channel to jump to it.", "info");
  }

  function togglePanel(panel: SidePanel) {
    setSidePanel((current) => (current === panel ? null : panel));
  }

  function editLastOwnMessage(): boolean {
    const last = [...messagesRef.current]
      .reverse()
      .find((m) => m.author.id === currentUserId && !isPendingMessage(m) && !m.isSystem && !m.poll && !m.parentMessageId && m.content);
    if (!last) return false;
    setEditingId(last.id);
    setTimeout(() => scrollToMessage(last.id, false), 0);
    return true;
  }

  function handleEditingChange(messageId: string, editing: boolean) {
    setEditingId((current) => (editing ? messageId : current === messageId ? null : current));
    if (!editing) setTimeout(() => inputRef.current?.focus(), 0);
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!newMessage.trim()) return;

    let content = newMessage.trim();

    // Auto-mod check
    if (serverId) {
      const automod = checkAutoMod(serverId, content);
      if (automod.blocked) {
        toast(`Not sent — your Word Filter blocks "${automod.word}"`, "error");
        return;
      }
    }

    // Process slash commands
    if (content.startsWith("/")) {
      const spaceIdx = content.indexOf(" ");
      const cmdName = spaceIdx > 0 ? content.slice(1, spaceIdx) : content.slice(1);
      const args = spaceIdx > 0 ? content.slice(spaceIdx + 1) : "";
      const cmd = SLASH_COMMANDS.find((c) => c.name === cmdName);
      if (cmd) {
        content = cmd.execute(args);
        if (!content) return;
      }
    }
    setNewMessage("");
    setSlashQuery(null);
    setMentionQuery(null);
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
    nearBottomRef.current = true;
    setTimeout(() => scrollToBottom(), 50);

    function revert() {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setNewMessage((cur) => (cur.trim() ? cur : content));
    }

    try {
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
        sounds.messageSent();

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
        // Remove failed optimistic message and surface the server's reason
        revert();
        await toastResponseError(res, "Failed to send message. Please try again.");
      }
    } catch {
      // Network failure — revert the optimistic message so it isn't stuck pending
      revert();
      toast("Failed to send message — check your connection.", "error");
    }
  }

  async function handleEdit(messageId: string, newContent: string) {
    const previous = [...messagesRef.current, ...threadMessagesRef.current].find((m) => m.id === messageId);
    if (!previous) return;
    const optimisticEditedAt = new Date().toISOString();
    // Merge only the edited fields — never replace the whole message object.
    const applyEdit = (content: string, editedAt: string | null | undefined) => (m: Message) =>
      m.id === messageId ? { ...m, content, editedAt } : m;
    const applyBoth = (content: string, editedAt: string | null | undefined) => {
      setMessages((prev) => prev.map(applyEdit(content, editedAt)));
      setThreadMessages((prev) => prev.map(applyEdit(content, editedAt)));
    };
    applyBoth(newContent, optimisticEditedAt);

    try {
      const res = await fetch(`/api/messages/${messageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newContent }),
      });

      if (!res.ok) {
        applyBoth(previous.content, previous.editedAt);
        await toastResponseError(res, "Failed to edit message. Please try again.");
        return;
      }
      const data = (await res.json().catch(() => null)) as { message?: { content?: unknown; editedAt?: unknown; updatedAt?: unknown } } | null;
      const saved = data?.message;
      const content = typeof saved?.content === "string" ? saved.content : newContent;
      const editedAt = typeof saved?.editedAt === "string" ? saved.editedAt : optimisticEditedAt;
      applyBoth(content, editedAt);
      // Broadcast edit (the realtime server re-reads the row before relaying)
      getSocket().emit("message:edit", {
        channelId,
        messageId,
        content,
        updatedAt: typeof saved?.updatedAt === "string" ? saved.updatedAt : editedAt,
      });
    } catch {
      applyBoth(previous.content, previous.editedAt);
      toast("Failed to edit message — check your connection.", "error");
    }
  }

  async function handleReact(messageId: string, emoji: string) {
    try {
      const res = await fetch(`/api/messages/${messageId}/reactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emoji }),
      });

      if (!res.ok) {
        await toastResponseError(res, "Failed to add reaction");
        return;
      }
      const { reactions } = await res.json();
      const patch = (m: Message) => (m.id === messageId ? { ...m, reactions } : m);
      setMessages((prev) => prev.map(patch));
      setThreadMessages((prev) => prev.map(patch));
      // Broadcast reaction update
      getSocket().emit("message:react", { channelId, messageId, reactions });
    } catch {
      toast("Failed to add reaction — check your connection.", "error");
    }
  }

  async function handleDelete(messageId: string) {
    try {
      const res = await fetch(`/api/messages/${messageId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        await toastResponseError(res, "Failed to delete message");
        return;
      }
      const reply = threadMessagesRef.current.find((m) => m.id === messageId);
      setMessages((prev) =>
        prev
          .filter((m) => m.id !== messageId)
          .map((m) =>
            reply && m.id === reply.parentMessageId
              ? { ...m, replyCount: Math.max(0, (m.replyCount ?? 0) - 1) }
              : m,
          ),
      );
      setThreadMessages((prev) => prev.filter((m) => m.id !== messageId));
      if (threadParentIdRef.current === messageId) {
        threadParentIdRef.current = null;
        setThreadParent(null);
      }
      setEditingId((current) => (current === messageId ? null : current));
      // Broadcast delete
      getSocket().emit("message:delete", { channelId, messageId });
    } catch {
      toast("Failed to delete message — check your connection.", "error");
    }
  }

  async function handlePin(messageId: string, pinned: boolean) {
    try {
      const res = await fetch(`/api/messages/${messageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned }),
      });
      if (!res.ok) {
        await toastResponseError(res, pinned ? "Couldn't pin that message" : "Couldn't unpin that message");
        return;
      }
      // Only the pin flag changes — keep editedAt etc. untouched.
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, pinned } : m))
      );
      toast(pinned ? "Message pinned" : "Message unpinned", "success");
    } catch {
      toast("Couldn't update the pin — check your connection.", "error");
    }
  }

  async function openThread(messageId: string, author: { id: string; username: string }) {
    threadParentIdRef.current = messageId;
    setThreadParent({ id: messageId, author });
    setThreadMessages([]);
    setThreadLoading(true);
    try {
      const res = await fetch(`/api/messages?channelId=${encodeURIComponent(channelId)}&parentId=${encodeURIComponent(messageId)}`);
      if (threadParentIdRef.current !== messageId) return;
      if (!res.ok) {
        await toastResponseError(res, "Couldn't load this thread");
        return;
      }
      const { messages: replies } = (await res.json()) as MessagePage;
      if (threadParentIdRef.current !== messageId) return;
      const page = replies || [];
      const known = new Set(page.map((m) => m.id));
      setThreadMessages((prev) => [...page, ...prev.filter((m) => !known.has(m.id))]);
    } catch {
      if (threadParentIdRef.current === messageId) toast("Couldn't load this thread", "error");
    } finally {
      if (threadParentIdRef.current === messageId) setThreadLoading(false);
    }
  }

  function closeThread() {
    threadParentIdRef.current = null;
    setThreadParent(null);
  }

  async function sendThreadMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!threadInput.trim() || !threadParent) return;
    const content = threadInput.trim();
    setThreadInput("");
    const parentId = threadParent.id;
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId, content, parentMessageId: parentId }),
      });
      if (res.ok) {
        const { message } = await res.json();
        if (threadParentIdRef.current === parentId) {
          setThreadMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.id === parentId ? { ...m, replyCount: (m.replyCount ?? 0) + 1 } : m
          )
        );
        // Same relay as a normal send — other clients bump the count / live thread.
        getSocket().emit("message:send", { channelId, message });
        sounds.messageSent();
      } else {
        // Restore the unsent reply so it isn't silently lost
        setThreadInput((cur) => (cur.trim() ? cur : content));
        await toastResponseError(res, "Failed to send reply. Please try again.");
      }
    } catch {
      setThreadInput((cur) => (cur.trim() ? cur : content));
      toast("Failed to send reply — check your connection.", "error");
    }
  }

  async function handleVoiceNoteSend(file: File): Promise<void> {
    setUploadProgress(1);
    try {
      const { attachmentId } = await uploadPrivateAttachment(file, (pct) =>
        setUploadProgress(pct),
      );

      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId,
          content: "",
          attachmentId,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error || "Campfire could not send that voice note.");
      }

      const { message } = await res.json();
      setMessages((prev) => [...prev, message]);
      nearBottomRef.current = true;
      setTimeout(() => scrollToBottom(), 50);
      getSocket().emit("message:send", { channelId, message });
    } finally {
      setUploadProgress(0);
    }
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (file) void handleFileDrop(file);
  }

  async function handleFileDrop(file: File) {
    if (slowRemaining > 0) {
      toast(`Slow mode is on — wait ${slowRemaining}s to send again`, "info");
      return;
    }
    if (!(await checkUploadAllowed(file))) return;
    setUploadProgress(1);
    try {
      const { attachmentId } = await uploadPrivateAttachment(file, (pct) => setUploadProgress(pct));
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId, content: "", attachmentId }),
      });
      if (!res.ok) {
        // Surface the server's reason (slow mode, revoked access) instead of
        // letting a finished upload vanish without a message.
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || "Upload failed. Please try again.");
      }
      const { message } = await res.json();
      setMessages((prev) => [...prev, message]);
      nearBottomRef.current = true;
      setTimeout(() => scrollToBottom(), 50);
      getSocket().emit("message:send", { channelId, message });
    } catch (error) {
      toast(error instanceof Error ? error.message : "Upload failed. Please try again.", "error");
    } finally {
      setUploadProgress(0);
    }
  }

  async function sendGif(gifUrl: string) {
    setShowGifPicker(false);
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId, content: "", attachmentUrl: gifUrl, attachmentName: "gif" }),
      });
      if (!res.ok) {
        await toastResponseError(res, "Couldn't send that GIF");
        return;
      }
      const { message } = await res.json();
      setMessages((prev) => [...prev, message]);
      nearBottomRef.current = true;
      setTimeout(() => scrollToBottom(), 50);
      getSocket().emit("message:send", { channelId, message });
    } catch {
      toast("Couldn't send that GIF — check your connection.", "error");
    }
  }

  async function saveTopic() {
    const trimmed = topicDraft.trim();
    try {
      const res = await fetch(`/api/channels/${channelId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: trimmed }),
      });
      if (res.ok) {
        setTopic(trimmed);
      } else {
        await toastResponseError(res, "Failed to save topic. Please try again.");
      }
    } catch {
      toast("Failed to save topic — check your connection.", "error");
    } finally {
      setEditingTopic(false);
    }
  }

  function startTopicEdit() {
    setTopicDraft(topic);
    setEditingTopic(true);
  }

  function handleComposerKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Never act on keys that are part of an IME composition (e.g. Japanese input).
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    const mod = e.ctrlKey || e.metaKey;

    // @mention menu open with matches: Enter/Tab pick a member (MentionAutocomplete
    // handles the selection) and arrows move through the list — never send.
    const mentionOpen = mentionQuery !== null && filterMentionMembers(mentionQuery, members).length > 0;
    if (mentionOpen) {
      if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey) {
        e.preventDefault();
        return;
      }
      if (e.key === "ArrowUp" || e.key === "ArrowDown") return;
    }

    // /command menu: Tab (or Enter on a partial name) completes the first match.
    if (slashQuery !== null && (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey))) {
      const query = slashQuery.toLowerCase();
      const matches = SLASH_COMMANDS.filter((c) => c.name.startsWith(query));
      const exact = SLASH_COMMANDS.some((c) => c.name === query);
      if (matches.length > 0 && (e.key === "Tab" || !exact)) {
        e.preventDefault();
        setNewMessage(`/${matches[0].name} `);
        setSlashQuery(null);
        return;
      }
    }

    if (mod && e.key === "b") {
      e.preventDefault();
      if (inputRef.current) wrapSelection(inputRef.current, "**", "**", "bold text", setNewMessage);
    } else if (mod && e.key === "i") {
      e.preventDefault();
      if (inputRef.current) wrapSelection(inputRef.current, "_", "_", "italic text", setNewMessage);
    } else if (mod && e.key === "k" && e.currentTarget.selectionStart !== e.currentTarget.selectionEnd) {
      // Ctrl+K with text selected links it; without a selection it falls
      // through to the global Ctrl+K search shortcut.
      e.preventDefault();
      e.stopPropagation();
      requestLink();
    } else if (e.key === "ArrowUp" && !newMessage && !mod && !e.shiftKey && !e.altKey) {
      // ↑ in an empty composer edits your last message.
      if (editLastOwnMessage()) e.preventDefault();
    } else if (e.key === "Escape" && replyingTo) {
      e.preventDefault();
      setReplyingTo(null);
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend(e as unknown as React.FormEvent);
    }
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

  const purgedIds = useMemo(() => new Set(purgedMessageIds ?? []), [purgedMessageIds]);
  const visibleMessages = messages.filter((m) => !m.parentMessageId && !purgedIds.has(m.id));
  const visibleThreadMessages = threadMessages.filter((m) => !purgedIds.has(m.id));
  const pinnedCount = visibleMessages.filter((m) => m.pinned).length;

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
        const files = e.dataTransfer.files;
        if (files.length > 1) {
          toast("Only one file can be uploaded at a time — sending the first one.", "info");
        }
        if (files[0]) void handleFileDrop(files[0]);
      }}
    >
      {/* Drop zone overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[var(--accent)]/10 border-2 border-dashed border-[var(--accent)] rounded-lg pointer-events-none">
          <div className="text-center">
            <svg className="mx-auto mb-3 text-[var(--accent)]" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            <p className="text-xl font-bold text-[var(--accent)]">Drop to upload</p>
            <p className="text-sm text-[var(--muted)] mt-1">Images (JPG, PNG, GIF, WebP), PDFs, text files and .zip archives</p>
          </div>
        </div>
      )}

      {/* Main chat column — campfire scene behind the conversation, with a
          theme-tinted scrim so message text stays readable on any theme. */}
      <div
        className="flex-1 flex flex-col min-w-0"
        style={{
          backgroundImage:
            "linear-gradient(color-mix(in srgb, var(--bg) 82%, transparent), color-mix(in srgb, var(--bg) 90%, transparent)), url('/chat-bg.png')",
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      >
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--accent-2)]/30 bg-[var(--panel-2)] px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <ChatIcon name="hash" size={20} className="shrink-0 text-[var(--muted)]" />
          <h3 className="max-w-[45%] shrink-0 truncate font-bold text-[var(--text)]" title={channelName}>{channelName}</h3>
          {editingTopic ? (
            <form
              className="flex min-w-0 flex-1 items-center gap-1"
              onSubmit={(e) => { e.preventDefault(); void saveTopic(); }}
            >
              <span className="h-5 w-px shrink-0 bg-[var(--accent-2)]/30" aria-hidden="true" />
              <input
                autoFocus
                type="text"
                value={topicDraft}
                maxLength={1024}
                aria-label="Channel topic"
                onChange={(e) => setTopicDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setEditingTopic(false); } }}
                placeholder="Set a channel topic..."
                className="min-w-0 flex-1 rounded border border-[var(--accent-2)]/50 bg-[var(--panel)] px-2 py-1 text-xs text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
              />
              <button type="submit" className="shrink-0 rounded bg-[var(--accent)] px-2 py-1 text-xs font-medium text-[var(--bg)] transition-colors hover:bg-[var(--accent-2)] hover:text-[var(--text)]">Save</button>
              <button type="button" onClick={() => setEditingTopic(false)} className="shrink-0 px-1 text-xs text-[var(--muted)] hover:text-[var(--text)]">Cancel</button>
            </form>
          ) : (topic || canEditTopic) && (
            <>
              <span className="h-5 w-px shrink-0 bg-[var(--accent-2)]/30" aria-hidden="true" />
              {canEditTopic ? (
                <button
                  type="button"
                  onClick={startTopicEdit}
                  title={topic ? `${topic} — click to edit` : "Add a channel topic"}
                  aria-label={topic ? `Channel topic: ${topic}. Edit topic` : "Add a channel topic"}
                  className={`min-w-0 truncate rounded px-1 text-left text-sm transition-colors hover:bg-[var(--panel)] hover:text-[var(--text)] ${topic ? "text-[var(--muted)]" : "italic text-[var(--muted)]/70"}`}
                >
                  {topic || "Add a topic"}
                </button>
              ) : (
                <span className="min-w-0 truncate text-sm text-[var(--muted)]" title={topic}>{topic}</span>
              )}
            </>
          )}
        </div>
        <div role="toolbar" aria-label="Channel tools" className="flex shrink-0 items-center gap-0.5">
          <HeaderButton icon="vote" label="Start a Camp Vote" onClick={() => setShowPollModal(true)} />
          {serverId && (
            <HeaderButton icon="journal" label="Camp Journal" active={sidePanel === "journal"} onClick={() => togglePanel("journal")} />
          )}
          <HeaderButton icon="bookmark" label="Saved messages" active={sidePanel === "saved"} onClick={() => togglePanel("saved")} />
          <HeaderButton
            icon="pin"
            label={pinnedCount > 0 ? `Pinned messages (${pinnedCount})` : "Pinned messages"}
            active={sidePanel === "pins"}
            badge={pinnedCount}
            onClick={() => togglePanel("pins")}
          />
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleLogScroll}
        role="log"
        aria-live="polite"
        aria-label={`Messages in #${channelName}`}
        className="flex-1 overflow-y-auto"
      >
        {loading ? (
          <div className="flex items-center justify-center h-full text-[var(--muted)]">
            Loading tracks...
          </div>
        ) : loadError && messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-[var(--muted)]">
            <p className="text-sm">Couldn&apos;t load messages for #{channelName}.</p>
            <button
              type="button"
              onClick={() => { setLoading(true); setLoadError(false); setReloadKey((k) => k + 1); }}
              className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--bg)] hover:bg-[var(--accent-2)] hover:text-[var(--text)]"
            >
              Try again
            </button>
          </div>
        ) : (
          <div className="flex min-h-full flex-col justify-end pb-2">
            {hasMore ? (
              <div className="flex justify-center py-3">
                <button
                  type="button"
                  onClick={() => void loadOlder()}
                  disabled={loadingOlder}
                  className="rounded-full border border-[var(--accent-2)]/30 bg-[var(--panel)] px-3 py-1 text-xs text-[var(--muted)] transition-colors hover:text-[var(--text)] disabled:opacity-60"
                >
                  {loadingOlder ? "Loading older messages…" : "Load older messages"}
                </button>
              </div>
            ) : (
              <ChannelWelcome channelName={channelName} topic={topic} />
            )}
            {visibleMessages.map((msg, index) => {
              const prev = index > 0 ? visibleMessages[index - 1] : null;
              const newDay = !prev || dayKey(prev.createdAt) !== dayKey(msg.createdAt);
              const unreadBoundary = firstUnreadId === msg.id;
              const gap = prev ? new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime() : Infinity;
              // Discord-style grouping: same author within 5 minutes collapses
              // into compact rows; replies, polls and system lines break groups.
              const compact =
                !!prev &&
                !newDay &&
                !unreadBoundary &&
                prev.author.id === msg.author.id &&
                !prev.isSystem &&
                !msg.isSystem &&
                !prev.poll &&
                !msg.poll &&
                !msg.replyTo &&
                gap >= 0 &&
                gap < GROUP_WINDOW_MS;
              return (
                <div
                  key={`${msg.id}:${blockedUserIds?.has(msg.author.id) ? "blocked" : "visible"}`}
                  ref={(el) => { if (el) messageRefs.current.set(msg.id, el); else messageRefs.current.delete(msg.id); }}
                >
                  {newDay && (
                    <div role="separator" className="mx-4 mt-4 mb-1 flex items-center gap-2">
                      <div className="h-px flex-1 bg-[var(--accent-2)]/25" />
                      <span className="text-[11px] font-semibold text-[var(--muted)]">{dayLabel(msg.createdAt)}</span>
                      <div className="h-px flex-1 bg-[var(--accent-2)]/25" />
                    </div>
                  )}
                  {unreadBoundary && (
                    <div className="mx-4 my-2 flex items-center gap-2" role="separator" aria-label="New messages">
                      <div className="h-px flex-1 bg-[var(--danger)]/70" />
                      <span className="px-1 text-[10px] font-bold uppercase tracking-widest text-[var(--danger)]">New</span>
                      <div className="h-px flex-1 bg-[var(--danger)]/70" />
                    </div>
                  )}
                  <MessageBubble
                    message={msg}
                    isOwn={msg.author.id === currentUserId}
                    currentUserId={currentUserId}
                    canPin={canPin}
                    compact={compact}
                    mentionsMe={msg.author.id !== currentUserId && mentionsUser(msg.content, currentUsername)}
                    editing={editingId === msg.id}
                    onEditingChange={(editing) => handleEditingChange(msg.id, editing)}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onReact={handleReact}
                    onReply={(target) => { setReplyingTo(target); inputRef.current?.focus(); }}
                    onScrollToMessage={(id) => { void jumpToMessage(id); }}
                    onPin={handlePin}
                    onThread={openThread}
                    onBookmark={handleBookmark}
                    isBookmarked={bookmarkedMessageIds.has(msg.id)}
                    onJournal={serverId ? handleJournal : undefined}
                    onTranslate={handleTranslate}
                    translatedText={translations.get(msg.id) ?? null}
                    blocked={blockedUserIds?.has(msg.author.id)}
                    replyAuthorBlocked={!!msg.replyTo && blockedUserIds?.has(msg.replyTo.author.id)}
                    customEmojis={customEmojis}
                  />
                </div>
              );
            })}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div aria-live="polite" aria-atomic="true" className="h-5 px-4 shrink-0 flex items-center transition-opacity duration-150" style={{ opacity: typingLabel ? 1 : 0 }}>
        {typingLabel && (
          <span className="flex items-center text-xs text-[var(--muted)] italic">
            {typingLabel}
            <span className="inline-flex gap-0.5 items-end ml-1" aria-hidden="true">
              <span className="w-1 h-1 rounded-full bg-[var(--muted)] animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-1 h-1 rounded-full bg-[var(--muted)] animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-1 h-1 rounded-full bg-[var(--muted)] animate-bounce" style={{ animationDelay: "300ms" }} />
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
            aria-label="Cancel reply"
            title="Cancel reply (Esc)"
          >
            ✕
          </button>
        </div>
      )}

      <form onSubmit={handleSend} className={`px-4 pb-4 pb-safe shrink-0 ${replyingTo ? "pt-0" : "pt-1"} relative`}>
        {/* Slash command menu */}
        {slashQuery !== null && (
          <SlashCommandMenu
            query={slashQuery}
            onSelect={(cmd) => {
              const spaceIdx = newMessage.indexOf(" ");
              const args = spaceIdx > 0 ? newMessage.slice(spaceIdx + 1) : "";
              setNewMessage(cmd.execute(args));
              setSlashQuery(null);
              inputRef.current?.focus();
            }}
            onClose={() => setSlashQuery(null)}
          />
        )}

        {/* @mention autocomplete */}
        {mentionQuery !== null && members.length > 0 && (
          <MentionAutocomplete
            query={mentionQuery}
            members={members}
            onSelect={(user) => {
              const mentionRegex = /@\w*$/;
              setNewMessage((prev) => prev.replace(mentionRegex, `@${user.username} `));
              setMentionQuery(null);
              inputRef.current?.focus();
            }}
            onClose={() => setMentionQuery(null)}
          />
        )}

        {/* Emoji picker popover */}
        {showEmojiPicker && (
          <div className="absolute bottom-full right-4 mb-2 z-50">
            <EmojiPicker
              customEmojis={customEmojis}
              onSelect={(emoji) => {
                setNewMessage((prev) => prev + emoji);
                inputRef.current?.focus();
              }}
              onClose={() => setShowEmojiPicker(false)}
            />
          </div>
        )}

        {/* GIF picker popover */}
        {showGifPicker && (
          <div className="absolute bottom-full right-4 mb-2 z-50">
            <GifPicker
              onSelect={(gifUrl) => { void sendGif(gifUrl); }}
              onClose={() => setShowGifPicker(false)}
            />
          </div>
        )}

        {showToolbar && (
          <FormattingToolbar
            inputRef={inputRef}
            onChange={setNewMessage}
            onLink={requestLink}
          />
        )}
        {uploading && (
          <div className="mb-2 h-1.5 bg-[var(--panel)] rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--accent-2)] transition-all duration-100"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        )}
        <div className={`flex items-end bg-[var(--panel)] border border-[var(--accent-2)]/30 focus-within:border-[var(--accent)]/60 transition-colors ${showToolbar ? "rounded-b-lg" : "rounded-lg"}`}>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || slowRemaining > 0}
            className="px-3 py-3 text-[var(--muted)] hover:text-[var(--text)] transition-colors disabled:opacity-30"
            title="Upload file"
            aria-label="Upload file"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept={UPLOAD_ACCEPT}
            onChange={handleFileUpload}
            className="hidden"
          />
          <VoiceNoteRecorder
            key={channelId}
            disabled={uploading || slowRemaining > 0}
            onSend={handleVoiceNoteSend}
          />
          <label htmlFor="message-input" className="sr-only">Message #{channelName}</label>
          <textarea
            id="message-input"
            ref={inputRef}
            value={newMessage}
            onChange={handleInputChange}
            onPaste={(e) => {
              // Pasted screenshot/file → upload. Anything carrying plain text
              // (incl. spreadsheet cells, which also carry an image) pastes as text.
              const file = e.clipboardData.files[0];
              if (!file || e.clipboardData.getData("text/plain")) return;
              e.preventDefault();
              void handleFileDrop(file);
            }}
            onKeyDown={handleComposerKeyDown}
            placeholder={uploading ? "Uploading..." : slowRemaining > 0 ? `Wait ${slowRemaining}s to send again` : `Message #${channelName}`}
            rows={1}
            className="flex-1 min-w-0 px-2 py-3 bg-transparent text-[var(--text)] focus:outline-none placeholder:text-[var(--muted)] placeholder:truncate resize-none overflow-y-auto"
            style={{ minHeight: "44px", maxHeight: "200px" }}
            disabled={uploading || slowRemaining > 0}
          />
          <button
            type="button"
            onClick={() => setShowToolbar((v) => !v)}
            className={`hidden sm:block px-2 py-3 text-xs font-semibold transition-colors ${showToolbar ? "text-[var(--accent-2)]" : "text-[var(--muted)] hover:text-[var(--text)]"}`}
            title="Toggle formatting toolbar"
            aria-label="Toggle formatting toolbar"
            aria-pressed={showToolbar}
          >
            Aa
          </button>
          <button
            type="button"
            onClick={() => { setShowEmojiPicker((v) => !v); setShowGifPicker(false); }}
            className={`px-1.5 py-3 text-base transition-colors ${showEmojiPicker ? "text-[var(--accent-2)]" : "text-[var(--muted)] hover:text-[var(--text)]"}`}
            title="Emoji picker"
            aria-label="Emoji picker"
          >
            😀
          </button>
          <button
            type="button"
            onClick={() => { setShowGifPicker((v) => !v); setShowEmojiPicker(false); }}
            className={`px-1.5 py-3 text-xs font-bold transition-colors ${showGifPicker ? "text-[var(--accent-2)]" : "text-[var(--muted)] hover:text-[var(--text)]"}`}
            title="GIF picker"
            aria-label="GIF picker"
          >
            GIF
          </button>
          <button
            type="submit"
            disabled={!newMessage.trim() || uploading || slowRemaining > 0}
            className="px-3 sm:px-4 py-3 text-[var(--accent-2)] hover:text-[var(--accent)] disabled:opacity-30 transition-colors"
            aria-label="Send message"
          >
            Send
          </button>
        </div>
      </form>
      </div>{/* end main chat column */}

      {/* Pinned messages side panel */}
      {sidePanel === "pins" && (
        <PinnedMessagesPanel
          channelId={channelId}
          canPin={canPin ?? false}
          onClose={() => setSidePanel(null)}
          onJumpToMessage={(messageId) => jumpFromPanel(channelId, messageId)}
          onUnpin={(messageId) => handlePin(messageId, false)}
          blockedUserIds={blockedUserIds}
        />
      )}

      {sidePanel === "saved" && (
        <SavedMessagesPanel
          currentChannelId={channelId}
          bookmarkedMessageIds={bookmarkedMessageIds}
          onClose={() => setSidePanel(null)}
          onJumpToMessage={jumpFromPanel}
          onRemove={(messageId) => handleBookmark(messageId, false)}
          blockedUserIds={blockedUserIds}
        />
      )}

      {sidePanel === "journal" && serverId && (
        <CampJournalPanel
          serverId={serverId}
          onClose={() => setSidePanel(null)}
          onJumpToMessage={jumpFromPanel}
        />
      )}

      {/* Thread panel */}
      {threadParent && (
        <div className="w-80 flex flex-col border-l border-[var(--accent-2)]/30 bg-[var(--panel)] shrink-0">
          <div className="h-12 px-3 flex items-center justify-between border-b border-[var(--accent-2)]/30 shrink-0">
            <span className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
              <ChatIcon name="thread" size={16} className="text-[var(--muted)]" />
              Thread
            </span>
            <button
              type="button"
              onClick={closeThread}
              className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--panel-2)] hover:text-[var(--text)]"
              aria-label="Close thread"
              title="Close thread"
            >
              <ChatIcon name="close" size={16} />
            </button>
          </div>
          <div className="px-3 py-2 border-b border-[var(--accent-2)]/10 text-xs text-[var(--muted)]">
            Reply to <span className="text-[var(--text)] font-medium">{blockedUserIds?.has(threadParent.author.id) ? "blocked user" : threadParent.author.username}</span>
          </div>
          <div className="flex-1 overflow-y-auto py-2">
            {threadLoading && visibleThreadMessages.length === 0 ? (
              <div className="text-xs text-[var(--muted)] italic px-4">Loading...</div>
            ) : visibleThreadMessages.length === 0 ? (
              <div className="text-xs text-[var(--muted)] italic px-4">No replies yet — start the conversation.</div>
            ) : (
              visibleThreadMessages.map((msg) => (
                <MessageBubble
                  key={`${msg.id}:${blockedUserIds?.has(msg.author.id) ? "blocked" : "visible"}`}
                  message={msg}
                  isOwn={msg.author.id === currentUserId}
                  currentUserId={currentUserId}
                  canPin={canPin}
                  editing={editingId === msg.id}
                  onEditingChange={(editing) => handleEditingChange(msg.id, editing)}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  onReact={handleReact}
                  onBookmark={handleBookmark}
                  isBookmarked={bookmarkedMessageIds.has(msg.id)}
                  onJournal={serverId ? handleJournal : undefined}
                  onTranslate={handleTranslate}
                  translatedText={translations.get(msg.id) ?? null}
                  blocked={blockedUserIds?.has(msg.author.id)}
                  replyAuthorBlocked={!!msg.replyTo && blockedUserIds?.has(msg.replyTo.author.id)}
                  customEmojis={customEmojis}
                />
              ))
            )}
          </div>
          <form onSubmit={sendThreadMessage} className="px-3 pb-3 pt-1 shrink-0">
            <div className="flex items-center bg-[var(--panel-2)] rounded-lg border border-[var(--accent-2)]/30">
              <label htmlFor="thread-input" className="sr-only">Reply in thread</label>
              <input
                id="thread-input"
                type="text"
                value={threadInput}
                onChange={(e) => setThreadInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); closeThread(); } }}
                placeholder="Reply in thread..."
                className="flex-1 px-2 py-2 bg-transparent text-[var(--text)] focus:outline-none placeholder:text-[var(--muted)] text-sm"
              />
              <button
                type="submit"
                disabled={!threadInput.trim()}
                className="px-3 py-2 text-[var(--accent-2)] hover:text-[var(--accent)] disabled:opacity-30 transition-colors text-sm"
                aria-label="Send thread reply"
              >
                Send
              </button>
            </div>
          </form>
        </div>
      )}
      {showPollModal && (
        <CreatePollModal
          channelId={channelId}
          onClose={() => setShowPollModal(false)}
          onCreated={handlePollCreated}
        />
      )}
      {promptRequest && (
        <PromptDialog
          key={promptRequest.title}
          {...promptRequest}
          onCancel={() => setPromptRequest(null)}
        />
      )}
    </div>
  );
}
