"use client";

import { useState, useRef, useEffect } from "react";
import { displayName } from "@/lib/utils";
import Avatar from "@/components/Avatar";
import CircleView, { DEFAULT_SEATS } from "@/components/CircleView";
import EmberReactions from "@/components/EmberReactions";
import { getSocket } from "@/lib/socket";
import { voiceRoomModeLabel } from "@/lib/voiceRoomConfig";
import AmbientSounds from "@/components/AmbientSounds";
import SoundBoard from "@/components/SoundBoard";
import type { ScreenShareInfo } from "@/components/VoicePanel";

interface VoiceParticipant {
  userId: string;
  username: string;
  muted: boolean;
  deafened?: boolean;
  speaking?: boolean;
  avatar?: string | null;
  connectionQuality?: "good" | "fair" | "poor" | "unknown";
  pingMs?: number;
}

interface VoiceChannel {
  id: string;
  name: string;
  type?: string;
}
interface LanternRoomState {
  channelId: string;
  active: boolean;
  hostId: string | null;
  holderId: string | null;
  queue: { userId: string; username: string }[];
}
interface OffshootRoomSummary {
  id: string;
  name: string;
  creatorId: string;
  members: { userId: string; username: string }[];
}
interface OffshootState {
  channelId: string;
  offshoots: OffshootRoomSummary[];
  limits: {
    maxOffshoots: number;
    maxMembers: number;
  };
}
interface OffshootError {
  channelId: string;
  message: string;
}
const EMPTY_OFFSHOOTS: OffshootRoomSummary[] = [];


interface VoiceRoomProps {
  channelId: string;
  channelName: string;
  roomMode?: string;
  roomScene?: string;
  participants: VoiceParticipant[];
  currentUserId: string;
  currentUserRole?: string;
  canManageChannels?: boolean;
  muted: boolean;
  deafened: boolean;
  pttMode?: boolean;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onTogglePTT?: () => void;
  onDisconnect: () => void;
  onUserVolumeChange?: (userId: string, volume: number) => void;
  onUserRoutingMuted?: (userId: string, muted: boolean) => void;
  onServerMute?: (channelId: string, targetUserId: string, muted: boolean) => void;
  onServerDeafen?: (channelId: string, targetUserId: string, deafened: boolean) => void;
  onKickFromVoice?: (channelId: string, targetUserId: string) => void;
  onMoveUser?: (fromChannelId: string, toChannelId: string, targetUserId: string) => void;
  voiceChannels?: VoiceChannel[];
  serverId?: string;
  onPlaySound?: (src: string, name?: string) => void;
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

function VideoTile({ stream, label, isSelf, speaking }: { stream: MediaStream; label: string; isSelf?: boolean; speaking?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div
      className={`relative rounded-xl overflow-hidden border-2 ${speaking ? "border-amber-400" : isSelf ? "border-[var(--accent)]/30" : "border-[var(--accent-2)]/20"} bg-black transition-colors`}
      style={{ boxShadow: speaking ? "0 0 22px rgba(251,191,36,0.6)" : undefined }}
    >
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

// Room backgrounds — one per ambient-sound theme.
const ROOM_THEMES: { id: string; name: string; icon: string; img: string }[] = [
  { id: "campfire", name: "Campfire", icon: "🔥", img: "/rooms/campfire.png" },
  { id: "forest", name: "Forest", icon: "🌲", img: "/rooms/forest.png" },
  { id: "rain", name: "Rainstorm", icon: "🌧️", img: "/rooms/rain.png" },
  { id: "ocean", name: "Ocean", icon: "🌊", img: "/rooms/ocean.png" },
  { id: "night", name: "Night Sky", icon: "🌙", img: "/rooms/night.png" },
  { id: "cave", name: "Cave", icon: "🪨", img: "/rooms/cave.png" },
];

// Per-theme seat coordinates (% of the art). campfire/night/cave/ocean share the
// default wide ring; forest and rain have their own tighter/shifted rings.
const SEATS_BY_THEME: Record<string, { x: number; y: number }[]> = {
  forest: [
    { x: 51, y: 82 }, { x: 33, y: 80 }, { x: 19, y: 60 }, { x: 30, y: 39 },
    { x: 49, y: 33 }, { x: 64, y: 38 }, { x: 80, y: 58 }, { x: 64, y: 82 },
  ],
  rain: [
    { x: 45, y: 85 }, { x: 30, y: 82 }, { x: 18, y: 66 }, { x: 29, y: 44 },
    { x: 46, y: 38 }, { x: 62, y: 42 }, { x: 75, y: 62 }, { x: 72, y: 82 },
  ],
};

export default function VoiceRoom({
  channelId,
  channelName,
  participants,
  roomMode,
  roomScene,
  currentUserId,
  currentUserRole,
  canManageChannels = false,
  muted,
  deafened,
  pttMode,
  onToggleMute,
  onToggleDeafen,
  onTogglePTT,
  onDisconnect,
  onUserVolumeChange,
  onUserRoutingMuted,
  onServerMute,
  onServerDeafen,
  onKickFromVoice,
  onMoveUser,
  voiceChannels,
  serverId,
  onPlaySound,
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
  const [viewMode, setViewMode] = useState<"campfire" | "grid">("campfire");
  const [roomThemeId, setRoomThemeId] = useState(() => ROOM_THEMES.some((theme) => theme.id === roomScene) ? roomScene! : "campfire");
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const [lantern, setLantern] = useState<LanternRoomState | null>(null);
  const [offshootState, setOffshootState] = useState<OffshootState | null>(null);
  const [offshootError, setOffshootError] = useState<string | null>(null);
  const [roomConfigError, setRoomConfigError] = useState<string | null>(null);
  const automaticallyMutedRef = useRef(new Set<string>());
  const prevParticipantsRef = useRef<VoiceParticipant[]>([]);
  const toastCounterRef = useRef(0);
  const isFirstRenderRef = useRef(true);

  const canModerateVoice =
    currentUserRole === "owner" ||
    currentUserRole === "admin" ||
    currentUserRole === "mod";
  const otherVoiceChannels = voiceChannels?.filter((c) => c.id !== channelId && c.type === "voice") || [];
  const roomTheme = ROOM_THEMES.find((t) => t.id === roomThemeId) || ROOM_THEMES[0];
  const activeLantern = lantern?.channelId === channelId && lantern.active ? lantern : null;
  const lanternHolder = participants.find((participant) => participant.userId === activeLantern?.holderId);
  const isLanternHolder = activeLantern?.holderId === currentUserId;
  const isLanternQueued = activeLantern?.queue.some((entry) => entry.userId === currentUserId) ?? false;
  const canStopLantern =
    !!activeLantern &&
    (activeLantern.hostId === currentUserId || canModerateVoice);
  const nextLanternCamper = activeLantern?.queue[0];
  const activeOffshootState = offshootState?.channelId === channelId ? offshootState : null;
  const offshoots = activeOffshootState?.offshoots ?? EMPTY_OFFSHOOTS;
  const currentOffshoot = offshoots.find((room) => room.members.some((member) => member.userId === currentUserId));
  const offshootMemberIds = new Set(offshoots.flatMap((room) => room.members.map((member) => member.userId)));
  const mainCampParticipants = participants.filter((participant) => !offshootMemberIds.has(participant.userId));
  const maxOffshoots = activeOffshootState?.limits.maxOffshoots ?? 3;


  async function pickTheme(id: string) {
    if (
      !canManageChannels ||
      !ROOM_THEMES.some((theme) => theme.id === id)
    ) {
      return;
    }
    setRoomConfigError(null);
    try {
      const response = await fetch(`/api/channels/${channelId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomScene: id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setRoomConfigError(
          data.error || "Failed to update the shared scene.",
        );
        return;
      }
      const updatedScene = data.channel?.roomScene || id;
      setRoomThemeId(updatedScene);
      setThemePickerOpen(false);
      if (serverId) {
        getSocket().emit("channels:updated", { serverId, channelIds: [channelId] });
      }
    } catch {
      setRoomConfigError("Failed to update the shared scene.");
    }
  }


  useEffect(() => {
    const socket = getSocket();
    function handleLanternUpdate(state: LanternRoomState) {
      if (state.channelId !== channelId) return;
      setLantern(state.active ? state : null);
    }
    function handleOffshootUpdate(state: OffshootState) {
      if (state.channelId !== channelId) return;
      setOffshootState(state);
      setOffshootError(null);
    }
    function handleOffshootError(error: OffshootError) {
      if (error.channelId !== channelId) return;
      setOffshootError(error.message);
    }

    socket.on("lantern:update", handleLanternUpdate);
    socket.on("offshoot:update", handleOffshootUpdate);
    socket.on("offshoot:error", handleOffshootError);
    socket.emit("lantern:state", channelId);
    socket.emit("offshoot:state", channelId);
    return () => {
      socket.off("lantern:update", handleLanternUpdate);
      socket.off("offshoot:update", handleOffshootUpdate);
      socket.off("offshoot:error", handleOffshootError);
    };
  }, [channelId]);

  function startLantern() {
    getSocket().emit("lantern:start", channelId);
  }

  function requestLantern() {
    getSocket().emit("lantern:request", channelId);
  }

  function releaseLantern() {
    getSocket().emit("lantern:release", channelId);
  }

  function passLantern(targetUserId: string) {
    getSocket().emit("lantern:pass", { channelId, targetUserId });
  }
  function createOffshoot() {
    getSocket().emit("offshoot:create", { channelId });
  }

  function joinOffshoot(offshootId: string) {
    getSocket().emit("offshoot:join", { channelId, offshootId });
  }

  function rejoinMainCamp() {
    getSocket().emit("offshoot:leave", { channelId });
  }

  function closeOffshoot(offshootId: string) {
    getSocket().emit("offshoot:close", { channelId, offshootId });
  }

  useEffect(() => {
    if (!onUserRoutingMuted) return;
    const nextMuted = new Set<string>();
    const myOffshootId = currentOffshoot?.id ?? null;

    if (activeOffshootState) {
      for (const participant of participants) {
        if (participant.userId === currentUserId) continue;
        const participantOffshootId = offshoots.find((room) =>
          room.members.some((member) => member.userId === participant.userId)
        )?.id ?? null;
        if (participantOffshootId !== myOffshootId) {
          nextMuted.add(participant.userId);
        }
      }
    }

    for (const userId of automaticallyMutedRef.current) {
      if (!nextMuted.has(userId)) {
        onUserRoutingMuted(userId, false);
      }
    }
    for (const userId of nextMuted) {
      if (!automaticallyMutedRef.current.has(userId)) {
        onUserRoutingMuted(userId, true);
      }
    }
    automaticallyMutedRef.current = nextMuted;
  }, [activeOffshootState, currentOffshoot?.id, currentUserId, offshoots, onUserRoutingMuted, participants]);

  useEffect(() => () => {
    for (const userId of automaticallyMutedRef.current) {
      onUserRoutingMuted?.(userId, false);
    }
    automaticallyMutedRef.current.clear();
  }, [onUserRoutingMuted]);
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
        <span className="ml-2 px-2 py-0.5 rounded-full bg-amber-500/10 text-[10px] uppercase tracking-wider text-amber-200/80">
          {voiceRoomModeLabel(roomMode)}
        </span>
        {reconnecting ? (
          <span className="ml-2 text-xs text-yellow-400 animate-pulse">
            Reconnecting...
          </span>
        ) : (
          <span className="ml-2 text-xs text-[var(--muted)]">
            {participants.length} {participants.length === 1 ? "person" : "people"} connected
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {/* Room theme picker (campfire view only) */}
          {viewMode === "campfire" && (
            <div className="relative">
              <button
                onClick={() => setThemePickerOpen((o) => !o)}
                disabled={!canManageChannels}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-[var(--panel-2)] text-[var(--muted)] hover:text-amber-200 transition-colors"
                title={canManageChannels ? "Change the shared room scene" : "Only channel managers can change the shared scene"}
              >
                <span>{roomTheme.icon}</span> {roomTheme.name}
              </button>
              {themePickerOpen && canManageChannels && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setThemePickerOpen(false)} />
                  <div className="absolute right-0 top-9 z-50 w-60 bg-[var(--panel)] border border-[var(--accent-2)]/30 rounded-xl shadow-2xl p-2 grid grid-cols-2 gap-1.5">
                    {ROOM_THEMES.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => pickTheme(t.id)}
                        className={`relative h-14 rounded-lg overflow-hidden border-2 ${t.id === roomThemeId ? "border-amber-400" : "border-transparent"} group`}
                        style={{ backgroundImage: `url('${t.img}')`, backgroundSize: "cover", backgroundPosition: "center" }}
                        title={t.name}
                      >
                        <span className="absolute inset-0 bg-black/30 group-hover:bg-black/10 transition-colors" />
                        <span className="absolute bottom-1 left-1 text-[10px] text-white font-semibold drop-shadow">{t.icon} {t.name}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          {/* View toggle: campfire circle <-> standard grid */}
          <button
            onClick={() => setViewMode((m) => (m === "campfire" ? "grid" : "campfire"))}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-[var(--panel-2)] text-[var(--muted)] hover:text-amber-200 transition-colors"
            title={viewMode === "campfire" ? "Switch to grid view (Discord-style)" : "Switch to campfire view"}
          >
            {viewMode === "campfire" ? (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
                Grid
              </>
            ) : (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2s4 4 4 8a4 4 0 0 1-8 0c0-1.5.5-2.5 1-3.5" /><path d="M8 14a4 4 0 1 0 8 0c0-2-2-3-2-3" /></svg>
                Campfire
              </>
            )}
          </button>
        </div>
      </div>

      {roomConfigError && (
        <div
          className="flex items-center justify-center gap-2 border-b border-red-500/25 bg-red-500/10 px-4 py-2 text-xs text-red-200"
          role="alert"
        >
          <span>{roomConfigError}</span>
          <button
            type="button"
            onClick={() => setRoomConfigError(null)}
            className="text-red-100/60 hover:text-red-100"
            aria-label="Dismiss scene error"
          >
            &times;
          </button>
        </div>
      )}

      {/* Reconnecting banner */}
      {reconnecting && (
        <div className="flex items-center justify-center gap-2 px-4 py-2 bg-yellow-500/15 border-b border-yellow-500/30 text-yellow-300 text-sm font-medium shrink-0">
          <span>&#9889;</span>
          <span>Reconnecting to voice...</span>
        </div>
      )}
      {/* Temporary side conversations that stay attached to this parent room. */}
      <div className="shrink-0 border-b border-emerald-500/15 bg-emerald-950/10 px-3 py-2">
        <div className="flex flex-wrap items-stretch justify-center gap-2 text-xs">
          <span className="self-center font-semibold uppercase tracking-wider text-emerald-200/70">
            Offshoots
          </span>
          <button
            type="button"
            onClick={rejoinMainCamp}
            disabled={!currentOffshoot}
            className={`min-w-36 rounded-lg border px-3 py-1.5 text-left transition-colors ${
              currentOffshoot
                ? "border-white/10 bg-white/5 text-white/75 hover:bg-white/10"
                : "border-amber-400/40 bg-amber-500/15 text-amber-100"
            }`}
            title={currentOffshoot ? "Leave this side fire and rejoin everyone at the main camp" : "You are at the main camp"}
          >
            <span className="block font-semibold">{currentOffshoot ? "Rejoin main" : "Main camp"}</span>
            <span className="block max-w-52 truncate text-[10px] opacity-65">
              Main camp: {mainCampParticipants.map((participant) => displayName(participant.username)).join(", ") || "Empty"}
            </span>
          </button>

          {offshoots.map((room) => {
            const isCurrent = room.id === currentOffshoot?.id;
            const isFull = room.members.length >= (activeOffshootState?.limits.maxMembers ?? 4);
            const canClose =
              room.creatorId === currentUserId || canModerateVoice;
            return (
              <div
                key={room.id}
                className={`flex min-w-40 items-stretch overflow-hidden rounded-lg border ${
                  isCurrent ? "border-emerald-400/60 bg-emerald-500/15" : "border-emerald-500/20 bg-black/10"
                }`}
              >
                <button
                  type="button"
                  onClick={() => joinOffshoot(room.id)}
                  disabled={isCurrent || isFull}
                  className="flex-1 px-3 py-1.5 text-left text-emerald-50 transition-colors hover:bg-emerald-500/10 disabled:cursor-default disabled:hover:bg-transparent"
                  title={isCurrent ? `You are in ${room.name}` : isFull ? `${room.name} is full` : `Join ${room.name}`}
                >
                  <span className="block font-semibold">
                    {room.name} <span className="font-normal opacity-60">{room.members.length}/{activeOffshootState?.limits.maxMembers ?? 4}</span>
                  </span>
                  <span className="block max-w-44 truncate text-[10px] opacity-65">
                    {isCurrent ? "You are here: " : `${room.name}: `}
                    {room.members.map((member) => displayName(member.username)).join(", ")}
                  </span>
                </button>
                {canClose && (
                  <button
                    type="button"
                    onClick={() => closeOffshoot(room.id)}
                    className="border-l border-emerald-500/20 px-2 text-emerald-100/55 hover:bg-red-500/15 hover:text-red-300"
                    aria-label={`Close ${room.name}`}
                    title="Close side fire"
                  >
                    &times;
                  </button>
                )}
              </div>
            );
          })}

          {!currentOffshoot && offshoots.length < maxOffshoots && (
            <button
              type="button"
              onClick={createOffshoot}
              disabled={!activeOffshootState}
              className="rounded-lg border border-dashed border-emerald-400/30 px-3 py-1.5 font-semibold text-emerald-200/80 hover:border-emerald-400/60 hover:bg-emerald-500/10 disabled:opacity-40"
              title="Start a temporary side voice conversation"
            >
              + Start side fire
            </button>
          )}
        </div>
        {offshootError && (
          <div className="mt-1 text-center text-[11px] text-red-300" role="status">
            {offshootError}
            <button type="button" onClick={() => setOffshootError(null)} className="ml-2 text-red-100/60 hover:text-red-100" aria-label="Dismiss">
              &times;
            </button>
          </div>
        )}
      </div>

      {!activeLantern ? (
        <div className="flex items-center justify-center gap-2 px-4 py-1.5 bg-amber-950/20 border-b border-amber-600/10 text-xs shrink-0">
          <span className="text-amber-200/80">Taking turns for a story or recap?</span>
          <button
            onClick={startLantern}
            className="px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-200 hover:bg-amber-500/25 transition-colors"
          >
            Pass the Lantern
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-center gap-2 px-4 py-2 bg-amber-500/10 border-b border-amber-500/25 text-xs shrink-0">
          <span aria-hidden="true">&#128293;</span>
          <span className="font-semibold text-amber-200">
            Lantern: {lanternHolder ? displayName(lanternHolder.username) : "open floor"}
          </span>
          {activeLantern.queue.length > 0 && (
            <span className="text-amber-100/60">
              Up next: {activeLantern.queue.map((entry) => displayName(entry.username)).join(", ")}
            </span>
          )}
          {isLanternHolder ? (
            <>
              {nextLanternCamper && (
                <button
                  onClick={() => passLantern(nextLanternCamper.userId)}
                  className="px-2.5 py-1 rounded-full bg-amber-500 text-amber-950 font-semibold hover:bg-amber-400"
                >
                  Pass to {displayName(nextLanternCamper.username)}
                </button>
              )}
              <button onClick={releaseLantern} className="px-2.5 py-1 rounded-full bg-white/5 text-amber-100 hover:bg-white/10">
                Release
              </button>
            </>
          ) : isLanternQueued ? (
            <span className="px-2.5 py-1 rounded-full bg-white/5 text-amber-100/70">You are in line</span>
          ) : (
            <button onClick={requestLantern} className="px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-100 hover:bg-amber-500/30">
              Raise hand
            </button>
          )}
          {canStopLantern && (
            <button onClick={() => getSocket().emit("lantern:stop", channelId)} className="text-amber-100/60 hover:text-amber-100">
              End
            </button>
          )}
        </div>
      )}

      {/* Ember Reactions overlay */}
      <EmberReactions channelId={channelId} />

      {/* Main stage: screen share > campfire circle / standard grid */}
      {(() => {
        const screenActive = !!(incomingScreenShares && incomingScreenShares.length > 0);
        const handleCtx = (e: React.MouseEvent, p: VoiceParticipant) => {
          if (canModerateVoice) {
            setModMenu({ userId: p.userId, username: p.username, x: e.clientX, y: e.clientY, muted: p.muted, deafened: p.deafened });
            setVolumePopup(null);
          } else if (p.userId !== currentUserId) {
            setVolumePopup({ userId: p.userId, volume: 1 });
          }
        };

        if (screenActive) {
          return (
            <>
              <ScreenViewer shares={incomingScreenShares!} />
              {/* Compact participant strip under the shared screen */}
              <div className="h-24 shrink-0 overflow-x-auto overflow-y-hidden px-4 py-2 flex items-center gap-3 justify-center bg-[#1a1a1e]/50">
                {participants.map((p) => {
                  const isSelf = p.userId === currentUserId;
                  return (
                    <div key={p.userId} className="flex flex-col items-center gap-1 shrink-0">
                      <div className="relative">
                        <Avatar username={p.username} avatarUrl={p.avatar} size={40}
                          className={`${isSelf ? "bg-amber-600/80 text-[var(--bg)]" : "bg-[#2a2a2e] text-[var(--text)]"} ${p.muted ? "opacity-50" : ""}`} />
                        {p.speaking && !p.muted && <div className="absolute inset-[-2px] rounded-full border-2 border-amber-400/60" />}
                      </div>
                      <span className={`text-[10px] truncate max-w-[50px] ${p.speaking && !p.muted ? "text-amber-300" : "text-[var(--muted)]"}`}>
                        {isSelf ? "You" : displayName(p.username)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          );
        }

        if (viewMode === "campfire") {
          return (
            <CircleView
              participants={participants}
              currentUserId={currentUserId}
              image={roomTheme.img}
              seats={SEATS_BY_THEME[roomThemeId] || DEFAULT_SEATS}
              cameraOn={cameraOn}
              localCameraStream={localCameraStream}
              remoteVideoStreams={remoteVideoStreams}
              onContextMenu={handleCtx}
              highlightUserId={activeLantern?.holderId}
            />
          );
        }

        // Standard grid view (Discord-style) — cameras show as tiles, others as avatars
        return (
          <div className="flex-1 overflow-y-auto p-4 min-h-0">
            <div className="grid gap-3 content-center min-h-full" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
              {participants.map((p) => {
                const isSelf = p.userId === currentUserId;
                const stream = isSelf ? (cameraOn ? localCameraStream : null) : (remoteVideoStreams?.get(p.userId) || null);
                const isSpeaking = p.speaking && !p.muted;
                const holdsLantern = activeLantern?.holderId === p.userId;
                return (
                  <div
                    key={p.userId}
                    onContextMenu={(e) => { if (p.userId !== currentUserId) { e.preventDefault(); handleCtx(e, p); } }}
                    className={`aspect-video relative rounded-xl ${holdsLantern ? "ring-4 ring-yellow-200 shadow-[0_0_28px_rgba(253,224,71,0.65)]" : ""}`}
                  >
                    {stream ? (
                      <VideoTile stream={stream} label={isSelf ? "You" : displayName(p.username)} isSelf={isSelf} speaking={isSpeaking} />
                    ) : (
                      <div className={`w-full h-full rounded-xl border-2 flex flex-col items-center justify-center gap-2 bg-[#202024] ${isSpeaking ? "border-amber-400" : "border-transparent"}`}>
                        <Avatar username={p.username} avatarUrl={p.avatar} size={56}
                          className={`${isSelf ? "bg-amber-600/80 text-[var(--bg)]" : "bg-[#2a2a2e] text-[var(--text)]"} ${p.muted ? "opacity-60" : ""}`} />
                        <span className="text-xs text-white/80 flex items-center gap-1">
                          {p.muted && <span className="text-red-400">🔇</span>}
                          {isSelf ? "You" : displayName(p.username)}
                        </span>
                      </div>
                    )}
                    {holdsLantern && (
                      <span className="absolute top-2 left-2 text-[9px] uppercase tracking-widest text-yellow-100 bg-amber-950/90 px-2 py-1 rounded-full">Lantern</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Screen share self-preview — small PiP when you're sharing */}
      {sharing && localScreenStream && (
        <SelfScreenPreview stream={localScreenStream} />
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
          {/* Ambient soundscape — right in the call controls */}
          <div className="p-3 rounded-full bg-[var(--panel-2)] hover:bg-[var(--accent-2)]/30 transition-colors flex items-center justify-center">
            <AmbientSounds />
          </div>
          {/* Soundboard */}
          {onPlaySound && (
            <div className="p-3 rounded-full bg-[var(--panel-2)] hover:bg-[var(--accent-2)]/30 transition-colors flex items-center justify-center">
              <SoundBoard serverId={serverId} currentUserId={currentUserId} onPlay={onPlaySound} />
            </div>
          )}
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
