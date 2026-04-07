"use client";

import { useRef, useEffect, useState } from "react";
import { displayName } from "@/lib/utils";
import Avatar from "@/components/Avatar";
import ConnectionQualityIcon from "@/components/ConnectionQualityIcon";

interface Participant {
  userId: string;
  username: string;
  muted: boolean;
  deafened?: boolean;
  speaking?: boolean;
  camera?: boolean;
  avatar?: string | null;
  connectionQuality?: "good" | "fair" | "poor" | "unknown";
  pingMs?: number;
}

function QualityDot({ quality }: { quality?: "good" | "fair" | "poor" }) {
  if (!quality || quality === "good") return null;
  const color = quality === "fair" ? "bg-amber-400" : "bg-red-500";
  const label = quality === "fair" ? "Weak connection" : "Poor connection";
  return (
    <div
      className={`absolute -top-1 -left-1 w-3 h-3 ${color} rounded-full border border-[#1a1a1e] z-10`}
      title={label}
    />
  );
}

interface CircleViewProps {
  participants: Participant[];
  currentUserId: string;
  onContextMenu?: (e: React.MouseEvent, participant: Participant) => void;
}

function MicOffDot() {
  return (
    <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-[#1a1a1e] rounded-full flex items-center justify-center z-10">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <line x1="1" y1="1" x2="23" y2="23" />
        <path d="M9 9v3a3 3 0 0 0 5.12 2.12" />
      </svg>
    </div>
  );
}

function DeafDot() {
  return (
    <div className="absolute -bottom-0.5 -left-0.5 w-4 h-4 bg-[#1a1a1e] rounded-full flex items-center justify-center z-10">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <line x1="1" y1="1" x2="23" y2="23" />
        <path d="M3 18v-6a9 9 0 0 1 14.12-7.41" />
      </svg>
    </div>
  );
}

// Central ember glow — the heart of the campfire
function EmberCenter() {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      {/* Outer warm glow */}
      <div className="absolute w-32 h-32 rounded-full opacity-20"
        style={{
          background: "radial-gradient(circle, #f59e0b 0%, #ea580c 40%, transparent 70%)",
          animation: "ember-pulse 4s ease-in-out infinite",
        }}
      />
      {/* Inner bright core */}
      <div className="absolute w-16 h-16 rounded-full opacity-40"
        style={{
          background: "radial-gradient(circle, #fbbf24 0%, #f59e0b 50%, transparent 100%)",
          animation: "ember-pulse 3s ease-in-out infinite 0.5s",
        }}
      />
      {/* Tiny hot center */}
      <div className="absolute w-6 h-6 rounded-full opacity-60"
        style={{
          background: "radial-gradient(circle, #fde68a 0%, #f59e0b 100%)",
          animation: "ember-pulse 2.5s ease-in-out infinite 1s",
        }}
      />
    </div>
  );
}

interface LeavingUser {
  participant: Participant;
  angle: number;
  leaveTime: number;
}

export default function CircleView({ participants, currentUserId, onContextMenu }: CircleViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevIdsRef = useRef<Set<string>>(new Set());
  const prevParticipantsRef = useRef<Participant[]>([]);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [leavingUsers, setLeavingUsers] = useState<LeavingUser[]>([]);

  // Track arrivals and departures for animations
  useEffect(() => {
    const currentIds = new Set(participants.map((p) => p.userId));
    const arriving = new Set<string>();
    const leaving: LeavingUser[] = [];

    for (const id of currentIds) {
      if (!prevIdsRef.current.has(id)) arriving.add(id);
    }

    const prevCount = prevParticipantsRef.current.length;
    for (const prev of prevParticipantsRef.current) {
      if (!currentIds.has(prev.userId)) {
        const idx = prevParticipantsRef.current.indexOf(prev);
        const angle = prevCount > 0 ? (2 * Math.PI * idx) / prevCount - Math.PI / 2 : 0;
        leaving.push({ participant: prev, angle, leaveTime: Date.now() });
      }
    }

    prevIdsRef.current = currentIds;
    prevParticipantsRef.current = participants;

    if (arriving.size > 0) {
      setNewIds(arriving);
      const timeout = setTimeout(() => setNewIds(new Set()), 800);
      return () => clearTimeout(timeout);
    }

    if (leaving.length > 0) {
      setLeavingUsers((prev) => [...prev, ...leaving]);
      const timeout = setTimeout(() => {
        setLeavingUsers((prev) => prev.filter((l) => Date.now() - l.leaveTime < 500));
      }, 600);
      return () => clearTimeout(timeout);
    }
  }, [participants]);

  const count = participants.length;
  // Circle radius scales with participant count
  const radius = Math.max(120, Math.min(200, 80 + count * 25));
  const seatSize = count <= 4 ? 72 : count <= 8 ? 64 : 56;

  return (
    <div ref={containerRef} className="flex-1 flex items-center justify-center relative overflow-hidden">
      {/* CSS keyframes */}
      <style>{`
        @keyframes ember-pulse {
          0%, 100% { transform: scale(1); opacity: 0.2; }
          50% { transform: scale(1.15); opacity: 0.35; }
        }
        @keyframes seat-arrive {
          0% { opacity: 0; transform: translate(-50%, -50%) scale(0.5); }
          60% { opacity: 1; transform: translate(-50%, -50%) scale(1.08); }
          100% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
        @keyframes speak-glow {
          0%, 100% { box-shadow: 0 0 8px rgba(251, 191, 36, 0.3); }
          50% { box-shadow: 0 0 20px rgba(251, 191, 36, 0.6), 0 0 40px rgba(245, 158, 11, 0.2); }
        }
        @keyframes speak-ripple {
          0% { transform: translate(-50%, -50%) scale(1); opacity: 0.4; }
          100% { transform: translate(-50%, -50%) scale(1.8); opacity: 0; }
        }
        @keyframes seat-leave {
          0% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          100% { opacity: 0; transform: translate(-50%, -50%) scale(0.3); }
        }
      `}</style>

      {/* Ember center */}
      <EmberCenter />

      {/* Empty state */}
      {count === 0 && (
        <div className="text-center text-[var(--muted)] z-10">
          <p className="text-lg mb-1 opacity-60">The fire is waiting</p>
          <p className="text-sm opacity-40">Take a seat...</p>
        </div>
      )}

      {/* Seats in a circle */}
      <div className="relative" style={{ width: radius * 2 + seatSize, height: radius * 2 + seatSize }}>
        {participants.map((p, i) => {
          const angle = (2 * Math.PI * i) / count - Math.PI / 2; // start from top
          const x = radius * Math.cos(angle) + radius;
          const y = radius * Math.sin(angle) + radius;
          const isSelf = p.userId === currentUserId;
          const isNew = newIds.has(p.userId);
          const isSpeaking = p.speaking && !p.muted;

          return (
            <div
              key={p.userId}
              className="absolute"
              style={{
                left: x + seatSize / 2,
                top: y + seatSize / 2,
                transform: "translate(-50%, -50%)",
                animation: isNew ? "seat-arrive 0.6s ease-out forwards" : undefined,
                zIndex: isSpeaking ? 10 : 1,
              }}
              onContextMenu={(e) => {
                if (!isSelf && onContextMenu) {
                  e.preventDefault();
                  onContextMenu(e, p);
                }
              }}
            >
              {/* Speaking ripple toward center */}
              {isSpeaking && (
                <div
                  className="absolute rounded-full border-2 border-amber-400/30 pointer-events-none"
                  style={{
                    width: seatSize + 16,
                    height: seatSize + 16,
                    left: "50%",
                    top: "50%",
                    transform: "translate(-50%, -50%)",
                    animation: "speak-ripple 1.5s ease-out infinite",
                  }}
                />
              )}

              {/* Seat container */}
              <div
                className={`flex flex-col items-center gap-1.5 transition-all duration-300 ${
                  p.muted ? "opacity-50" : "opacity-100"
                }`}
                style={{
                  animation: isSpeaking ? "speak-glow 2s ease-in-out infinite" : undefined,
                  borderRadius: "50%",
                }}
              >
                {/* Avatar with glow ring */}
                <div className="relative">
                  <div
                    className={`rounded-full transition-all duration-300 ${
                      isSpeaking ? "ring-2 ring-amber-400/60" : ""
                    }`}
                    style={{
                      boxShadow: isSpeaking
                        ? "0 0 16px rgba(251, 191, 36, 0.4), 0 0 32px rgba(245, 158, 11, 0.15)"
                        : isSelf
                        ? "0 0 8px rgba(251, 191, 36, 0.15)"
                        : "none",
                    }}
                  >
                    <Avatar
                      username={p.username}
                      avatarUrl={p.avatar}
                      size={seatSize}
                      className={`${
                        isSelf
                          ? "bg-amber-600/80 text-[var(--bg)]"
                          : "bg-[#2a2a2e] text-[var(--text)]"
                      } transition-all duration-300`}
                    />
                  </div>

                  {/* Status badges */}
                  {p.muted && <MicOffDot />}
                  {p.deafened && <DeafDot />}
                  {!isSelf && p.connectionQuality && p.connectionQuality !== "good" && (
                    <div className="absolute -top-1 -left-1 z-10">
                      <ConnectionQualityIcon quality={p.connectionQuality} pingMs={p.pingMs} />
                    </div>
                  )}

                  {/* Camera indicator */}
                  {p.camera && (
                    <div className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full flex items-center justify-center z-10">
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="white" stroke="none">
                        <path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" />
                      </svg>
                    </div>
                  )}
                </div>

                {/* Name label */}
                <span
                  className={`text-xs font-medium truncate max-w-[80px] text-center transition-all duration-300 ${
                    isSpeaking
                      ? "text-amber-300"
                      : isSelf
                      ? "text-amber-400/80"
                      : p.muted
                      ? "text-[var(--muted)]/50"
                      : "text-[var(--muted)]"
                  }`}
                >
                  {isSelf ? "You" : displayName(p.username)}
                </span>

              </div>
            </div>
          );
        })}

        {/* Leaving users — fade out animation */}
        {leavingUsers.map((l) => {
          const prevRadius = Math.max(120, Math.min(200, 80 + (participants.length + leavingUsers.length) * 25));
          const x = prevRadius * Math.cos(l.angle) + radius;
          const y = prevRadius * Math.sin(l.angle) + radius;
          return (
            <div
              key={`leaving-${l.participant.userId}`}
              className="absolute pointer-events-none"
              style={{
                left: x + seatSize / 2,
                top: y + seatSize / 2,
                animation: "seat-leave 0.5s ease-in forwards",
              }}
            >
              <div className="flex flex-col items-center gap-1.5 opacity-50">
                <Avatar
                  username={l.participant.username}
                  avatarUrl={l.participant.avatar}
                  size={seatSize}
                  className="bg-[#2a2a2e] text-[var(--text)]"
                />
                <span className="text-xs text-[var(--muted)]/50 truncate max-w-[80px]">
                  {displayName(l.participant.username)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
