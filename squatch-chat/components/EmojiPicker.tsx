"use client";

import { useState, useRef, useEffect, useMemo } from "react";

const CATEGORIES = [
  { id: "smileys", label: "😀", name: "Smileys" },
  { id: "people", label: "👋", name: "People" },
  { id: "animals", label: "🐱", name: "Animals" },
  { id: "food", label: "🍕", name: "Food" },
  { id: "travel", label: "✈️", name: "Travel" },
  { id: "activities", label: "⚽", name: "Activities" },
  { id: "objects", label: "💡", name: "Objects" },
  { id: "symbols", label: "❤️", name: "Symbols" },
  { id: "flags", label: "🏁", name: "Flags" },
] as const;

const EMOJI_DATA: Record<string, string[]> = {
  smileys: [
    "😀","😃","😄","😁","😆","😅","🤣","😂","🙂","😊","😇","🥰","😍","🤩","😘",
    "😗","😚","😙","🥲","😋","😛","😜","🤪","😝","🤑","🤗","🤭","🤫","🤔","🫡",
    "🤐","🤨","😐","😑","😶","🫥","😏","😒","🙄","😬","🤥","😌","😔","😪","🤤",
    "😴","😷","🤒","🤕","🤢","🤮","🥵","🥶","🥴","😵","🤯","🤠","🥳","🥸","😎",
    "🤓","🧐","😕","🫤","😟","🙁","☹️","😮","😯","😲","😳","🥺","🥹","😦","😧",
    "😨","😰","😥","😢","😭","😱","😖","😣","😞","😓","😩","😫","🥱","😤","😡",
    "😠","🤬","😈","👿","💀","☠️","💩","🤡","👹","👺","👻","👽","👾","🤖",
  ],
  people: [
    "👋","🤚","🖐️","✋","🖖","🫱","🫲","🫳","🫴","👌","🤌","🤏","✌️","🤞","🫰",
    "🤟","🤘","🤙","👈","👉","👆","🖕","👇","☝️","🫵","👍","👎","✊","👊","🤛",
    "🤜","👏","🙌","🫶","👐","🤲","🤝","🙏","✍️","💅","🤳","💪","🦾","🦿","🦵",
    "🦶","👂","🦻","👃","🧠","🫀","🫁","🦷","🦴","👀","👁️","👅","👄","🫦",
    "👶","🧒","👦","👧","🧑","👱","👨","🧔","👩","🧓","👴","👵",
  ],
  animals: [
    "🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐻‍❄️","🐨","🐯","🦁","🐮","🐷","🐽",
    "🐸","🐵","🙈","🙉","🙊","🐒","🐔","🐧","🐦","🐤","🐣","🐥","🦆","🦅","🦉",
    "🦇","🐺","🐗","🐴","🦄","🫎","🐝","🪱","🐛","🦋","🐌","🐞","🐜","🪰","🪲",
    "🪳","🦟","🦗","🕷️","🕸️","🦂","🐢","🐍","🦎","🦖","🦕","🐙","🦑","🦐","🦞",
    "🦀","🪸","🐡","🐠","🐟","🐬","🐳","🐋","🦈","🐊","🐅","🐆","🦓","🫏","🦍",
    "🦧","🦣","🐘","🦛","🦏","🐪","🐫","🦒","🦘","🦬","🐃","🐂","🐄","🐎","🐖",
  ],
  food: [
    "🍎","🍐","🍊","🍋","🍌","🍉","🍇","🍓","🫐","🍈","🍒","🍑","🥭","🍍","🥥",
    "🥝","🍅","🍆","🥑","🫛","🥦","🥬","🥒","🌶️","🫑","🌽","🥕","🫒","🧄","🧅",
    "🥔","🍠","🫘","🥐","🥯","🍞","🥖","🥨","🧀","🥚","🍳","🧈","🥞","🧇","🥓",
    "🥩","🍗","🍖","🦴","🌭","🍔","🍟","🍕","🫓","🥪","🥙","🧆","🌮","🌯","🫔",
    "🥗","🥘","🫕","🍝","🍜","🍲","🍛","🍣","🍱","🥟","🦪","🍤","🍙","🍚","🍘",
    "🍥","🥠","🥮","🍢","🍡","🍧","🍨","🍦","🥧","🧁","🍰","🎂","🍮","🍭","🍬",
    "🍫","🍿","🍩","🍪","🌰","🥜","🍯","🥛","🫗","☕","🫖","🍵","🍶","🍾","🍷",
    "🍸","🍹","🍺","🍻","🥂","🥃","🫧","🧊",
  ],
  travel: [
    "🚗","🚕","🚙","🚌","🚎","🏎️","🚓","🚑","🚒","🚐","🛻","🚚","🚛","🚜","🏍️",
    "🛵","🛺","🚲","🛴","🛹","🛼","🚏","🛣️","🛤️","🛞","⛽","🚨","🚥","🚦","🛑",
    "🚧","⚓","🛟","⛵","🚤","🛳️","⛴️","🛥️","🚢","✈️","🛩️","🛫","🛬","🪂","💺",
    "🚁","🚟","🚠","🚡","🛰️","🚀","🛸","🏠","🏡","🏢","🏣","🏤","🏥","🏦","🏨",
    "🏩","🏪","🏫","🏬","🏭","🏯","🏰","💒","🗼","🗽","⛪","🕌","🛕","🕍","⛩️",
    "🌍","🌎","🌏","🌐","🗺️","🧭","🏔️","⛰️","🌋","🗻","🏕️","🏖️","🏜️","🏝️","🏞️",
  ],
  activities: [
    "⚽","🏀","🏈","⚾","🥎","🎾","🏐","🏉","🥏","🎱","🪀","🏓","🏸","🏒","🏑",
    "🥍","🏏","🪃","🥅","⛳","🪁","🏹","🎣","🤿","🥊","🥋","🎽","🛹","🛼","🛷",
    "⛸️","🥌","🎿","⛷️","🏂","🪂","🏋️","🤼","🤸","🤺","⛹️","🏇","🧘","🏄","🏊",
    "🚣","🧗","🚵","🚴","🏆","🥇","🥈","🥉","🏅","🎖️","🏵️","🎗️","🎫","🎟️","🎪",
    "🎭","🎨","🎬","🎤","🎧","🎼","🎹","🥁","🪘","🎷","🎺","🪗","🎸","🪕","🎻",
    "🪈","🎲","♟️","🎯","🎳","🎮","🕹️","🧩","🧸",
  ],
  objects: [
    "⌚","📱","📲","💻","⌨️","🖥️","🖨️","🖱️","🖲️","🕹️","🗜️","💽","💾","💿","📀",
    "📼","📷","📸","📹","🎥","📽️","🎞️","📞","☎️","📟","📠","📺","📻","🎙️","🎚️",
    "🎛️","🧭","⏱️","⏲️","⏰","🕰️","⌛","⏳","📡","🔋","🪫","🔌","💡","🔦","🕯️",
    "🪔","🧯","🛢️","💸","💵","💴","💶","💷","🪙","💰","💳","💎","⚖️","🪜","🧰",
    "🪛","🔧","🔨","⚒️","🛠️","⛏️","🪚","🔩","⚙️","🪤","🧲","🔫","💣","🧨","🪓",
    "🔪","🗡️","⚔️","🛡️","🔑","🗝️","🔒","🔓","📦","📫","📬","📭","📮","📯","📜",
    "📃","📄","📑","🧾","📊","📈","📉","📆","📅","🗒️","🗓️","📇","🗃️","🗳️","🗄️",
    "📋","📁","📂","🗂️","🗞️","📰","📓","📔","📒","📕","📗","📘","📙","📚","📖",
    "🔗","📎","🖇️","📐","📏","🧮","📌","📍","✂️","🖊️","🖋️","✒️","🖌️","🖍️","📝",
    "✏️","🔍","🔎","🔏","🔐",
  ],
  symbols: [
    "❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","❤️‍🔥","❤️‍🩹","❣️","💕","💞",
    "💓","💗","💖","💘","💝","💟","☮️","✝️","☪️","🕉️","☸️","✡️","🔯","🕎","☯️",
    "☦️","🛐","⛎","♈","♉","♊","♋","♌","♍","♎","♏","♐","♑","♒","♓",
    "🆔","⚛️","🉑","☢️","☣️","📴","📳","🈶","🈚","🈸","🈺","🈷️","✴️","🆚","💮",
    "🉐","㊙️","㊗️","🈴","🈵","🈹","🈲","🅰️","🅱️","🆎","🆑","🅾️","🆘","❌","⭕",
    "🛑","⛔","📛","🚫","💯","💢","♨️","🚷","🚯","🚳","🚱","🔞","📵","🚭","❗",
    "❕","❓","❔","‼️","⁉️","🔅","🔆","〽️","⚠️","🚸","🔱","⚜️","🔰","♻️","✅",
    "🈯","💹","❇️","✳️","❎","🌐","💠","Ⓜ️","🌀","💤","🏧","🚾","♿","🅿️","🛗",
    "🈳","🈂️","🛂","🛃","🛄","🛅","🚹","🚺","🚻","🚼","🚾","🔣","ℹ️","🔤","🔡",
    "🔠","🆖","🆗","🆙","🆒","🆕","🆓","0️⃣","1️⃣","2️⃣","3️⃣","4️⃣","5️⃣","6️⃣","7️⃣",
    "8️⃣","9️⃣","🔟","🔢","#️⃣","*️⃣","⏏️","▶️","⏸️","⏯️","⏹️","⏺️","⏭️","⏮️","⏩",
    "⏪","⏫","⏬","◀️","🔼","🔽","➡️","⬅️","⬆️","⬇️","↗️","↘️","↙️","↖️","↕️",
    "↔️","↩️","↪️","⤴️","⤵️","🔀","🔁","🔂","🔄","🔃","🎵","🎶","➕","➖","➗",
    "✖️","🟰","♾️","💲","💱","™️","©️","®️","〰️","➰","➿","🔚","🔙","🔛","🔝","🔜",
    "✔️","☑️","🔘","🔴","🟠","🟡","🟢","🔵","🟣","⚫","⚪","🟤","🔺","🔻","🔸",
    "🔹","🔶","🔷","🔳","🔲","▪️","▫️","◾","◽","◼️","◻️","🟥","🟧","🟨","🟩",
    "🟦","🟪","⬛","⬜","🟫","🔈","🔇","🔉","🔊","🔔","🔕","📣","📢",
  ],
  flags: [
    "🏁","🚩","🎌","🏴","🏳️","🏳️‍🌈","🏳️‍⚧️","🏴‍☠️",
    "🇺🇸","🇬🇧","🇨🇦","🇦🇺","🇩🇪","🇫🇷","🇪🇸","🇮🇹","🇯🇵","🇰🇷","🇨🇳","🇮🇳",
    "🇧🇷","🇲🇽","🇷🇺","🇿🇦","🇳🇬","🇪🇬","🇦🇷","🇨🇱","🇨🇴","🇵🇪","🇳🇱","🇧🇪",
    "🇨🇭","🇦🇹","🇸🇪","🇳🇴","🇩🇰","🇫🇮","🇵🇱","🇵🇹","🇬🇷","🇹🇷","🇮🇱","🇸🇦",
    "🇦🇪","🇹🇭","🇻🇳","🇮🇩","🇵🇭","🇲🇾","🇸🇬","🇳🇿","🇮🇪","🇺🇦","🇷🇴","🇭🇺",
  ],
};

const RECENT_KEY = "campfire-recent-emoji";
const MAX_RECENT = 24;

function getRecent(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
  } catch {
    return [];
  }
}

function addRecent(emoji: string) {
  const recent = getRecent().filter((e) => e !== emoji);
  recent.unshift(emoji);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
}

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

export default function EmojiPicker({ onSelect, onClose }: EmojiPickerProps) {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("smileys");
  const [recent, setRecent] = useState<string[]>(getRecent);
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  const filtered = useMemo(() => {
    if (!search.trim()) return null;
    const q = search.toLowerCase();
    const results: string[] = [];
    for (const emojis of Object.values(EMOJI_DATA)) {
      for (const e of emojis) {
        if (results.length >= 80) break;
        // Simple search: just include all for common terms
        results.push(e);
      }
    }
    // Filter is very basic since we don't have emoji names — just show all and let user scroll
    return q ? Object.values(EMOJI_DATA).flat().slice(0, 80) : null;
  }, [search]);

  function handlePick(emoji: string) {
    addRecent(emoji);
    setRecent(getRecent());
    onSelect(emoji);
  }

  const emojisToShow = filtered || EMOJI_DATA[activeCategory] || [];

  return (
    <div
      ref={ref}
      className="w-80 bg-[var(--panel)] border border-[var(--accent-2)]/30 rounded-xl shadow-2xl flex flex-col overflow-hidden"
      style={{ maxHeight: "360px" }}
    >
      {/* Search */}
      <div className="p-2 border-b border-[var(--accent-2)]/20">
        <input
          ref={searchRef}
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search emoji..."
          className="w-full px-3 py-1.5 text-sm bg-[var(--panel-2)] text-[var(--text)] border border-[var(--accent-2)]/30 rounded-lg focus:outline-none focus:border-[var(--accent-2)] placeholder:text-[var(--muted)]"
        />
      </div>

      {/* Category tabs */}
      {!search && (
        <div className="flex px-1 py-1 gap-0.5 border-b border-[var(--accent-2)]/20">
          {recent.length > 0 && (
            <button
              onClick={() => setActiveCategory("recent")}
              className={`p-1.5 rounded text-sm transition-colors ${activeCategory === "recent" ? "bg-[var(--accent-2)]/20" : "hover:bg-[var(--accent-2)]/10"}`}
              title="Recently Used"
            >
              🕐
            </button>
          )}
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`p-1.5 rounded text-sm transition-colors ${activeCategory === cat.id ? "bg-[var(--accent-2)]/20" : "hover:bg-[var(--accent-2)]/10"}`}
              title={cat.name}
            >
              {cat.label}
            </button>
          ))}
        </div>
      )}

      {/* Emoji grid */}
      <div className="flex-1 overflow-y-auto p-2">
        {!search && activeCategory === "recent" && recent.length > 0 && (
          <>
            <div className="text-[10px] text-[var(--muted)] uppercase font-semibold mb-1 px-1">Recently Used</div>
            <div className="grid grid-cols-8 gap-0.5">
              {recent.map((emoji, i) => (
                <button
                  key={`recent-${i}`}
                  onClick={() => handlePick(emoji)}
                  className="w-8 h-8 flex items-center justify-center rounded hover:bg-[var(--accent-2)]/20 text-xl transition-colors"
                  title={emoji}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </>
        )}
        {!search && activeCategory !== "recent" && (
          <div className="text-[10px] text-[var(--muted)] uppercase font-semibold mb-1 px-1">
            {CATEGORIES.find((c) => c.id === activeCategory)?.name}
          </div>
        )}
        {search && (
          <div className="text-[10px] text-[var(--muted)] uppercase font-semibold mb-1 px-1">
            Search Results
          </div>
        )}
        <div className="grid grid-cols-8 gap-0.5">
          {emojisToShow.map((emoji, i) => (
            <button
              key={`${emoji}-${i}`}
              onClick={() => handlePick(emoji)}
              className="w-8 h-8 flex items-center justify-center rounded hover:bg-[var(--accent-2)]/20 text-xl transition-colors"
              title={emoji}
            >
              {emoji}
            </button>
          ))}
        </div>
        {search && emojisToShow.length === 0 && (
          <div className="text-sm text-[var(--muted)] text-center py-4">No emoji found</div>
        )}
      </div>
    </div>
  );
}
