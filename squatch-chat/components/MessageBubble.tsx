"use client";

import { useState, useEffect, useLayoutEffect, useRef } from "react";
import Image from "next/image";
import { displayName, truncateName } from "@/lib/utils";
import Avatar from "@/components/Avatar";
import ProfileCard from "@/components/ProfileCard";
import ImageLightbox from "@/components/ImageLightbox";
import { LinkPreview } from "@/components/LinkPreview";
import MessageContextMenu from "@/components/MessageContextMenu";
import PollCard, { type PollData } from "@/components/PollCard";
import BlockedMessageGate from "@/components/BlockedMessageGate";
import ChatIcon, { type ChatIconName } from "@/components/ChatIcons";
import PromptDialog from "@/components/PromptDialog";
import ReportDialog from "@/components/ReportDialog";
import CustomEmojiImage from "@/components/CustomEmojiImage";
import { parseCustomEmojiToken, type CustomEmojiMap } from "@/lib/customEmoji";
import { VOICE_NOTE_LABEL } from "@/lib/uploadPolicy";
import { toast } from "@/lib/toast";

function isCampfireVoiceNote(name: string): boolean {
  return name.toLowerCase().startsWith(VOICE_NOTE_LABEL.toLowerCase());
}

function getFileType(name: string): "image" | "video" | "audio" | "file" {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (isCampfireVoiceNote(name) && ["webm", "ogg", "m4a"].includes(ext)) return "audio";
  if (["jpg","jpeg","png","gif","webp","svg"].includes(ext)) return "image";
  if (["mp4","webm","mov","avi"].includes(ext)) return "video";
  if (["mp3","wav","ogg","m4a","flac"].includes(ext)) return "audio";
  return "file";
}

// URL extraction util — returns at most 1 unique URL for preview
function extractUrls(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s<>"]+/g;
  return [...new Set(text.match(urlRegex) ?? [])].slice(0, 1);
}

function SpoilerText({ children }: { children: string }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span
      onClick={() => setRevealed(true)}
      className={`inline rounded px-0.5 cursor-pointer select-none transition-all ${
        revealed
          ? "bg-[var(--panel-2)]"
          : "bg-[var(--text)] text-[var(--text)] blur-[3px] hover:blur-[2px]"
      }`}
      title={revealed ? undefined : "Click to reveal spoiler"}
    >
      {children}
    </span>
  );
}

const EMOJI_DATA: { emoji: string; keywords: string }[] = [
  // Smileys & emotion
  { emoji: "😀", keywords: "grinning happy smile" },
  { emoji: "😁", keywords: "grin happy teeth" },
  { emoji: "😂", keywords: "joy laugh cry tears lol" },
  { emoji: "🤣", keywords: "rofl laugh rolling floor" },
  { emoji: "😃", keywords: "smile happy grin open" },
  { emoji: "😄", keywords: "smile happy grin" },
  { emoji: "😅", keywords: "sweat smile nervous" },
  { emoji: "😆", keywords: "grin squint laugh" },
  { emoji: "😉", keywords: "wink" },
  { emoji: "😊", keywords: "blush smile happy" },
  { emoji: "😋", keywords: "yum delicious tongue" },
  { emoji: "😎", keywords: "cool sunglasses" },
  { emoji: "😍", keywords: "heart eyes love" },
  { emoji: "🥰", keywords: "love hearts smiling" },
  { emoji: "😘", keywords: "kiss blow heart" },
  { emoji: "🤩", keywords: "star eyes wow amazing" },
  { emoji: "🥳", keywords: "party celebrate hat" },
  { emoji: "😏", keywords: "smirk" },
  { emoji: "😒", keywords: "unamused meh" },
  { emoji: "🙄", keywords: "eye roll whatever" },
  { emoji: "😔", keywords: "pensive sad" },
  { emoji: "😢", keywords: "cry sad tear" },
  { emoji: "😭", keywords: "sob cry loud" },
  { emoji: "😤", keywords: "steam frustration" },
  { emoji: "😡", keywords: "angry mad rage red" },
  { emoji: "🤬", keywords: "swearing mad" },
  { emoji: "😱", keywords: "scream shock fear" },
  { emoji: "😨", keywords: "fearful scared" },
  { emoji: "🤯", keywords: "exploding head mind blown" },
  { emoji: "😴", keywords: "sleep tired zzz" },
  { emoji: "🥱", keywords: "yawn tired" },
  { emoji: "🤢", keywords: "nauseated sick green" },
  { emoji: "🤮", keywords: "vomit sick puke" },
  { emoji: "🥵", keywords: "hot sweating fever" },
  { emoji: "🥶", keywords: "cold freezing blue face" },
  { emoji: "😵", keywords: "dizzy spiral" },
  { emoji: "🤠", keywords: "cowboy hat" },
  { emoji: "🤡", keywords: "clown circus" },
  { emoji: "👻", keywords: "ghost boo halloween" },
  { emoji: "💀", keywords: "skull dead death" },
  { emoji: "🤖", keywords: "robot" },
  { emoji: "😺", keywords: "cat grin happy" },
  { emoji: "💩", keywords: "poop shit" },
  // Hand gestures & people
  { emoji: "👍", keywords: "thumbs up like good ok" },
  { emoji: "👎", keywords: "thumbs down dislike no" },
  { emoji: "👌", keywords: "ok perfect" },
  { emoji: "✌️", keywords: "peace victory two fingers" },
  { emoji: "🤞", keywords: "crossed fingers luck" },
  { emoji: "🤟", keywords: "love you hand" },
  { emoji: "🤘", keywords: "rock metal horns" },
  { emoji: "👏", keywords: "clap applause" },
  { emoji: "🙌", keywords: "raise hands celebration" },
  { emoji: "🤝", keywords: "handshake deal" },
  { emoji: "🙏", keywords: "pray thanks please folded hands" },
  { emoji: "💪", keywords: "flex strong muscle" },
  { emoji: "👀", keywords: "eyes looking see" },
  { emoji: "👋", keywords: "wave hello hi bye" },
  { emoji: "🤙", keywords: "call me shaka hang loose" },
  { emoji: "☝️", keywords: "point up one" },
  { emoji: "👉", keywords: "point right" },
  { emoji: "👈", keywords: "point left" },
  { emoji: "🫡", keywords: "salute respect" },
  { emoji: "🫶", keywords: "heart hands love" },
  { emoji: "🧠", keywords: "brain smart think" },
  { emoji: "👁️", keywords: "eye" },
  // Hearts & symbols
  { emoji: "❤️", keywords: "heart love red" },
  { emoji: "🧡", keywords: "heart orange love" },
  { emoji: "💛", keywords: "heart yellow love" },
  { emoji: "💚", keywords: "heart green love" },
  { emoji: "💙", keywords: "heart blue love" },
  { emoji: "💜", keywords: "heart purple love" },
  { emoji: "🖤", keywords: "heart black love" },
  { emoji: "🤍", keywords: "heart white love" },
  { emoji: "💔", keywords: "broken heart" },
  { emoji: "💕", keywords: "two hearts love" },
  { emoji: "💯", keywords: "hundred percent perfect" },
  { emoji: "💢", keywords: "anger symbol" },
  { emoji: "💥", keywords: "explosion boom" },
  { emoji: "✨", keywords: "sparkles stars glitter" },
  { emoji: "🎉", keywords: "party tada confetti celebrate" },
  { emoji: "🎊", keywords: "confetti celebrate" },
  { emoji: "🎈", keywords: "balloon party" },
  { emoji: "🔥", keywords: "fire hot lit flame" },
  { emoji: "⚡", keywords: "lightning bolt zap" },
  { emoji: "❄️", keywords: "snowflake cold winter" },
  { emoji: "🌈", keywords: "rainbow colorful" },
  { emoji: "⭐", keywords: "star yellow" },
  { emoji: "🌟", keywords: "glowing star" },
  { emoji: "💫", keywords: "dizzy star" },
  { emoji: "🌙", keywords: "moon night" },
  { emoji: "☀️", keywords: "sun sunny warm" },
  // Nature & animals
  { emoji: "🐶", keywords: "dog puppy" },
  { emoji: "🐱", keywords: "cat kitten" },
  { emoji: "🐭", keywords: "mouse" },
  { emoji: "🐻", keywords: "bear" },
  { emoji: "🐼", keywords: "panda" },
  { emoji: "🦊", keywords: "fox" },
  { emoji: "🐺", keywords: "wolf" },
  { emoji: "🦁", keywords: "lion" },
  { emoji: "🐸", keywords: "frog" },
  { emoji: "🐧", keywords: "penguin" },
  { emoji: "🦅", keywords: "eagle bird" },
  { emoji: "🦋", keywords: "butterfly" },
  { emoji: "🐝", keywords: "bee honey" },
  { emoji: "🌸", keywords: "cherry blossom flower" },
  { emoji: "🌿", keywords: "leaf plant green" },
  { emoji: "🌲", keywords: "tree pine evergreen" },
  { emoji: "🍄", keywords: "mushroom" },
  // Food & drink
  { emoji: "🍕", keywords: "pizza" },
  { emoji: "🍔", keywords: "burger hamburger" },
  { emoji: "🍟", keywords: "fries french" },
  { emoji: "🌮", keywords: "taco" },
  { emoji: "🌯", keywords: "burrito wrap" },
  { emoji: "🍜", keywords: "noodle ramen" },
  { emoji: "🍣", keywords: "sushi" },
  { emoji: "🍰", keywords: "cake slice" },
  { emoji: "🍩", keywords: "donut doughnut" },
  { emoji: "🍪", keywords: "cookie" },
  { emoji: "🍫", keywords: "chocolate" },
  { emoji: "🍿", keywords: "popcorn movie" },
  { emoji: "☕", keywords: "coffee hot drink" },
  { emoji: "🧋", keywords: "bubble tea boba" },
  { emoji: "🍺", keywords: "beer mug" },
  { emoji: "🥂", keywords: "champagne clink cheers" },
  { emoji: "🍷", keywords: "wine red" },
  // Objects & activities
  { emoji: "🎮", keywords: "video game controller" },
  { emoji: "🕹️", keywords: "joystick game" },
  { emoji: "🎵", keywords: "music note song" },
  { emoji: "🎶", keywords: "music notes" },
  { emoji: "🎸", keywords: "guitar music" },
  { emoji: "🎤", keywords: "microphone sing" },
  { emoji: "📷", keywords: "camera photo" },
  { emoji: "📱", keywords: "phone mobile" },
  { emoji: "💻", keywords: "laptop computer" },
  { emoji: "🖥️", keywords: "desktop computer monitor" },
  { emoji: "⌨️", keywords: "keyboard type" },
  { emoji: "🖱️", keywords: "computer mouse" },
  { emoji: "📚", keywords: "books read study" },
  { emoji: "✏️", keywords: "pencil write" },
  { emoji: "📝", keywords: "memo write note" },
  { emoji: "💡", keywords: "lightbulb idea" },
  { emoji: "🔑", keywords: "key lock" },
  { emoji: "🔒", keywords: "lock secure" },
  { emoji: "🔓", keywords: "unlock open" },
  { emoji: "🛠️", keywords: "tools wrench hammer" },
  { emoji: "⚙️", keywords: "gear settings cog" },
  { emoji: "🚀", keywords: "rocket launch space" },
  { emoji: "🛸", keywords: "ufo alien" },
  { emoji: "🏆", keywords: "trophy win winner" },
  { emoji: "🥇", keywords: "gold medal first" },
  { emoji: "🎯", keywords: "target bullseye" },
  { emoji: "🎲", keywords: "dice game" },
  { emoji: "🃏", keywords: "card joker" },
  { emoji: "♟️", keywords: "chess pawn" },
  { emoji: "⚽", keywords: "soccer football" },
  { emoji: "🏀", keywords: "basketball" },
  { emoji: "🎃", keywords: "halloween pumpkin jack" },
  { emoji: "🎄", keywords: "christmas tree" },
  { emoji: "💣", keywords: "bomb explosion" },
  { emoji: "🔮", keywords: "crystal ball magic" },
  { emoji: "💎", keywords: "gem diamond" },
  { emoji: "💰", keywords: "money bag rich" },
  { emoji: "🪙", keywords: "coin money" },
];

// Inline markdown + URL + mention combined regex
// Groups: 1=`code`, 2=**bold**, 3=__bold__, 4=*italic*, 5=_italic_,
//         6=~~strike~~, 7=URL, 8=@mention, 9=||spoiler||,
//         10=[link text], 11=link url  (from [text](url) markdown),
//         12=:custom_emoji:
const INLINE_RE =
  /(`[^`\n]+`)|\*\*([^*\n]+)\*\*|__([^_\n]+)__|\*([^*\n]+)\*|_([^_\n]+)_|~~([^~\n]+)~~|(https?:\/\/[^\s<]+[^\s<.,;:!?'")\]])|(@\w+(?:#[a-f0-9]+)?)|(\|\|[^|\n]+\|\|)|\[([^\]\n]+)\]\(([^)\s]+)\)|(:[A-Za-z0-9_]{1,32}:)/g;

let _inlineKey = 0;
function renderInline(text: string, emojis?: CustomEmojiMap): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let last = 0;
  INLINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const k = _inlineKey++;
    if (m[12]) {
      // `:name:` renders as an image only for this server's own emoji (URLs
      // from the emoji API). Otherwise keep the leading colon as text and
      // rescan from the next character so `:no:smile:` still finds `:smile:`.
      const name = parseCustomEmojiToken(m[12]);
      const url = name ? emojis?.get(name) : undefined;
      if (name && url) {
        parts.push(<CustomEmojiImage key={k} name={name} url={url} className="h-[1.375em] w-[1.375em] align-text-bottom" />);
        last = m.index + m[0].length;
      } else {
        parts.push(":");
        last = m.index + 1;
        INLINE_RE.lastIndex = last;
      }
      continue;
    }
    if (m[1]) parts.push(<code key={k} className="bg-black/30 text-[var(--accent)] px-1 py-0.5 rounded text-[0.85em] font-mono">{m[1].slice(1, -1)}</code>);
    else if (m[2]) parts.push(<strong key={k} className="font-bold">{m[2]}</strong>);
    else if (m[3]) parts.push(<strong key={k} className="font-bold">{m[3]}</strong>);
    else if (m[4]) parts.push(<em key={k} className="italic">{m[4]}</em>);
    else if (m[5]) parts.push(<em key={k} className="italic">{m[5]}</em>);
    else if (m[6]) parts.push(<del key={k} className="line-through opacity-60">{m[6]}</del>);
    else if (m[7]) parts.push(<a key={k} href={m[7]} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] underline-offset-2 hover:underline break-all">{m[7]}</a>);
    else if (m[8]) parts.push(<span key={k} className="bg-[var(--accent)]/15 text-[var(--accent)] rounded px-1 font-medium">{m[8]}</span>);
    else if (m[9]) parts.push(<SpoilerText key={k}>{m[9].slice(2, -2)}</SpoilerText>);
    else if (m[10]) {
      // [text](url) markdown — only allow safe schemes; never render javascript: etc.
      const href = m[11] ?? "";
      if (/^(https?:|mailto:)/i.test(href)) {
        parts.push(<a key={k} href={href} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] underline-offset-2 hover:underline break-all">{m[10]}</a>);
      } else {
        parts.push(m[0]);
      }
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length === 1 && typeof parts[0] === "string" ? parts[0] : <>{parts}</>;
}

function renderContent(text: string, emojis?: CustomEmojiMap): React.ReactNode {
  // Extract ``` code blocks first
  const CODE_BLOCK_RE = /```([^`]*)```/g;
  const segments: Array<{ isBlock: boolean; content: string }> = [];
  let last = 0;
  let bm: RegExpExecArray | null;
  CODE_BLOCK_RE.lastIndex = 0;
  while ((bm = CODE_BLOCK_RE.exec(text)) !== null) {
    if (bm.index > last) segments.push({ isBlock: false, content: text.slice(last, bm.index) });
    segments.push({ isBlock: true, content: bm[1] });
    last = bm.index + bm[0].length;
  }
  if (last < text.length) segments.push({ isBlock: false, content: text.slice(last) });

  const nodes: React.ReactNode[] = [];
  segments.forEach((seg, si) => {
    if (seg.isBlock) {
      nodes.push(
        <pre key={si} className="bg-black/40 border border-[var(--accent-2)]/20 rounded p-2 text-xs font-mono overflow-x-auto my-1 whitespace-pre text-[var(--text)]">
          <code>{seg.content.replace(/^\n/, "").replace(/\n$/, "")}</code>
        </pre>
      );
      return;
    }
    // Split by newline; handle blockquotes
    const lines = seg.content.split("\n");
    lines.forEach((line, li) => {
      const isLastLine = li === lines.length - 1;
      if (line.startsWith("> ")) {
        nodes.push(
          <span key={`${si}-${li}`} className="flex border-l-[3px] border-[var(--accent-2)] pl-2 my-0.5 text-[var(--muted)] italic">
            {renderInline(line.slice(2), emojis)}
          </span>
        );
      } else {
        nodes.push(<span key={`${si}-${li}`}>{renderInline(line, emojis)}</span>);
        if (!isLastLine) nodes.push(<br key={`br-${si}-${li}`} />);
      }
    });
  });

  return <>{nodes}</>;
}

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

export interface MessageBubbleMessage {
  id: string;
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
  isSystem?: boolean;
  pending?: boolean;
}

interface MessageBubbleProps {
  message: MessageBubbleMessage;
  isOwn: boolean;
  currentUserId?: string;
  authorColor?: string | null;
  /** Moderator+: may pin and delete other people's messages. */
  canPin?: boolean;
  /** Continuation of the previous message's author group — no avatar/name row. */
  compact?: boolean;
  /** The message @mentions the viewer. */
  mentionsMe?: boolean;
  /**
   * Controlled edit mode. When `onEditingChange` is passed the parent owns the
   * editing flag (so ↑ in the composer can open the editor for a message).
   */
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
  onEdit?: (messageId: string, newContent: string) => void;
  onDelete?: (messageId: string) => void;
  onReact?: (messageId: string, emoji: string) => void;
  onReply?: (message: MessageBubbleMessage) => void;
  onScrollToMessage?: (messageId: string) => void;
  onPin?: (messageId: string, pinned: boolean) => void;
  onThread?: (messageId: string, author: { id: string; username: string }) => void;
  onBookmark?: (messageId: string, bookmarked: boolean) => void;
  onJournal?: (messageId: string) => void;
  onTranslate?: (messageId: string, text: string) => void | Promise<void>;
  translatedText?: string | null;
  isBookmarked?: boolean;
  highlighted?: boolean;
  blocked?: boolean;
  replyAuthorBlocked?: boolean;
  /** This server's custom emoji (name -> URL from the emoji API). Absent in DMs. */
  customEmojis?: CustomEmojiMap;
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (date.getTime() >= startOfToday) return `Today at ${time}`;
  if (date.getTime() >= startOfToday - 24 * 60 * 60 * 1000) return `Yesterday at ${time}`;
  return `${date.toLocaleDateString()} ${time}`;
}

interface ActionButtonProps {
  label: string;
  icon: ChatIconName;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  active?: boolean;
  filled?: boolean;
  danger?: boolean;
  disabled?: boolean;
  expanded?: boolean;
}

function ActionButton({ label, icon, onClick, active, filled, danger, disabled, expanded }: ActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-expanded={expanded}
      className={`flex h-8 w-8 items-center justify-center rounded transition-colors hover:bg-[var(--panel-2)] disabled:opacity-40 ${
        active ? "text-[var(--accent)]" : "text-[var(--muted)]"
      } ${danger ? "hover:text-[var(--danger)]" : "hover:text-[var(--text)]"}`}
    >
      <ChatIcon name={icon} size={18} filled={filled} />
    </button>
  );
}

/** Inline editor: Enter saves, Shift+Enter adds a line, Escape cancels. */
function MessageEditor({ initial, onSave, onCancel }: { initial: string; onSave: (content: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [value]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  function save() {
    const trimmed = value.trim();
    if (!trimmed || trimmed === initial.trim()) {
      onCancel();
      return;
    }
    onSave(trimmed);
  }

  return (
    <div className="mt-1">
      <textarea
        ref={ref}
        value={value}
        rows={1}
        aria-label="Edit message"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          } else if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            save();
          }
        }}
        className="w-full resize-none overflow-y-auto rounded-lg border border-[var(--accent-2)]/50 bg-[var(--panel)] px-3 py-2 text-sm leading-relaxed text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
      />
      <div className="mt-1 text-[11px] text-[var(--muted)]">
        escape to{" "}
        <button type="button" onClick={onCancel} className="text-[var(--accent)] hover:underline">
          cancel
        </button>
        {" "}· enter to{" "}
        <button type="button" onClick={save} className="text-[var(--accent)] hover:underline">
          save
        </button>
        {" "}· shift+enter for a new line
      </div>
    </div>
  );
}

export default function MessageBubble({
  message,
  isOwn,
  currentUserId,
  authorColor,
  canPin,
  compact = false,
  mentionsMe = false,
  editing: editingProp,
  onEditingChange,
  onEdit,
  onDelete,
  onReact,
  onReply,
  onScrollToMessage,
  onPin,
  onThread,
  onBookmark,
  onJournal,
  onTranslate,
  translatedText,
  isBookmarked,
  highlighted,
  blocked = false,
  replyAuthorBlocked = false,
  customEmojis,
}: MessageBubbleProps) {
  const [localEditing, setLocalEditing] = useState(false);
  const editing = onEditingChange ? Boolean(editingProp) : localEditing;
  function setEditing(next: boolean) {
    if (onEditingChange) onEditingChange(next);
    else setLocalEditing(next);
  }
  const [glowing, setGlowing] = useState(false);

  useEffect(() => {
    const showTimer = setTimeout(() => setGlowing(Boolean(highlighted)), 0);
    const hideTimer = highlighted
      ? setTimeout(() => setGlowing(false), 2000)
      : undefined;
    return () => {
      clearTimeout(showTimer);
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, [highlighted]);

  const [showActions, setShowActions] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [emojiSearch, setEmojiSearch] = useState("");
  const [profileCard, setProfileCard] = useState<{ x: number; y: number } | null>(null);
  const [lightbox, setLightbox] = useState<{ src: string; allSrcs: string[] } | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [reporting, setReporting] = useState(false);
  const [translating, setTranslating] = useState(false);

  const isPending = Boolean(message.pending) || message.id.startsWith("pending-");
  const canEdit = isOwn && Boolean(onEdit) && !isPending && !message.poll;
  const canDelete = Boolean(onDelete) && (isOwn || Boolean(canPin)) && !isPending;
  const canReport = !isOwn && !isPending && Boolean(currentUserId);

  async function handleTranslate() {
    if (!onTranslate || translating) return;
    setTranslating(true);
    try {
      await onTranslate(message.id, message.content);
    } finally {
      setTranslating(false);
    }
  }

  const shown = truncateName(message.author.username, 20);
  const authorLabel = displayName(message.author.username);
  const created = new Date(message.createdAt);
  const shortTime = created.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const fullTime = created.toLocaleString();
  // Only a real content edit counts — pinning also bumps updatedAt.
  const wasEdited = Boolean(message.editedAt);
  const reactions = message.reactions || {};
  const reactionEntries = Object.entries(reactions);

  function handleSaveEdit(content: string) {
    onEdit?.(message.id, content);
    setEditing(false);
  }

  function requestDelete(e?: React.MouseEvent) {
    // Discord-style: Shift+click deletes without the confirmation step.
    if (e?.shiftKey) {
      onDelete?.(message.id);
      return;
    }
    setShowDeleteConfirm(true);
  }

  function openMoreMenu(e: React.MouseEvent<HTMLButtonElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    setContextMenu({ x: Math.max(8, rect.right - 200), y: rect.bottom + 4 });
  }

  function handleReact(emoji: string) {
    onReact?.(message.id, emoji);
    setShowEmojiPicker(false);
    setEmojiSearch("");
  }

  const filteredEmojis = emojiSearch.trim()
    ? EMOJI_DATA.filter(({ emoji, keywords }) =>
        keywords.includes(emojiSearch.toLowerCase()) ||
        emoji === emojiSearch
      )
    : EMOJI_DATA;
  const filteredCustomEmojis = customEmojis
    ? [...customEmojis].filter(([name]) => name.toLowerCase().includes(emojiSearch.trim().toLowerCase()))
    : [];

  if (message.isSystem) {
    return (
      <BlockedMessageGate blocked={blocked} className="px-4 py-2">
        <div className="flex items-center gap-3 py-1 px-4 my-1">
          <div className="flex-1 h-px bg-[var(--accent-2)]/20" />
          <span className="text-xs text-[var(--muted)] italic shrink-0">{message.content}</span>
          <div className="flex-1 h-px bg-[var(--accent-2)]/20" />
        </div>
      </BlockedMessageGate>
    );
  }

  const rowBackground = mentionsMe
    ? "bg-[var(--accent)]/10 shadow-[inset_2px_0_0_0_var(--accent)]"
    : showActions || contextMenu
      ? "bg-[var(--panel)]/40"
      : "hover:bg-[var(--panel)]/40";

  return (
    <BlockedMessageGate blocked={blocked} className="px-4 py-2">
      <div
        className={`group relative flex gap-4 px-4 transition-colors ${compact ? "py-0.5" : "mt-3 pt-1 pb-0.5"} ${rowBackground} ${isPending ? "opacity-60" : ""} ${glowing ? "animate-search-highlight" : ""}`}
        onMouseEnter={() => setShowActions(true)}
        // Keyboard users: tabbing into the message reveals the hover-only action bar.
        onFocus={() => setShowActions(true)}
        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setShowActions(false); }}
        onMouseLeave={() => { setShowActions(false); setShowEmojiPicker(false); setEmojiSearch(""); }}
        onContextMenu={(e) => {
          if (isPending) return;
          e.preventDefault();
          e.stopPropagation();
          setContextMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        {/* Gutter: avatar on the first message of a group, hover time on the rest */}
        <div className="w-10 shrink-0">
          {compact ? (
            <time
              dateTime={message.createdAt}
              title={fullTime}
              className={`block select-none pt-0.5 text-right text-[10px] leading-5 text-[var(--muted)] transition-opacity ${showActions ? "opacity-100" : "opacity-0"}`}
            >
              {shortTime}
            </time>
          ) : (
            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => setProfileCard({ x: e.clientX, y: e.clientY })}
              className="mt-0.5 block rounded-full"
              aria-label={`View ${authorLabel}'s profile`}
            >
              <Avatar
                username={message.author.username}
                avatarUrl={message.author.avatar}
                size={40}
                className="bg-[var(--accent-2)] text-[var(--text)]"
              />
            </button>
          )}
        </div>

        <div className="flex-1 min-w-0">
          {!compact && (
            <div className="flex items-baseline gap-2 leading-snug">
              <button
                type="button"
                onClick={(e) => setProfileCard({ x: e.clientX, y: e.clientY })}
                className={`font-semibold text-sm hover:underline cursor-pointer ${isOwn ? "text-[var(--accent)]" : "text-[var(--text)]"}`}
                style={authorColor ? { color: authorColor } : undefined}
                title={authorLabel}
              >
                {shown}
              </button>
              <time dateTime={message.createdAt} title={fullTime} className="text-xs text-[var(--muted)]">
                {formatTimestamp(message.createdAt)}
              </time>
              {message.pinned && (
                <span className="self-center text-[var(--accent)]" title="Pinned message">
                  <ChatIcon name="pin" size={12} />
                  <span className="sr-only">Pinned</span>
                </span>
              )}
            </div>
          )}

          {/* Reply quote */}
          {message.replyTo && (
            <button
              type="button"
              onClick={() => onScrollToMessage?.(message.replyTo!.id)}
              className="flex items-start gap-1.5 mb-1 pl-2 border-l-2 border-[var(--accent-2)] text-left hover:border-[var(--accent)] transition-colors group/reply"
            >
              <span className="text-xs text-[var(--muted)] group-hover/reply:text-[var(--text)] transition-colors truncate max-w-[320px]">
                {replyAuthorBlocked ? (
                  <span className="italic">Blocked message</span>
                ) : (
                  <>
                    <span className="font-medium text-[var(--accent-2)] group-hover/reply:text-[var(--accent)]">
                      {displayName(message.replyTo.author.username)}
                    </span>
                    {" "}
                    {message.replyTo.content ? message.replyTo.content.slice(0, 80) + (message.replyTo.content.length > 80 ? "…" : "") : "attachment"}
                  </>
                )}
              </span>
            </button>
          )}

          {editing ? (
            <MessageEditor initial={message.content} onSave={handleSaveEdit} onCancel={() => setEditing(false)} />
          ) : (
            <>
              {message.content && (
                <div className="text-[var(--text)] text-sm leading-relaxed break-words">
                  {renderContent(message.content, customEmojis)}
                  {wasEdited && (
                    <span
                      className="ml-1 select-none text-[10px] text-[var(--muted)]"
                      title={`Edited ${new Date(message.editedAt!).toLocaleString()}`}
                    >
                      (edited)
                    </span>
                  )}
                  {compact && message.pinned && (
                    <span className="ml-1 inline-block align-middle text-[var(--accent)]" title="Pinned message">
                      <ChatIcon name="pin" size={11} />
                      <span className="sr-only">Pinned</span>
                    </span>
                  )}
                </div>
              )}
              {translatedText && (
                <div className="mt-1 px-2 py-1 bg-[var(--accent-2)]/10 border-l-2 border-[var(--accent-2)] rounded-r text-sm text-[var(--text)] italic">
                  <span className="text-[10px] text-[var(--muted)] uppercase font-semibold block mb-0.5 not-italic">Translation</span>
                  {translatedText}
                </div>
              )}
              {message.content && extractUrls(message.content).map((url) => (
                <LinkPreview key={url} url={url} />
              ))}
              {message.attachmentUrl && (
                <AttachmentPreview
                  url={message.attachmentUrl}
                  name={message.attachmentName}
                  onOpenLightbox={(src) => {
                    const all = Array.from(document.querySelectorAll<HTMLImageElement>("[data-lightbox-src]"))
                      .map((el) => el.getAttribute("data-lightbox-src")!)
                      .filter(Boolean);
                    setLightbox({ src, allSrcs: all.length > 0 ? all : [src] });
                  }}
                />
              )}
              {message.poll && (
                <PollCard
                  initialPoll={message.poll}
                  currentUserId={currentUserId}
                  canClose={isOwn || canPin}
                />
              )}
            </>
          )}

          {/* Thread reply count */}
          {!message.parentMessageId && (message.replyCount ?? 0) > 0 && onThread && (
            <button
              type="button"
              onClick={() => onThread(message.id, message.author)}
              className="mt-1 inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/10"
            >
              <ChatIcon name="thread" size={12} />
              {message.replyCount} {message.replyCount === 1 ? "reply" : "replies"}
            </button>
          )}

          {/* Reaction badges */}
          {reactionEntries.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {reactionEntries.map(([emoji, data]) => {
                const iMine = currentUserId ? data.userIds.includes(currentUserId) : false;
                return (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => handleReact(emoji)}
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs transition-colors ${
                      iMine
                        ? "bg-[var(--accent)]/20 border border-[var(--accent)]/50 text-[var(--text)]"
                        : "bg-[var(--panel-2)] border border-[var(--accent-2)]/30 text-[var(--muted)] hover:border-[var(--accent-2)]"
                    }`}
                    title={data.users.map((u) => displayName(u)).join(", ")}
                    aria-label={`${emoji} ${data.count} ${data.count === 1 ? "reaction" : "reactions"}`}
                    aria-pressed={iMine}
                  >
                    <ReactionEmoji emoji={emoji} customEmojis={customEmojis} />
                    <span className="font-medium">{data.count}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Hover action bar — top-right of the hovered row */}
        {showActions && !editing && !isPending && (
          <div
            role="toolbar"
            aria-label="Message actions"
            className="absolute right-4 -top-4 z-10 flex items-center rounded-md border border-[var(--accent-2)]/30 bg-[var(--panel)] p-0.5 shadow-lg"
          >
            {onReact && (
              <ActionButton
                label="Add reaction"
                icon="smile"
                active={showEmojiPicker}
                expanded={showEmojiPicker}
                onClick={() => setShowEmojiPicker((open) => !open)}
              />
            )}
            {onReply && <ActionButton label="Reply" icon="reply" onClick={() => onReply(message)} />}
            {!message.parentMessageId && onThread && (
              <ActionButton
                label={(message.replyCount ?? 0) > 0 ? "Open thread" : "Start thread"}
                icon="thread"
                onClick={() => onThread(message.id, message.author)}
              />
            )}
            {canEdit && <ActionButton label="Edit" icon="edit" onClick={() => setEditing(true)} />}
            {onBookmark && (
              <ActionButton
                label={isBookmarked ? "Remove from Saved" : "Save message"}
                icon="bookmark"
                active={isBookmarked}
                filled={isBookmarked}
                onClick={() => onBookmark(message.id, !isBookmarked)}
              />
            )}
            {canDelete && (
              <ActionButton
                label={isOwn ? "Delete" : "Delete (moderator)"}
                icon="trash"
                danger
                onClick={requestDelete}
              />
            )}
            <ActionButton label="More actions" icon="more" active={Boolean(contextMenu)} onClick={openMoreMenu} />
          </div>
        )}

        {/* Searchable emoji picker */}
        {showEmojiPicker && (
          <div
            className="absolute right-4 top-6 bg-[var(--panel)] border border-[var(--accent-2)]/30 rounded-lg shadow-xl z-20 flex flex-col"
            style={{ width: 272 }}
            onMouseLeave={(e) => e.stopPropagation()}
          >
            <div className="px-2 pt-2 pb-1">
              <input
                type="text"
                value={emojiSearch}
                onChange={(e) => setEmojiSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setShowEmojiPicker(false); } }}
                placeholder="Search emoji..."
                aria-label="Search emoji"
                autoFocus
                className="w-full text-xs px-2 py-1 bg-[var(--panel-2)] text-[var(--text)] border border-[var(--accent-2)]/50 rounded focus:outline-none focus:border-[var(--accent-2)]"
                onMouseDown={(e) => e.stopPropagation()}
              />
            </div>
            <div className="overflow-y-auto px-1 pb-1.5" style={{ maxHeight: 200 }}>
              {filteredCustomEmojis.length > 0 && (
                <>
                  <p className="px-1 pb-0.5 text-[10px] font-semibold uppercase text-[var(--muted)]">This server</p>
                  <div className="grid grid-cols-8 gap-0.5 mb-1">
                    {filteredCustomEmojis.map(([name, url]) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => handleReact(`:${name}:`)}
                        className="flex items-center justify-center p-1 rounded hover:bg-[var(--panel-2)] transition-colors"
                        aria-label={`:${name}:`}
                      >
                        <CustomEmojiImage name={name} url={url} size={22} className="h-[22px] w-[22px]" />
                      </button>
                    ))}
                  </div>
                </>
              )}
              {filteredEmojis.length === 0 && filteredCustomEmojis.length === 0 ? (
                <p className="text-xs text-[var(--muted)] text-center py-3">No results</p>
              ) : (
                <div className="grid grid-cols-8 gap-0.5">
                  {filteredEmojis.map(({ emoji }) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => handleReact(emoji)}
                      className="text-lg p-1 rounded hover:bg-[var(--panel-2)] transition-colors leading-none"
                      title={emoji}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {showDeleteConfirm && (
        <PromptDialog
          mode="confirm"
          destructive
          title="Delete message"
          message={`${isOwn ? "Delete this message?" : `Delete this message from ${authorLabel}?`} This can't be undone. Tip: hold Shift when clicking delete to skip this step.`}
          confirmLabel="Delete"
          onConfirm={() => {
            setShowDeleteConfirm(false);
            onDelete?.(message.id);
          }}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}

      {reporting && (
        <ReportDialog
          targetUserId={message.author.id}
          targetName={authorLabel}
          messageId={message.id}
          onClose={() => setReporting(false)}
        />
      )}

      {contextMenu && (
        <MessageContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          message={message}
          currentUserId={currentUserId ?? ""}
          canPin={Boolean(canPin && onPin)}
          onReply={() => onReply?.(message)}
          onEdit={canEdit ? () => setEditing(true) : undefined}
          onDelete={canDelete ? () => setShowDeleteConfirm(true) : undefined}
          onPin={(pinned) => onPin?.(message.id, pinned)}
          onReact={(emoji) => onReact?.(message.id, emoji)}
          onCopyText={() => {
            navigator.clipboard.writeText(message.content).then(
              () => toast("Copied to clipboard", "success"),
              () => toast("Couldn't copy to the clipboard", "error"),
            );
          }}
          onBookmark={() => onBookmark?.(message.id, !isBookmarked)}
          isBookmarked={isBookmarked}
          onJournal={onJournal ? () => onJournal(message.id) : undefined}
          onTranslate={onTranslate ? () => { void handleTranslate(); } : undefined}
          onReport={canReport ? () => setReporting(true) : undefined}
          customEmojis={customEmojis}
          onClose={() => setContextMenu(null)}
        />
      )}

      {profileCard && (
        <ProfileCard
          username={message.author.username}
          avatar={message.author.avatar}
          anchorX={profileCard.x}
          anchorY={profileCard.y}
          onClose={() => setProfileCard(null)}
        />
      )}
      {lightbox && (
        <ImageLightbox
          src={lightbox.src}
          allSrcs={lightbox.allSrcs}
          onClose={() => setLightbox(null)}
          onNavigate={(src) => setLightbox((prev) => prev ? { ...prev, src } : null)}
        />
      )}
    </BlockedMessageGate>
  );
}

/** A reaction key: a custom `:name:` emoji renders as its image, anything else as text. */
function ReactionEmoji({ emoji, customEmojis }: { emoji: string; customEmojis?: CustomEmojiMap }) {
  const name = parseCustomEmojiToken(emoji);
  const url = name ? customEmojis?.get(name) : undefined;
  if (name && url) return <CustomEmojiImage name={name} url={url} size={16} className="h-4 w-4" />;
  return <span>{emoji}</span>;
}

export function AttachmentPreview({ url, name, onOpenLightbox }: { url: string; name?: string | null; onOpenLightbox: (src: string) => void }) {
  const fileName = name || url.split("/").pop() || "file";
  const fileType = getFileType(fileName);

  if (fileType === "image") {
    return (
      <button
        type="button"
        onClick={() => onOpenLightbox(url)}
        className="block mt-1 text-left cursor-pointer"
      >
        <Image
          src={url}
          alt={fileName}
          width={400}
          height={300}
          unoptimized
          data-lightbox-src={url}
          style={{ maxHeight: 300, maxWidth: 400, width: "auto", height: "auto" }}
          className="rounded-lg border border-[var(--accent-2)]/30 object-cover hover:opacity-80 transition-opacity cursor-pointer"
        />
      </button>
    );
  }

  if (fileType === "video") {
    return (
      <video
        controls
        style={{ maxWidth: 400 }}
        className="rounded mt-1 border border-[var(--accent-2)]/30"
      >
        <source src={url} />
      </video>
    );
  }

  if (fileType === "audio") {
    return (
      <div className="mt-1 w-full max-w-xs rounded-lg border border-[var(--accent-2)]/30 bg-[var(--panel)] px-3 py-2">
        {isCampfireVoiceNote(fileName) && (
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent-2)]">
            🔥 {VOICE_NOTE_LABEL}
          </div>
        )}
        <audio controls preload="metadata" className="w-full">
          <source src={url} />
        </audio>
      </div>
    );
  }

  // Generic file download card
  return (
    <div className="mt-1 inline-flex items-center gap-2 px-3 py-2 bg-[var(--panel)] border border-[var(--accent-2)]/30 rounded-lg text-sm text-[var(--text)]">
      <span className="shrink-0">📄</span>
      <span className="truncate max-w-[200px] text-[var(--text)]">{fileName}</span>
      <a
        href={url}
        download={fileName}
        className="shrink-0 text-[var(--accent)] hover:text-[var(--accent-2)] transition-colors"
        title="Download"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      </a>
    </div>
  );
}
