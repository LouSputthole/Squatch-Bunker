"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import ChatPanel, { type Message as ChatMessage } from "@/components/ChatPanel";
import PromptDialog, { type PromptDialogRequest } from "@/components/PromptDialog";
import { useEscape } from "@/hooks/useEscape";
import { getSocket } from "@/lib/socket";
import { toast, toastResponseError } from "@/lib/toast";

export interface BoardTopic {
  id: string;
  channelId: string;
  rootMessageId: string;
  title: string;
  tags: string[];
  status: string;
  pinned: boolean;
  owner: { id: string; username: string } | null;
  author: { id: string; username: string; avatar: string | null };
  snippet: string;
  hasAttachment: boolean;
  replyCount: number;
  lastActivityAt: string;
  createdAt: string;
  resolvedAt: string | null;
  archivedAt: string | null;
}

interface BoardPanelProps {
  channelId: string;
  channelName: string;
  channelDescription?: string | null;
  channelSlowMode?: number;
  serverId?: string;
  currentUserId: string;
  currentUsername: string;
  currentAvatar?: string | null;
  /** MANAGE_MESSAGES-level: archive, pin, hand over, and moderate replies. */
  canModerate: boolean;
  blockedUserIds?: ReadonlySet<string>;
  focusMessageId?: string | null;
  onFocusHandled?: () => void;
  purgedMessageIds?: readonly string[];
  onJumpToMessage?: (channelId: string, messageId: string) => void;
}

type StatusFilter = "active" | "open" | "resolved" | "archived";
const STATUS_FILTERS: Array<[StatusFilter, string]> = [
  ["active", "Open & resolved"],
  ["open", "Open"],
  ["resolved", "Resolved"],
  ["archived", "Archived"],
];
const PAGE = 50;
const MAX_TAG_CHIPS = 12;

function relativeTime(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function sortTopics(topics: BoardTopic[]): BoardTopic[] {
  return [...topics].sort((a, b) =>
    Number(b.pinned) - Number(a.pinned) || b.lastActivityAt.localeCompare(a.lastActivityAt) || b.id.localeCompare(a.id));
}

const chip = "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide";
const STATUS_CHIP: Record<string, string> = {
  open: `${chip} bg-[var(--accent)]/15 text-[var(--accent)]`,
  resolved: `${chip} bg-emerald-500/15 text-emerald-300`,
  archived: `${chip} bg-[var(--panel-2)] text-[var(--muted)]`,
};
const smallButton = "rounded px-2 py-1 text-xs transition-colors disabled:opacity-50";
const quietButton = `${smallButton} text-[var(--muted)] hover:bg-[var(--panel-2)] hover:text-[var(--text)]`;
const primaryButton = `${smallButton} bg-[var(--accent)] font-semibold text-[var(--bg)] hover:opacity-90`;

/** Create (title + tags + first post) or edit (title + tags) a topic. */
function TopicFormDialog({
  mode,
  initial,
  onSubmit,
  onCancel,
}: {
  mode: "create" | "edit";
  initial?: { title: string; tags: string[] };
  onSubmit: (values: { title: string; tags: string[]; content: string }) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [tags, setTags] = useState(initial?.tags.join(", ") ?? "");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const titleId = useId();
  const ids = { title: useId(), tags: useId(), content: useId() };
  useEscape(() => {
    if (!busy) onCancel();
  });
  const valid = title.trim().length >= 3 && (mode === "edit" || content.trim().length > 0);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={busy ? undefined : onCancel} role="presentation">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-lg rounded-xl border border-[var(--accent-2)]/30 bg-[var(--panel)] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!valid || busy) return;
          setBusy(true);
          try {
            const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
            await onSubmit({ title: title.trim(), tags: tagList, content: content.trim() });
          } finally {
            setBusy(false);
          }
        }}
      >
        <h3 id={titleId} className="text-sm font-semibold text-[var(--text)]">{mode === "create" ? "Start a topic" : "Edit topic"}</h3>
        <label htmlFor={ids.title} className="mt-3 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Title</label>
        <input
          id={ids.title}
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          disabled={busy}
          placeholder="What's it about?"
          className="mt-1 w-full rounded-lg border border-[var(--accent-2)]/40 bg-[var(--panel-2)] px-3 py-2 text-sm text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
        />
        <label htmlFor={ids.tags} className="mt-3 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Tags (optional, up to 5)</label>
        <input
          id={ids.tags}
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          disabled={busy}
          placeholder="gear, winter, beginners"
          className="mt-1 w-full rounded-lg border border-[var(--accent-2)]/40 bg-[var(--panel-2)] px-3 py-2 text-sm text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
        />
        {mode === "create" && (
          <>
            <label htmlFor={ids.content} className="mt-3 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">First post</label>
            <textarea
              id={ids.content}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              maxLength={4000}
              rows={5}
              disabled={busy}
              placeholder="Give people what they need to answer."
              className="mt-1 w-full rounded-lg border border-[var(--accent-2)]/40 bg-[var(--panel-2)] px-3 py-2 text-sm text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
            />
          </>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={onCancel} className={quietButton}>Cancel</button>
          <button type="submit" disabled={busy || !valid} className={primaryButton}>{mode === "create" ? "Post topic" : "Save"}</button>
        </div>
      </form>
    </div>
  );
}

/** Trail Board: the topic list for a board channel, and one topic's thread. */
export default function BoardPanel({
  channelId,
  channelName,
  channelDescription,
  channelSlowMode = 0,
  serverId,
  currentUserId,
  currentUsername,
  currentAvatar,
  canModerate,
  blockedUserIds,
  focusMessageId,
  onFocusHandled,
  purgedMessageIds,
  onJumpToMessage,
}: BoardPanelProps) {
  const [topics, setTopics] = useState<BoardTopic[]>([]);
  const [tagCounts, setTagCounts] = useState<Array<{ tag: string; count: number }>>([]);
  const [hasMore, setHasMore] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [status, setStatus] = useState<StatusFilter>("active");
  const [tag, setTag] = useState<string | null>(null);
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<{ topic: BoardTopic; message: ChatMessage } | null>(null);
  const [form, setForm] = useState<{ mode: "create" } | { mode: "edit"; topic: BoardTopic } | null>(null);
  const [dialog, setDialog] = useState<PromptDialogRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const selectedRef = useRef(selected);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  const listUrl = useCallback((extra = "") => {
    const params = new URLSearchParams();
    if (status !== "active") params.set("status", status);
    if (tag) params.set("tag", tag);
    if (query) params.set("q", query);
    params.set("limit", String(limit));
    return `/api/boards/${channelId}/topics?${params.toString()}${extra}`;
  }, [channelId, status, tag, query, limit]);

  const load = useCallback(() => {
    let cancelled = false;
    fetch(listUrl())
      .then(async (res) => {
        if (!res.ok) throw new Error(`board ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        setTopics(data.topics || []);
        setTagCounts(data.tags || []);
        setHasMore(!!data.hasMore);
        setLoadError(false);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [listUrl]);

  useEffect(() => {
    let cancel: (() => void) | undefined;
    const timer = setTimeout(() => {
      cancel = load();
    }, 0);
    return () => {
      clearTimeout(timer);
      cancel?.();
    };
  }, [load]);

  // Debounced search.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(queryInput.trim()), 250);
    return () => clearTimeout(timer);
  }, [queryInput]);

  const upsertTopic = useCallback((topic: BoardTopic) => {
    setTopics((prev) => sortTopics(prev.some((t) => t.id === topic.id) ? prev.map((t) => (t.id === topic.id ? topic : t)) : [topic, ...prev]));
    setSelected((prev) => (prev && prev.topic.id === topic.id ? { ...prev, topic } : prev));
  }, []);

  // Realtime: new topics are root posts, replies bump activity, edits arrive as topic views.
  useEffect(() => {
    const socket = getSocket();
    socket.emit("channel:join", channelId);
    function onMessage(message: { id: string; parentMessageId?: string | null; createdAt: string }) {
      if (!message.parentMessageId) {
        load();
        return;
      }
      const rootId = message.parentMessageId;
      setTopics((prev) => sortTopics(prev.map((t) =>
        t.rootMessageId === rootId ? { ...t, replyCount: t.replyCount + 1, lastActivityAt: message.createdAt } : t)));
    }
    function onTopic(topic: BoardTopic) {
      upsertTopic(topic);
    }
    function onDeleted(data: { messageId?: string; messageIds?: string[] }) {
      const ids = new Set<string>(data.messageIds ?? []);
      if (data.messageId) ids.add(data.messageId);
      if (ids.size === 0) return;
      setTopics((prev) => prev.filter((t) => !ids.has(t.rootMessageId)));
      const current = selectedRef.current;
      if (current && ids.has(current.topic.rootMessageId)) {
        setSelected(null);
        toast("That topic was deleted", "info");
      }
    }
    socket.on(`message:channel:${channelId}`, onMessage);
    socket.on(`board:topic:updated:${channelId}`, onTopic);
    socket.on(`message:deleted:${channelId}`, onDeleted);
    return () => {
      socket.off(`message:channel:${channelId}`, onMessage);
      socket.off(`board:topic:updated:${channelId}`, onTopic);
      socket.off(`message:deleted:${channelId}`, onDeleted);
    };
  }, [channelId, load, upsertTopic]);

  const openTopic = useCallback(async (topicId: string) => {
    try {
      const res = await fetch(`/api/boards/${channelId}/topics/${topicId}`);
      if (!res.ok) {
        await toastResponseError(res, "Couldn't open that topic");
        return false;
      }
      const data = await res.json();
      setSelected({ topic: data.topic, message: data.message });
      setTopics((prev) => sortTopics(prev.map((t) => (t.id === data.topic.id ? data.topic : t))));
      return true;
    } catch {
      toast("Couldn't open that topic", "error");
      return false;
    }
  }, [channelId]);

  // A jump-to (search, saved, journal) lands on a message: open its topic; ChatPanel then scrolls.
  const focusHandledRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusMessageId) {
      focusHandledRef.current = null;
      return;
    }
    if (focusHandledRef.current === focusMessageId) return;
    focusHandledRef.current = focusMessageId;
    const current = selectedRef.current;
    if (current && (current.topic.rootMessageId === focusMessageId)) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/boards/${channelId}/topics?message=${encodeURIComponent(focusMessageId)}`);
        const data = res.ok ? await res.json() : null;
        const topic: BoardTopic | undefined = data?.topics?.[0];
        if (cancelled) return;
        if (!topic) {
          onFocusHandled?.();
          return;
        }
        if (current?.topic.id !== topic.id) await openTopic(topic.id);
      } catch {
        if (!cancelled) onFocusHandled?.();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [focusMessageId, channelId, openTopic, onFocusHandled]);

  async function patchTopic(topic: BoardTopic, body: Record<string, unknown>, fallback: string): Promise<BoardTopic | null> {
    setBusy(true);
    try {
      const res = await fetch(`/api/boards/${channelId}/topics/${topic.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        await toastResponseError(res, fallback);
        return null;
      }
      const data = await res.json();
      upsertTopic(data.topic);
      getSocket().emit("board:topic:update", { channelId, topicId: topic.id });
      return data.topic as BoardTopic;
    } catch {
      toast(fallback, "error");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function createTopic(values: { title: string; tags: string[]; content: string }): Promise<boolean> {
    try {
      const res = await fetch(`/api/boards/${channelId}/topics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        await toastResponseError(res, "Couldn't post the topic");
        return false;
      }
      const data = await res.json();
      getSocket().emit("message:send", { channelId, message: data.message });
      upsertTopic(data.topic);
      setForm(null);
      setSelected({ topic: data.topic, message: data.message });
      return true;
    } catch {
      toast("Couldn't post the topic", "error");
      return false;
    }
  }

  async function editTopic(topic: BoardTopic, values: { title: string; tags: string[] }): Promise<boolean> {
    const updated = await patchTopic(topic, { title: values.title, tags: values.tags }, "Couldn't save the topic");
    if (updated) setForm(null);
    return !!updated;
  }

  function askHandOver(topic: BoardTopic) {
    if (!serverId) return;
    fetch(`/api/servers/${serverId}/members`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const members = ((data?.members ?? []) as Array<{ id: string; username: string; banned?: boolean }>)
          .filter((m) => !m.banned && m.id !== topic.owner?.id)
          .sort((a, b) => a.username.localeCompare(b.username));
        if (members.length === 0) {
          toast("Nobody else to hand this to", "info");
          return;
        }
        setDialog({
          title: "Hand this topic to…",
          message: "They become its owner: they edit it, resolve it, and reopen it.",
          mode: "select",
          label: "New owner",
          options: members.map((m) => ({ value: m.id, label: m.username })),
          confirmLabel: "Hand over",
          onConfirm: async (ownerId) => {
            if (await patchTopic(topic, { ownerId }, "Couldn't hand the topic over")) setDialog(null);
          },
        });
      })
      .catch(() => toast("Couldn't load members", "error"));
  }

  const isOwner = (topic: BoardTopic) => topic.owner?.id === currentUserId;

  function renderTopicBar(topic: BoardTopic) {
    const owner = isOwner(topic);
    const archived = topic.status === "archived";
    return (
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--accent-2)]/20 bg-[var(--panel)] px-4 py-2 text-xs">
        <span className={STATUS_CHIP[topic.status] ?? STATUS_CHIP.open}>{topic.status}</span>
        {topic.pinned && <span className={`${chip} bg-[var(--panel-2)] text-[var(--muted)]`}>Pinned</span>}
        {topic.tags.map((t) => (
          <button key={t} onClick={() => { setSelected(null); setTag(t); }} className="rounded-full border border-[var(--accent-2)]/40 px-2 py-0.5 text-[10px] text-[var(--muted)] hover:text-[var(--text)]">#{t}</button>
        ))}
        <span className="text-[var(--muted)]">
          {topic.owner ? `Owned by ${topic.owner.username}` : "No owner"} · {topic.replyCount} {topic.replyCount === 1 ? "reply" : "replies"}
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-1">
          {(owner || canModerate) && !archived && (
            <button disabled={busy} onClick={() => setForm({ mode: "edit", topic })} className={quietButton}>Edit</button>
          )}
          {(owner || canModerate) && !archived && (
            <button
              disabled={busy}
              onClick={() => void patchTopic(topic, { status: topic.status === "resolved" ? "open" : "resolved" }, "Couldn't update the topic")}
              className={topic.status === "resolved" ? quietButton : primaryButton}
            >
              {topic.status === "resolved" ? "Reopen" : "Mark resolved"}
            </button>
          )}
          {canModerate && (
            <>
              <button disabled={busy} onClick={() => void patchTopic(topic, { pinned: !topic.pinned }, "Couldn't pin the topic")} className={quietButton}>
                {topic.pinned ? "Unpin" : "Pin"}
              </button>
              <button
                disabled={busy}
                onClick={() => void patchTopic(topic, { status: archived ? "open" : "archived" }, "Couldn't archive the topic")}
                className={quietButton}
              >
                {archived ? "Unarchive" : "Archive"}
              </button>
              {serverId && !archived && (
                <button disabled={busy} onClick={() => askHandOver(topic)} className={quietButton}>Hand over</button>
              )}
            </>
          )}
        </span>
      </div>
    );
  }

  if (selected) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        {renderTopicBar(selected.topic)}
        <ChatPanel
          channelId={channelId}
          channelName={channelName}
          channelSlowMode={channelSlowMode}
          currentUserId={currentUserId}
          currentUsername={currentUsername}
          currentAvatar={currentAvatar}
          canPin={canModerate}
          serverId={serverId}
          blockedUserIds={blockedUserIds}
          focusMessageId={focusMessageId}
          onFocusHandled={onFocusHandled}
          purgedMessageIds={purgedMessageIds}
          onJumpToMessage={onJumpToMessage}
          topicRoot={selected.message}
          topicTitle={selected.topic.title}
          topicArchived={selected.topic.status === "archived"}
          onTopicBack={() => setSelected(null)}
        />
        {form?.mode === "edit" && (
          <TopicFormDialog
            mode="edit"
            initial={{ title: form.topic.title, tags: form.topic.tags }}
            onSubmit={(values) => editTopic(form.topic, values)}
            onCancel={() => setForm(null)}
          />
        )}
        {dialog && <PromptDialog key={dialog.title} {...dialog} onCancel={() => setDialog(null)} />}
      </div>
    );
  }

  const tagChips = tagCounts.slice(0, MAX_TAG_CHIPS);

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-[var(--panel-2)]">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--accent-2)]/30 bg-[var(--panel-2)] px-4">
        <span aria-hidden="true" className="text-lg">🪧</span>
        <h3 className="truncate font-bold text-[var(--text)]" title={channelName}>{channelName}</h3>
        {channelDescription && <span className="hidden min-w-0 truncate text-sm text-[var(--muted)] sm:inline" title={channelDescription}>{channelDescription}</span>}
        <button onClick={() => setForm({ mode: "create" })} className={`${primaryButton} ml-auto shrink-0`}>New topic</button>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--accent-2)]/20 px-4 py-2">
        <label htmlFor={`board-search-${channelId}`} className="sr-only">Search topics</label>
        <input
          id={`board-search-${channelId}`}
          type="search"
          value={queryInput}
          onChange={(e) => setQueryInput(e.target.value)}
          placeholder="Search topics…"
          className="w-full min-w-0 flex-1 rounded-lg border border-[var(--accent-2)]/40 bg-[var(--panel)] px-3 py-1.5 text-sm text-[var(--text)] focus:border-[var(--accent)] focus:outline-none sm:w-auto"
        />
        <label htmlFor={`board-status-${channelId}`} className="sr-only">Topic status</label>
        <select
          id={`board-status-${channelId}`}
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          className="rounded-lg border border-[var(--accent-2)]/40 bg-[var(--panel)] px-2 py-1.5 text-xs text-[var(--text)] focus:outline-none"
        >
          {STATUS_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        {tag && (
          <button onClick={() => setTag(null)} className="rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-[10px] font-semibold text-[var(--accent)]" aria-label={`Stop filtering by #${tag}`}>
            #{tag} ×
          </button>
        )}
        {!tag && tagChips.length > 0 && (
          <span className="flex flex-wrap gap-1">
            {tagChips.map(({ tag: t, count }) => (
              <button key={t} onClick={() => setTag(t)} className="rounded-full border border-[var(--accent-2)]/40 px-2 py-0.5 text-[10px] text-[var(--muted)] hover:text-[var(--text)]" title={`${count} topic${count === 1 ? "" : "s"}`}>
                #{t}
              </button>
            ))}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {loading ? (
          <p className="py-12 text-center text-sm text-[var(--muted)]">Loading topics…</p>
        ) : loadError ? (
          <div className="flex flex-col items-center gap-2 py-12 text-sm text-[var(--muted)]" role="alert">
            Couldn&apos;t load this board.
            <button onClick={() => { setLoading(true); load(); }} className={quietButton}>Retry</button>
          </div>
        ) : topics.length === 0 ? (
          <div className="flex flex-col items-center gap-1 py-12 text-sm text-[var(--muted)]">
            <span aria-hidden="true" className="text-2xl">🪧</span>
            {query || tag || status !== "active" ? "No topics match." : "No topics yet — start the first one."}
          </div>
        ) : (
          <ul className="space-y-2" aria-label="Topics">
            {topics.map((topic) => {
              const blocked = blockedUserIds?.has(topic.author.id);
              return (
                <li key={topic.id}>
                  <button
                    onClick={() => void openTopic(topic.id)}
                    className="w-full rounded-lg border border-[var(--accent-2)]/30 bg-[var(--panel)] px-4 py-3 text-left transition-colors hover:border-[var(--accent)]/50"
                  >
                    <div className="flex items-start gap-2">
                      {topic.pinned && <span aria-label="Pinned" title="Pinned" className="mt-0.5 text-xs">📌</span>}
                      <span className={`min-w-0 flex-1 truncate text-sm font-semibold ${topic.status === "archived" ? "text-[var(--muted)]" : "text-[var(--text)]"}`}>{topic.title}</span>
                      {topic.status !== "open" && <span className={STATUS_CHIP[topic.status]}>{topic.status}</span>}
                    </div>
                    {!blocked && topic.snippet && (
                      <p className="mt-1 truncate text-xs text-[var(--muted)]">{topic.snippet}{topic.hasAttachment ? " 📎" : ""}</p>
                    )}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--muted)]">
                      {topic.tags.map((t) => <span key={t} className="rounded-full border border-[var(--accent-2)]/40 px-1.5 py-px">#{t}</span>)}
                      <span>{blocked ? "blocked user" : topic.owner?.username ?? topic.author.username}</span>
                      <span>·</span>
                      <span>{topic.replyCount} {topic.replyCount === 1 ? "reply" : "replies"}</span>
                      <span className="ml-auto">{relativeTime(topic.lastActivityAt)}</span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {hasMore && !loading && (
          <div className="flex justify-center py-3">
            <button onClick={() => setLimit((prev) => prev + PAGE)} className={quietButton}>Load more topics</button>
          </div>
        )}
      </div>

      {form?.mode === "create" && (
        <TopicFormDialog mode="create" onSubmit={createTopic} onCancel={() => setForm(null)} />
      )}
    </div>
  );
}
