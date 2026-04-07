"use client";

import { useState, useEffect } from "react";
import { displayName, truncateName } from "@/lib/utils";
import Avatar from "@/components/Avatar";
import ProfileCard from "@/components/ProfileCard";
import ImageLightbox from "@/components/ImageLightbox";

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
// Groups: 1=`code`, 2=**bold**, 3=bold-inner, 4=__bold__, 5=bold-inner2,
//         6=*italic*, 7=italic-inner, 8=_italic_, 9=italic-inner2,
//         10=~~strike~~, 11=strike-inner, 12=URL, 13=@mention
const INLINE_RE =
  /(`[^`\n]+`)|\*\*([^*\n]+)\*\*|__([^_\n]+)__|\*([^*\n]+)\*|_([^_\n]+)_|~~([^~\n]+)~~|(https?:\/\/[^\s<]+[^\s<.,;:!?'")\]])|(@\w+(?:#[a-f0-9]+)?)/g;

let _inlineKey = 0;
function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let last = 0;
  INLINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const k = _inlineKey++;
    if (m[1]) parts.push(<code key={k} className="bg-black/30 text-green-300 px-1 py-0.5 rounded text-[11px] font-mono">{m[1].slice(1, -1)}</code>);
    else if (m[2]) parts.push(<strong key={k} className="font-bold">{m[2]}</strong>);
    else if (m[3]) parts.push(<strong key={k} className="font-bold">{m[3]}</strong>);
    else if (m[4]) parts.push(<em key={k} className="italic">{m[4]}</em>);
    else if (m[5]) parts.push(<em key={k} className="italic">{m[5]}</em>);
    else if (m[6]) parts.push(<del key={k} className="line-through opacity-60">{m[6]}</del>);
    else if (m[7]) parts.push(<a key={k} href={m[7]} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline break-all">{m[7]}</a>);
    else if (m[8]) parts.push(<span key={k} className="bg-blue-500/20 text-blue-300 rounded px-1 font-medium">{m[8]}</span>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length === 1 && typeof parts[0] === "string" ? parts[0] : <>{parts}</>;
}

function renderContent(text: string): React.ReactNode {
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
        <pre key={si} className="bg-black/40 border border-[var(--accent-2)]/20 rounded p-2 text-xs font-mono overflow-x-auto my-1 whitespace-pre text-green-300">
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
            {renderInline(line.slice(2))}
          </span>
        );
      } else {
        nodes.push(<span key={`${si}-${li}`}>{renderInline(line)}</span>);
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

interface MessageBubbleProps {
  message: {
    id: string;
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
  };
  isOwn: boolean;
  currentUserId?: string;
  canPin?: boolean;
  onEdit?: (messageId: string, newContent: string) => void;
  onDelete?: (messageId: string) => void;
  onReact?: (messageId: string, emoji: string) => void;
  onReply?: (message: MessageBubbleProps["message"]) => void;
  onScrollToMessage?: (messageId: string) => void;
  onPin?: (messageId: string, pinned: boolean) => void;
  onThread?: (messageId: string, author: { id: string; username: string }) => void;
  highlighted?: boolean;
}

export default function MessageBubble({ message, isOwn, currentUserId, canPin, onEdit, onDelete, onReact, onReply, onScrollToMessage, onPin, onThread, highlighted }: MessageBubbleProps) {
  const [editing, setEditing] = useState(false);
  const [glowing, setGlowing] = useState(false);

  useEffect(() => {
    if (highlighted) {
      setGlowing(true);
      const t = setTimeout(() => setGlowing(false), 2000);
      return () => clearTimeout(t);
    }
  }, [highlighted]);

  const [editContent, setEditContent] = useState(message.content);
  const [showActions, setShowActions] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [emojiSearch, setEmojiSearch] = useState("");
  const [profileCard, setProfileCard] = useState<{ x: number; y: number } | null>(null);
  const [lightbox, setLightbox] = useState<{ src: string; allSrcs: string[] } | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const shown = truncateName(message.author.username, 20);

  const time = new Date(message.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  const wasEdited = message.updatedAt && message.updatedAt !== message.createdAt;
  const reactions = message.reactions || {};
  const reactionEntries = Object.entries(reactions);

  function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editContent.trim() || editContent.trim() === message.content) {
      setEditing(false);
      setEditContent(message.content);
      return;
    }
    onEdit?.(message.id, editContent.trim());
    setEditing(false);
  }

  function handleEditKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setEditing(false);
      setEditContent(message.content);
    }
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

  return (
    <div
      className={`flex gap-3 py-1 group hover:bg-[var(--panel)]/30 px-1 rounded relative ${glowing ? "animate-search-highlight" : ""}`}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => { setShowActions(false); setShowEmojiPicker(false); setEmojiSearch(""); }}
    >
      <Avatar
        username={message.author.username}
        avatarUrl={message.author.avatar}
        size={40}
        className="bg-[var(--accent-2)] text-[var(--text)] mt-0.5"
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <button
            type="button"
            onClick={(e) => setProfileCard({ x: e.clientX, y: e.clientY })}
            className={`font-semibold text-sm hover:underline cursor-pointer ${isOwn ? "text-[var(--accent)]" : "text-[var(--text)]"}`}
            title={displayName(message.author.username)}
          >
            {shown}
          </button>
          <span className="group/ts relative cursor-default">
            <span className="text-xs text-[var(--muted)]">{time}</span>
            <span className="absolute bottom-full left-0 mb-1 px-2 py-1 text-xs bg-black/90 text-white rounded whitespace-nowrap opacity-0 group-hover/ts:opacity-100 transition-opacity pointer-events-none z-10">
              {new Date(message.createdAt).toLocaleString()}
              {wasEdited && ` (edited at ${new Date(message.updatedAt!).toLocaleString()})`}
            </span>
          </span>
          {wasEdited && <span className="text-xs text-[var(--muted)] italic">(edited)</span>}
        </div>

        {/* Reply quote */}
        {message.replyTo && (
          <button
            onClick={() => onScrollToMessage?.(message.replyTo!.id)}
            className="flex items-start gap-1.5 mb-1 pl-2 border-l-2 border-[var(--accent-2)] text-left hover:border-[var(--accent)] transition-colors group/reply"
          >
            <span className="text-xs text-[var(--muted)] group-hover/reply:text-[var(--text)] transition-colors truncate max-w-[320px]">
              <span className="font-medium text-[var(--accent-2)] group-hover/reply:text-[var(--accent)]">
                {displayName(message.replyTo.author.username)}
              </span>
              {" "}
              {message.replyTo.content ? message.replyTo.content.slice(0, 80) + (message.replyTo.content.length > 80 ? "…" : "") : "attachment"}
            </span>
          </button>
        )}

        {editing ? (
          <form onSubmit={handleEditSubmit} className="mt-1">
            <input
              type="text"
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              onKeyDown={handleEditKeyDown}
              className="w-full px-2 py-1 bg-[var(--panel)] text-[var(--text)] border border-[var(--accent-2)] rounded text-sm focus:outline-none"
              autoFocus
            />
            <div className="flex gap-2 mt-1 text-xs text-[var(--muted)]">
              <span>Esc to cancel</span>
              <span>Enter to save</span>
            </div>
          </form>
        ) : (
          <>
            {message.content && (
              <div className="text-[var(--text)] text-sm break-words">{renderContent(message.content)}</div>
            )}
            {message.attachmentUrl && (
              <Attachment
                url={message.attachmentUrl}
                name={message.attachmentName}
                onImageClick={(src) => {
                  const all = Array.from(document.querySelectorAll<HTMLImageElement>("[data-lightbox-src]"))
                    .map((el) => el.getAttribute("data-lightbox-src")!)
                    .filter(Boolean);
                  setLightbox({ src, allSrcs: all.length > 0 ? all : [src] });
                }}
              />
            )}
          </>
        )}

        {/* Thread reply count */}
        {!message.parentMessageId && (message.replyCount ?? 0) > 0 && (
          <button
            onClick={() => onThread?.(message.id, message.author)}
            className="mt-1 text-xs text-[var(--accent-2)] hover:text-[var(--accent)] hover:underline"
          >
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
                  onClick={() => handleReact(emoji)}
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs transition-colors ${
                    iMine
                      ? "bg-[var(--accent)]/20 border border-[var(--accent)]/50 text-[var(--text)]"
                      : "bg-[var(--panel-2)] border border-[var(--accent-2)]/30 text-[var(--muted)] hover:border-[var(--accent-2)]"
                  }`}
                  title={data.users.map((u) => displayName(u)).join(", ")}
                >
                  <span>{emoji}</span>
                  <span className="font-medium">{data.count}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Pinned indicator */}
      {message.pinned && (
        <div className="absolute left-1 top-0 text-yellow-400 text-xs px-1 py-0.5 opacity-70" title="Pinned message">📌</div>
      )}

      {/* Action buttons — show on hover */}
      {showActions && !editing && (
        <div className="absolute right-1 top-0 flex gap-0.5 bg-[var(--panel)] border border-[var(--accent-2)]/30 rounded px-0.5 py-0.5 shadow-lg z-10">
          <button
            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
            className="text-xs text-[var(--muted)] hover:text-[var(--text)] px-1.5 py-0.5"
            title="React"
          >
            😀
          </button>
          <button
            onClick={() => onReply?.(message)}
            className="text-xs text-[var(--muted)] hover:text-[var(--text)] px-1.5 py-0.5"
            title="Reply"
          >
            ↩
          </button>
          {canPin && (
            <button
              onClick={() => onPin?.(message.id, !message.pinned)}
              className={`text-xs px-1.5 py-0.5 ${message.pinned ? "text-yellow-400 hover:text-[var(--muted)]" : "text-[var(--muted)] hover:text-yellow-400"}`}
              title={message.pinned ? "Unpin" : "Pin"}
            >
              📌
            </button>
          )}
          {!message.parentMessageId && onThread && (
            <button
              onClick={() => onThread(message.id, message.author)}
              className="text-xs text-[var(--muted)] hover:text-[var(--text)] px-1.5 py-0.5"
              title="Start Thread"
            >
              Thread
            </button>
          )}
          {isOwn && (
            <>
              <button
                onClick={() => { setEditing(true); setEditContent(message.content); }}
                className="text-xs text-[var(--muted)] hover:text-[var(--text)] px-1.5 py-0.5"
                title="Edit"
              >
                Edit
              </button>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="text-xs text-[var(--muted)] hover:text-[var(--danger)] px-1.5 py-0.5"
                title="Delete"
              >
                Delete
              </button>
            </>
          )}
        </div>
      )}

      {/* Delete confirmation dialog */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={() => setShowDeleteConfirm(false)}>
          <div
            className="bg-[var(--panel)] border border-[var(--danger)]/40 rounded-lg shadow-2xl p-5 w-80 flex flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="font-semibold text-[var(--text)]">Delete Message</p>
            <p className="text-sm text-[var(--muted)]">Are you sure you want to delete this message? This cannot be undone.</p>
            {message.content && (
              <p className="text-xs text-[var(--muted)] italic bg-[var(--panel-2)] rounded px-2 py-1.5 border-l-2 border-[var(--danger)] truncate">
                {message.content.slice(0, 100)}
              </p>
            )}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-1.5 text-sm text-[var(--text)] bg-[var(--panel-2)] rounded hover:bg-[var(--accent-2)]/30 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { onDelete?.(message.id); setShowDeleteConfirm(false); }}
                className="px-4 py-1.5 text-sm text-white bg-[var(--danger)] rounded hover:opacity-90 transition-opacity font-semibold"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Searchable emoji picker */}
      {showEmojiPicker && (
        <div
          className="absolute right-1 top-7 bg-[var(--panel)] border border-[var(--accent-2)]/30 rounded-lg shadow-xl z-20 flex flex-col"
          style={{ width: 272 }}
          onMouseLeave={(e) => e.stopPropagation()}
        >
          <div className="px-2 pt-2 pb-1">
            <input
              type="text"
              value={emojiSearch}
              onChange={(e) => setEmojiSearch(e.target.value)}
              placeholder="Search emoji..."
              autoFocus
              className="w-full text-xs px-2 py-1 bg-[var(--panel-2)] text-[var(--text)] border border-[var(--accent-2)]/50 rounded focus:outline-none focus:border-[var(--accent-2)]"
              onMouseDown={(e) => e.stopPropagation()}
            />
          </div>
          <div className="overflow-y-auto px-1 pb-1.5" style={{ maxHeight: 200 }}>
            {filteredEmojis.length === 0 ? (
              <p className="text-xs text-[var(--muted)] text-center py-3">No results</p>
            ) : (
              <div className="grid grid-cols-8 gap-0.5">
                {filteredEmojis.map(({ emoji }) => (
                  <button
                    key={emoji}
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
    </div>
  );
}

function Attachment({ url, name, onImageClick }: { url: string; name?: string | null; onImageClick?: (src: string) => void }) {
  const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(url);
  const displayName = name || url.split("/").pop() || "file";

  if (isImage) {
    return (
      <button
        type="button"
        onClick={() => onImageClick?.(url)}
        className="block mt-1 text-left"
      >
        <img
          src={url}
          alt={displayName}
          data-lightbox-src={url}
          className="max-w-xs max-h-64 rounded-lg border border-[var(--accent-2)]/30 object-cover hover:opacity-80 transition-opacity cursor-zoom-in"
        />
      </button>
    );
  }

  return (
    <a
      href={url}
      download={displayName}
      className="mt-1 inline-flex items-center gap-2 px-3 py-2 bg-[var(--panel)] border border-[var(--accent-2)]/30 rounded-lg text-sm text-[var(--text)] hover:border-[var(--accent-2)] transition-colors"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[var(--muted)]">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
      <span className="truncate max-w-[200px]">{displayName}</span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[var(--muted)]">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    </a>
  );
}
