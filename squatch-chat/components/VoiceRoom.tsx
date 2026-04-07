"use client";

import { useState, useRef, useEffect } from "react";
import { displayName } from "@/lib/utils";
import Avatar from "@/components/Avatar";
import CircleView from "@/components/CircleView";
import EmberReactions from "@/components/EmberReactions";
import type { ScreenShareInfo } from "@/components/VoicePanel";

interface VoiceParticipant {
  userId: string;
  username: string;
  muted: boolean;
  deafened?: boolean;
  speaking?: boolean;
  avatar?: string | null;
}

interface VoiceChannel {
  id: string;
  name: string;
  type?: string;
}

interface VoiceRoomProps {
  channelId: string;
  channelName: string;
  participants: VoiceParticipant[];
  currentUserId: string;
  currentUserRole?: string;
  muted: boolean;
  deafened: boolean;
  pttMode?: boolean;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onTogglePTT?: () => void;
  onDisconnect: () => void;
  onUserVolumeChange?: (userId: string, volume: number) => void;
  onServerMute?: (channelId: string, targetUserId: string, muted: boolean) => void;
  onServerDeafen?: (channelId: string, targetUserId: string, deafened: boolean) => void;
  onKickFromVoice?: (channelId: string, targetUserId: string) => void;
  onMoveUser?: (fromChannelId: string, toChannelId: string, targetUserId: string) => void;
  voiceChannels?: VoiceChannel[];
  reconnecting?: boolean;
  sharing?: boolean;
  cameraOn?: boolean;
  onStartScreenShare?: () => void;
  onStopScreenShare?: () => void;
  onToggleCamera?: () => void;
  incomingScreenShares?: ScreenShareInfo[];
  remoteVideoStreams?: Map<string, MediaStream>;
  localCameraStream?: MediaStream | null;
  localScreenStream?: MediaStream | null;
}

// SVG Icons (larger versions for the room view)
function MicIcon({ muted, size = 20 }: { muted: boolean; size?: number }) {
  if (muted) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="1" y1="1" x2="23" y2="23" />
        <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
        <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.13 1.49-.35 2.17" />
        <line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function HeadphonesIcon({ deafened, size = 20 }: { deafened: boolean; size?: number }) {
  if (deafened) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="1" y1="1" x2="23" y2="23" />
        <path d="M3 18v-6a9 9 0 0 1 14.12-7.41" /><path d="M21 12v6" />
        <path d="M3 18a3 3 0 0 0 3 3h0a3 3 0 0 0 3-3v-1" />
        <path d="M15 17v1a3 3 0 0 0 3 3h0a3 3 0 0 0 3-3" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
      <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
    </svg>
  );
}

function PhoneOffIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" />
      <line x1="23" y1="1" x2="1" y2="23" />
    </svg>
  );
}

function MicOffSmall() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-red-400">
      <line x1="1" y1="1" x2="23" y2="23" />
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
      <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.13 1.49-.35 2.17" />
      <line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function DeafSmall() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-red-400">
      <line x1="1" y1="1" x2="23" y2="23" />
      <path d="M3 18v-6a9 9 0 0 1 14.12-7.41" /><path d="M21 12v6" />
      <path d="M3 18a3 3 0 0 0 3 3h0a3 3 0 0 0 3-3v-1" />
      <path d="M15 17v1a3 3 0 0 0 3 3h0a3 3 0 0 0 3-3" />
    </svg>
  );
}

function PushToTalkIcon({ active }: { active: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      {active && <circle cx="12" cy="16" r="2" fill="currentColor" />}
    </svg>
  );
}

function CameraIcon({ on }: { on: boolean }) {
  if (on) {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
      </svg>
    );
  }
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function VideoTile({ stream, label, isSelf }: { stream: MediaStream; label: string; isSelf?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className={`relative rounded-xl overflow-hidden border ${isSelf ? "border-[var(--accent)]/30" : "border-[var(--accent-2)]/20"} bg-black`}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isSelf}
        className="w-full h-full object-cover"
        style={{ transform: isSelf ? "scaleX(-1)" : undefined }}
      />
      <span className="absolute bottom-1 left-1 text-xs bg-black/70 text-white px-1.5 py-0.5 rounded">
        {label}
      </span>
    </div>
  );
}

function ScreenShareIcon({ active }: { active: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
      {active && <path d="M8 10l3 3 5-6" stroke="currentColor" strokeWidth="2" />}
    </svg>
  );
}

function ScreenViewer({ shares }: { shares: ScreenShareInfo[] }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const activeShare = shares[activeIdx] || shares[0];

  useEffect(() => {
    if (videoRef.current && activeShare) {
      videoRef.current.srcObject = activeShare.stream;
    }
  }, [activeShare]);

  if (!activeShare) return null;

  return (
    <div className={`flex flex-col ${fullscreen ? "fixed inset-0 z-50 bg-black" : "flex-1"}`}>
      {/* Shared screen tabs (if multiple) */}
      {shares.length > 1 && (
        <div className="flex gap-1 px-2 py-1 bg-[var(--bg)]/80">
          {shares.map((s, i) => (
            <button
              key={s.userId}
              onClick={() => setActiveIdx(i)}
              className={`text-xs px-2 py-1 rounded ${
                i === activeIdx ? "bg-[var(--accent)] text-[var(--bg)]" : "bg-[var(--panel-2)] text-[var(--muted)]"
              }`}
            >
              {displayName(s.username)}
            </button>
          ))}
        </div>
      )}
      {/* Video */}
      <div className="flex-1 relative bg-black flex items-center justify-center min-h-0">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="max-w-full max-h-full object-contain"
        />
        {/* Overlay controls */}
        <div className="absolute bottom-2 right-2 flex gap-1">
          <span className="text-xs bg-black/70 text-white px-2 py-1 rounded">
            {displayName(activeShare.username)}&apos;s screen
          </span>
          <button
            onClick={() => setFullscreen((f) => !f)}
            className="text-xs bg-black/70 text-white px-2 py-1 rounded hover:bg-black/90"
          >
            {fullscreen ? "Exit Fullscreen" : "Fullscreen"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SelfScreenPreview({ stream }: { stream: MediaStream }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className="absolute top-14 right-3 z-30 w-48 rounded-lg overflow-hidden border border-amber-600/20 shadow-xl bg-black">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full h-auto object-contain"
      />
      <span className="absolute bottom-1 left-1 text-[10px] bg-black/70 text-amber-300 px-1.5 py-0.5 rounded">
        Your screen
      </span>
    </div>
  );
}

interface Toast {
  id: number;
  message: string;
  type: "join" | "leave";
}

export default function VoiceRoom({
  channelId,
  channelName,
  participants,
  currentUserId,
  currentUserRole,
  muted,
  deafened,
  pttMode,
  onToggleMute,
  onToggleDeafen,
  onTogglePTT,
  onDisconnect,
  onUserVolumeChange,
  onServerMute,
  onServerDeafen,
  onKickFromVoice,
  onMoveUser,
  voiceChannels,
  reconnecting,
  sharing,
  cameraOn,
  onStartScreenShare,
  onStopScreenShare,
  onToggleCamera,
  incomingScreenShares,
  remoteVideoStreams,
  localCameraStream,
  localScreenStream,
}: VoiceRoomProps) {
  const [volumePopup, setVolumePopup] = useState<{ userId: string; volume: number } | null>(null);
  const [modMenu, setModMenu] = useState<{ userId: string; username: string; x: number; y: number; muted: boolean; deafened?: boolean } | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const prevParticipantsRef = useRef<VoiceParticipant[]>([]);
  const toastCounterRef = useRef(0);
  const isFirstRenderRef = useRef(true);

  const canMod = currentUserRole === "owner" || currentUserRole === "admin" || currentUserRole === "mod";
  const otherVoiceChannels = voiceChannels?.filter((c) => c.id !== channelId && c.type === "voice") || [];

  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      prevParticipantsRef.current = participants;
      return;
    }

    const prev = prevParticipantsRef.current;
    const prevIds = new Set(prev.map((p) => p.userId));
    const currIds = new Set(participants.map((p) => p.userId));

    const joined = participants.filter((p) => !prevIds.has(p.userId) && p.userId !== currentUserId);
    const left = prev.filter((p) => !currIds.has(p.userId) && p.userId !== currentUserId);

    const newToasts: Toast[] = [
      ...joined.map((p) => ({ id: toastCounterRef.current++, message: `${displayName(p.username)} joined voice`, type: "join" as const })),
      ...left.map((p) => ({ id: toastCounterRef.current++, message: `${displayName(p.username)} left voice`, type: "leave" as const })),
    ];

    if (newToasts.length > 0) {
      setToasts((prev) => [...prev, ...newToasts]);
      newToasts.forEach((t) => {
        setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== t.id)), 3000);
      });
    }

    prevParticipantsRef.current = participants;
  }, [participants, currentUserId]);

  return (
    <div className="flex-1 flex flex-col relative" style={{ background: "linear-gradient(180deg, #1a1a1e 0%, #151517 100%)" }}>
      {/* Header */}
      <div className="h-12 px-4 flex items-center border-b border-amber-600/10 shrink-0" style={{ background: "rgba(26,26,30,0.9)" }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2 shrink-0">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        </svg>
        <h3 className="font-bold text-amber-100">{channelName}</h3>
        {reconnecting ? (
          <span className="ml-2 text-xs text-yellow-400 animate-pulse">
            Reconnecting...
          </span>
        ) : (
          <span className="ml-2 text-xs text-[var(--muted)]">
            {participants.length} {participants.length === 1 ? "person" : "people"} connected
          </span>
        )}
      </div>

      {/* Ember Reactions overlay */}
      <EmberReactions channelId={channelId} />

      {/* Screen Share Viewer — takes priority over participant grid */}
      {(incomingScreenShares && incomingScreenShares.length > 0) && (
        <ScreenViewer shares={incomingScreenShares} />
      )}

      {/* Screen share self-preview — small PiP when you're sharing */}
      {sharing && localScreenStream && (
        <SelfScreenPreview stream={localScreenStream} />
      )}

      {/* Video Grid — shows when any cameras are on */}
      {(() => {
        const hasVideo = (remoteVideoStreams && remoteVideoStreams.size > 0) || localCameraStream;
        if (!hasVideo) return null;
        const hasScreenShare = incomingScreenShares && incomingScreenShares.length > 0;
        return (
          <div className={`${hasScreenShare ? "h-32 shrink-0" : "flex-1"} grid gap-2 p-2 min-h-0`}
            style={{ gridTemplateColumns: `repeat(auto-fit, minmax(200px, 1fr))` }}
          >
            {localCameraStream && (
              <VideoTile stream={localCameraStream} label="You" isSelf />
            )}
            {remoteVideoStreams && Array.from(remoteVideoStreams.entries()).map(([userId, stream]) => {
              const p = participants.find((pp) => pp.userId === userId);
              return (
                <VideoTile key={userId} stream={stream} label={p ? displayName(p.username) : userId} />
              );
            })}
          </div>
        );
      })()}

      {/* The Circle — seats around the fire */}
      {!((incomingScreenShares && incomingScreenShares.length > 0) || (remoteVideoStreams && remoteVideoStreams.size > 0) || localCameraStream) && (
        <CircleView
          participants={participants}
          currentUserId={currentUserId}
          onContextMenu={(e, p) => {
            if (canMod) {
              setModMenu({ userId: p.userId, username: p.username, x: e.clientX, y: e.clientY, muted: p.muted, deafened: p.deafened });
              setVolumePopup(null);
            } else {
              setVolumePopup({ userId: p.userId, volume: 1 });
            }
          }}
        />
      )}

      {/* Compact participant strip when video/screen share is active */}
      {((incomingScreenShares && incomingScreenShares.length > 0) || (remoteVideoStreams && remoteVideoStreams.size > 0) || localCameraStream) && (
        <div className="h-24 shrink-0 overflow-x-auto overflow-y-hidden px-4 py-2 flex items-center gap-3 justify-center bg-[#1a1a1e]/50">
          {participants.map((p) => {
            const isSelf = p.userId === currentUserId;
            return (
              <div key={p.userId} className="flex flex-col items-center gap-1 shrink-0">
                <div className="relative">
                  <Avatar
                    username={p.username}
                    avatarUrl={p.avatar}
                    size={40}
                    className={`${isSelf ? "bg-amber-600/80 text-[var(--bg)]" : "bg-[#2a2a2e] text-[var(--text)]"} ${p.muted ? "opacity-50" : ""}`}
                  />
                  {p.speaking && !p.muted && (
                    <div className="absolute inset-[-2px] rounded-full border-2 border-amber-400/60" />
                  )}
                </div>
                <span className={`text-[10px] truncate max-w-[50px] ${p.speaking && !p.muted ? "text-amber-300" : "text-[var(--muted)]"}`}>
                  {isSelf ? "You" : displayName(p.username)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Mod context menu */}
      {modMenu && (
        <div
          className="fixed bg-[var(--panel)] border border-[var(--accent-2)]/30 rounded-lg shadow-xl py-1 z-50 min-w-[160px]"
          style={{ left: Math.min(modMenu.x, (typeof window !== "undefined" ? window.innerWidth : 800) - 180), top: Math.min(modMenu.y, (typeof window !== "undefined" ? window.innerHeight : 600) - 250) }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1.5 text-xs text-[var(--muted)] border-b border-[var(--accent-2)]/20">
            {modMenu.username}
          </div>
          {/* Volume control */}
          <button
            onClick={() => { setVolumePopup({ userId: modMenu.userId, volume: 1 }); setModMenu(null); }}
            className="w-full text-left px-3 py-1.5 text-xs text-[var(--text)] hover:bg-[var(--panel-2)] flex items-center gap-2"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /></svg>
            Adjust Volume
          </button>
          {/* Server mute */}
          <button
            onClick={() => { onServerMute?.(channelId, modMenu.userId, !modMenu.muted); setModMenu(null); }}
            className="w-full text-left px-3 py-1.5 text-xs text-[var(--text)] hover:bg-[var(--panel-2)] flex items-center gap-2"
          >
            <MicIcon muted={!modMenu.muted} size={12} />
            {modMenu.muted ? "Server Unmute" : "Server Mute"}
          </button>
          {/* Server deafen */}
          <button
            onClick={() => { onServerDeafen?.(channelId, modMenu.userId, !modMenu.deafened); setModMenu(null); }}
            className="w-full text-left px-3 py-1.5 text-xs text-[var(--text)] hover:bg-[var(--panel-2)] flex items-center gap-2"
          >
            <HeadphonesIcon deafened={!modMenu.deafened} size={12} />
            {modMenu.deafened ? "Server Undeafen" : "Server Deafen"}
          </button>
          {/* Move to channel */}
          {otherVoiceChannels.length > 0 && (
            <>
              <div className="border-t border-[var(--accent-2)]/20 mt-1 pt-1">
                <div className="px-3 py-1 text-[10px] text-[var(--muted)] uppercase">Move to</div>
                {otherVoiceChannels.map((vc) => (
                  <button
                    key={vc.id}
                    onClick={() => { onMoveUser?.(channelId, vc.id, modMenu.userId); setModMenu(null); }}
                    className="w-full text-left px-3 py-1 text-xs text-[var(--text)] hover:bg-[var(--panel-2)]"
                  >
                    🔊 {vc.name}
                  </button>
                ))}
              </div>
            </>
          )}
          {/* Kick from voice */}
          <div className="border-t border-[var(--accent-2)]/20 mt-1 pt-1">
            <button
              onClick={() => { onKickFromVoice?.(channelId, modMenu.userId); setModMenu(null); }}
              className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-red-600/10 flex items-center gap-2"
            >
              <PhoneOffIcon />
              Disconnect User
            </button>
          </div>
        </div>
      )}

      {/* Floating volume popup */}
      {volumePopup && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setVolumePopup(null)} />
          <div
            className="fixed z-40 flex items-center gap-2 bg-[#1a1a1e] rounded-lg px-3 py-2 border border-amber-600/20 shadow-xl"
            style={{ left: "50%", bottom: 100, transform: "translateX(-50%)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" className="shrink-0">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            </svg>
            <input
              type="range"
              min="0"
              max="100"
              defaultValue="100"
              className="w-28 accent-amber-500"
              onChange={(e) => {
                const vol = parseInt(e.target.value) / 100;
                setVolumePopup({ userId: volumePopup.userId, volume: vol });
                onUserVolumeChange?.(volumePopup.userId, vol);
              }}
            />
            <span className="text-xs text-amber-400/70 w-8">
              {Math.round(volumePopup.volume * 100)}%
            </span>
            <button
              onClick={() => setVolumePopup(null)}
              className="text-[var(--muted)] hover:text-[var(--text)] ml-1"
            >
              x
            </button>
          </div>
        </>
      )}

      {/* Click outside to close mod menu */}
      {modMenu && (
        <div className="fixed inset-0 z-40" onClick={() => setModMenu(null)} />
      )}

      {/* Join/leave toasts */}
      {toasts.length > 0 && (
        <div className="absolute top-14 right-3 flex flex-col gap-1.5 z-30 pointer-events-none">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium shadow-lg text-white animate-pulse-once ${
                t.type === "join" ? "bg-green-600/90" : "bg-[var(--panel)]/90 border border-[var(--accent-2)]/30 text-[var(--text)]"
              }`}
            >
              {t.type === "join" ? "→ " : "← "}{t.message}
            </div>
          ))}
        </div>
      )}

      {/* Bottom Controls Bar */}
      <div className="px-6 py-4 border-t border-amber-600/10 shrink-0" style={{ background: "rgba(26,26,30,0.95)" }}>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={onToggleMute}
            className={`p-3 rounded-full transition-colors ${
              muted
                ? "bg-red-600/20 text-red-400 hover:bg-red-600/30"
                : "bg-[var(--panel-2)] text-[var(--text)] hover:bg-[var(--accent-2)]/30"
            }`}
            title={muted ? "Unmute" : "Mute"}
          >
            <MicIcon muted={muted} />
          </button>
          <button
            onClick={onToggleDeafen}
            className={`p-3 rounded-full transition-colors ${
              deafened
                ? "bg-red-600/20 text-red-400 hover:bg-red-600/30"
                : "bg-[var(--panel-2)] text-[var(--text)] hover:bg-[var(--accent-2)]/30"
            }`}
            title={deafened ? "Undeafen" : "Deafen"}
          >
            <HeadphonesIcon deafened={deafened} />
          </button>
          {onTogglePTT && (
            <button
              onClick={onTogglePTT}
              className={`p-3 rounded-full transition-colors ${
                pttMode
                  ? "bg-yellow-600/20 text-yellow-400 hover:bg-yellow-600/30"
                  : "bg-[var(--panel-2)] text-[var(--text)] hover:bg-[var(--accent-2)]/30"
              }`}
              title={pttMode ? "Disable Push-to-Talk (Space)" : "Enable Push-to-Talk (Space)"}
            >
              <PushToTalkIcon active={!!pttMode} />
            </button>
          )}
          {/* Camera */}
          <button
            onClick={onToggleCamera}
            className={`p-3 rounded-full transition-colors ${
              cameraOn
                ? "bg-green-600/20 text-green-400 hover:bg-green-600/30"
                : "bg-[var(--panel-2)] text-[var(--text)] hover:bg-[var(--accent-2)]/30"
            }`}
            title={cameraOn ? "Turn Off Camera" : "Turn On Camera"}
          >
            <CameraIcon on={!!cameraOn} />
          </button>
          {/* Screen share */}
          <button
            onClick={sharing ? onStopScreenShare : onStartScreenShare}
            className={`p-3 rounded-full transition-colors ${
              sharing
                ? "bg-green-600/20 text-green-400 hover:bg-green-600/30"
                : "bg-[var(--panel-2)] text-[var(--text)] hover:bg-[var(--accent-2)]/30"
            }`}
            title={sharing ? "Stop Sharing" : "Share Screen"}
          >
            <ScreenShareIcon active={!!sharing} />
          </button>
          <button
            onClick={onDisconnect}
            className="p-3 rounded-full bg-red-600 hover:bg-red-700 text-white transition-colors"
            title="Disconnect"
          >
            <PhoneOffIcon />
          </button>
        </div>
      </div>
    </div>
  );
}
