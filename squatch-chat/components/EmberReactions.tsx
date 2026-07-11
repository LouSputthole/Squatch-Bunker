"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getSocket } from "@/lib/socket";

const EMBER_REACTIONS = [
  { id: "laugh", label: "Laugh", icon: "😄" },
  { id: "applause", label: "Applause", icon: "👏" },
  { id: "agree", label: "Agree", icon: "🔥" },
  { id: "wow", label: "Wow", icon: "✨" },
  { id: "skull", label: "Dead", icon: "💀" },
  { id: "clink", label: "Cheers", icon: "🍻" },
  { id: "nod", label: "Nod", icon: "👍" },
];

interface FloatingEmber {
  id: number;
  emoji: string;
  username: string;
  x: number; // percentage from left
  startTime: number;
}

interface EmberReactionsProps {
  channelId: string;
}

let emberId = 0;

export default function EmberReactions({ channelId }: EmberReactionsProps) {
  const [embers, setEmbers] = useState<FloatingEmber[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const lastReactTime = useRef(0);

  // Listen for incoming reactions
  useEffect(() => {
    const socket = getSocket();

    function handleReaction(data: { userId: string; username: string; emoji: string }) {
      const reaction = EMBER_REACTIONS.find((r) => r.id === data.emoji);
      if (!reaction) return;
      addEmber(reaction.icon, data.username);
    }

    socket.on("ember:reaction", handleReaction);
    return () => { socket.off("ember:reaction", handleReaction); };
  }, []);

  // Clean up old embers
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setEmbers((prev) => {
        const filtered = prev.filter((e) => now - e.startTime < 3000);
        if (filtered.length === prev.length) return prev; // no change, skip re-render
        return filtered;
      });
    }, 500);
    return () => clearInterval(interval);
  }, []);

  function addEmber(icon: string, username: string) {
    const ember: FloatingEmber = {
      id: emberId++,
      emoji: icon,
      username,
      x: 30 + Math.random() * 40, // center-ish area
      startTime: Date.now(),
    };
    setEmbers((prev) => [...prev.slice(-15), ember]); // cap at 15 visible
  }

  const sendReaction = useCallback((emojiId: string) => {
    // Rate limit: 1 per 500ms
    const now = Date.now();
    if (now - lastReactTime.current < 500) return;
    lastReactTime.current = now;

    const socket = getSocket();
    socket.emit("ember:react", { channelId, emoji: emojiId });

    // Show own reaction immediately
    const reaction = EMBER_REACTIONS.find((r) => r.id === emojiId);
    if (reaction) addEmber(reaction.icon, "You");
    setShowPicker(false);
  }, [channelId]);

  return (
    <>
      {/* Floating embers overlay */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-20">
        <style>{`
          @keyframes ember-rise {
            0% { opacity: 0.9; transform: translateY(0) scale(1); }
            50% { opacity: 0.7; transform: translateY(-60px) scale(1.1); }
            100% { opacity: 0; transform: translateY(-120px) scale(0.6); }
          }
        `}</style>
        {embers.map((ember) => (
          <div
            key={ember.id}
            className="absolute"
            style={{
              left: `${ember.x}%`,
              bottom: "40%",
              animation: "ember-rise 2.5s ease-out forwards",
            }}
          >
            <div className="flex flex-col items-center">
              <span className="text-2xl drop-shadow-lg">{ember.emoji}</span>
              <span className="text-[10px] text-amber-300/60 whitespace-nowrap mt-0.5">
                {ember.username}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Reaction picker trigger */}
      <div className="absolute bottom-20 left-4 z-30">
        <button
          onClick={() => setShowPicker((p) => !p)}
          className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${
            showPicker
              ? "bg-amber-600/30 text-amber-300"
              : "bg-[#1a1a1e]/80 text-amber-500/50 hover:text-amber-400 hover:bg-[#1a1a1e]"
          }`}
          title="React"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M8 14s1.5 2 4 2 4-2 4-2" />
            <line x1="9" y1="9" x2="9.01" y2="9" />
            <line x1="15" y1="9" x2="15.01" y2="9" />
          </svg>
        </button>

        {/* Picker */}
        {showPicker && (
          <div className="absolute bottom-11 left-0 bg-[#1a1a1e] border border-amber-600/20 rounded-xl px-2 py-1.5 shadow-xl flex gap-1">
            {EMBER_REACTIONS.map((r) => (
              <button
                key={r.id}
                onClick={() => sendReaction(r.id)}
                className="text-xl hover:scale-125 transition-transform px-1 py-0.5"
                title={r.label}
              >
                {r.icon}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
