"use client";

import { useRef, useEffect } from "react";
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

interface CircleViewProps {
  participants: Participant[];
  currentUserId: string;
  cameraOn?: boolean;
  localCameraStream?: MediaStream | null;
  remoteVideoStreams?: Map<string, MediaStream>;
  onContextMenu?: (e: React.MouseEvent, participant: Participant) => void;
}

function SeatVideo({ stream, mirror }: { stream: MediaStream; mirror?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={mirror}
      className="w-full h-full object-cover"
      style={{ transform: mirror ? "scaleX(-1)" : undefined }}
    />
  );
}

// Fixed seat positions (% of the campfire art), each centered on a painted
// stump/cushion. The art is rendered with backgroundSize 100% 100% (fill, no
// crop) so these line up at any panel size. "You" take seat 0 (front).
const SEATS: { x: number; y: number }[] = [
  { x: 48, y: 79 }, // bottom-center (self)
  { x: 30, y: 70 }, // bottom-left
  { x: 17, y: 47 }, // left
  { x: 33, y: 26 }, // top-left
  { x: 48, y: 20 }, // top-center
  { x: 68, y: 26 }, // top-right
  { x: 81, y: 47 }, // right
  { x: 68, y: 72 }, // bottom-right
];
const AVATAR_SIZE = 72;
const VIDEO_W = 196;
const VIDEO_H = 140;

export default function CircleView({
  participants,
  currentUserId,
  cameraOn,
  localCameraStream,
  remoteVideoStreams,
  onContextMenu,
}: CircleViewProps) {
  // "You" first → front seat.
  const ordered = [...participants].sort((a, b) => {
    if (a.userId === currentUserId) return -1;
    if (b.userId === currentUserId) return 1;
    return 0;
  });

  return (
    <div
      className="flex-1 relative overflow-hidden min-h-0"
      style={{
        backgroundImage: "url('/voice-campfire.png')",
        backgroundSize: "100% 100%", // fill (no crop) so seats line up with the art
        backgroundPosition: "center",
      }}
    >
      <style>{`
        @keyframes speak-ripple-c {
          0% { transform: translate(-50%, -50%) scale(1); opacity: 0.5; }
          100% { transform: translate(-50%, -50%) scale(1.7); opacity: 0; }
        }
      `}</style>

      {/* Vignette scrim — keeps the fire glowing center, darkens edges so seats read */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: "radial-gradient(ellipse at 50% 52%, transparent 28%, rgba(8,6,4,0.35) 70%, rgba(8,6,4,0.6) 100%)" }}
      />

      {ordered.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="bg-black/40 px-5 py-3 rounded-xl text-center">
            <p className="text-lg text-amber-100/90">The fire is waiting</p>
            <p className="text-sm text-amber-200/50">Take a seat…</p>
          </div>
        </div>
      )}

      {ordered.slice(0, SEATS.length).map((p, i) => {
        const seat = SEATS[i];
        const x = seat.x;
        const y = seat.y;
        const isSelf = p.userId === currentUserId;
        const isSpeaking = p.speaking && !p.muted;
        const stream = isSelf
          ? (cameraOn ? localCameraStream : null)
          : (remoteVideoStreams?.get(p.userId) || null);
        const hasVideo = !!stream;

        return (
          <div
            key={p.userId}
            className="absolute flex flex-col items-center gap-1"
            style={{ left: `${x}%`, top: `${y}%`, transform: "translate(-50%, -50%)", zIndex: isSpeaking ? 20 : 10 }}
            onContextMenu={(e) => { if (!isSelf && onContextMenu) { e.preventDefault(); onContextMenu(e, p); } }}
          >
            {isSpeaking && (
              <div
                className="absolute border-2 border-amber-400/40 pointer-events-none"
                style={{ width: hasVideo ? VIDEO_W + 14 : AVATAR_SIZE + 16, height: hasVideo ? VIDEO_H + 14 : AVATAR_SIZE + 16, left: "50%", top: hasVideo ? "42%" : "34%", transform: "translate(-50%, -50%)", animation: "speak-ripple-c 1.6s ease-out infinite", borderRadius: hasVideo ? 16 : 9999 }}
              />
            )}

            {hasVideo ? (
              <div
                className={`relative rounded-xl overflow-hidden border-2 bg-black ${isSpeaking ? "border-amber-400" : isSelf ? "border-amber-500/60" : "border-black/60"}`}
                style={{ width: VIDEO_W, height: VIDEO_H, boxShadow: isSpeaking ? "0 0 22px rgba(251,191,36,0.6)" : "0 6px 18px rgba(0,0,0,0.65)" }}
              >
                <SeatVideo stream={stream!} mirror={isSelf} />
                {p.muted && (
                  <div className="absolute bottom-1 right-1 w-4 h-4 bg-black/70 rounded-full flex items-center justify-center">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="3" strokeLinecap="round"><line x1="1" y1="1" x2="23" y2="23" /><path d="M9 9v3a3 3 0 0 0 5.12 2.12" /></svg>
                  </div>
                )}
              </div>
            ) : (
              <div className="relative">
                <div
                  className={`rounded-full ${isSpeaking ? "ring-2 ring-amber-400" : ""}`}
                  style={{ boxShadow: isSpeaking ? "0 0 16px rgba(251,191,36,0.55)" : "0 3px 12px rgba(0,0,0,0.6)" }}
                >
                  <Avatar
                    username={p.username}
                    avatarUrl={p.avatar}
                    size={AVATAR_SIZE}
                    className={`${isSelf ? "bg-amber-600/90 text-[var(--bg)]" : "bg-[#2a2a2e] text-white"} ${p.muted ? "opacity-60" : ""}`}
                  />
                </div>
                {p.muted && (
                  <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-[#1a1a1e] rounded-full flex items-center justify-center">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="3" strokeLinecap="round"><line x1="1" y1="1" x2="23" y2="23" /><path d="M9 9v3a3 3 0 0 0 5.12 2.12" /></svg>
                  </div>
                )}
                {p.deafened && (
                  <div className="absolute -bottom-0.5 -left-0.5 w-4 h-4 bg-[#1a1a1e] rounded-full flex items-center justify-center">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="3" strokeLinecap="round"><line x1="1" y1="1" x2="23" y2="23" /><path d="M3 18v-6a9 9 0 0 1 14.12-7.41" /></svg>
                  </div>
                )}
                {!isSelf && p.connectionQuality && p.connectionQuality !== "good" && (
                  <div className="absolute -top-1 -left-1 z-10">
                    <ConnectionQualityIcon quality={p.connectionQuality} pingMs={p.pingMs} />
                  </div>
                )}
              </div>
            )}

            <span
              className={`px-1.5 rounded text-[11px] font-medium truncate max-w-[96px] text-center bg-black/50 ${
                isSpeaking ? "text-amber-200" : isSelf ? "text-amber-300/90" : "text-white/85"
              }`}
            >
              {isSelf ? "You" : displayName(p.username)}
            </span>
          </div>
        );
      })}

      {ordered.length > SEATS.length && (
        <div className="absolute bottom-2 right-2 bg-black/60 text-amber-100 text-xs px-2 py-1 rounded-full">
          +{ordered.length - SEATS.length} more around the fire
        </div>
      )}
    </div>
  );
}
