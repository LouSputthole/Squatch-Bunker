"use client";

import { displayName, initials } from "@/lib/utils";

interface VoiceParticipant {
  userId: string;
  username: string;
  muted: boolean;
  deafened?: boolean;
}

interface VoiceRoomProps {
  channelName: string;
  participants: VoiceParticipant[];
  currentUserId: string;
  muted: boolean;
  deafened: boolean;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onDisconnect: () => void;
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

export default function VoiceRoom({
  channelName,
  participants,
  currentUserId,
  muted,
  deafened,
  onToggleMute,
  onToggleDeafen,
  onDisconnect,
}: VoiceRoomProps) {
  return (
    <div className="flex-1 flex flex-col bg-[var(--panel-2)]">
      {/* Header */}
      <div className="h-12 px-4 flex items-center border-b border-[var(--accent-2)]/30 bg-[var(--panel-2)] shrink-0">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-400 mr-2 shrink-0">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        </svg>
        <h3 className="font-bold text-[var(--text)]">{channelName}</h3>
        <span className="ml-2 text-xs text-[var(--muted)]">
          {participants.length} {participants.length === 1 ? "person" : "people"} connected
        </span>
      </div>

      {/* Participant Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {participants.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[var(--muted)]">
            <div className="text-center">
              <p className="text-lg mb-1">No one here yet</p>
              <p className="text-sm">Waiting for others to join...</p>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-4 justify-center items-start content-center min-h-full">
            {participants.map((p) => {
              const isSelf = p.userId === currentUserId;
              return (
                <div
                  key={p.userId}
                  className={`flex flex-col items-center gap-2 p-4 rounded-xl transition-all ${
                    isSelf
                      ? "bg-[var(--accent)]/10 border border-[var(--accent)]/30"
                      : "bg-[var(--panel)]/50 border border-[var(--accent-2)]/20"
                  }`}
                  style={{ minWidth: 120 }}
                >
                  {/* Avatar */}
                  <div className="relative">
                    <div
                      className={`w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold ${
                        isSelf
                          ? "bg-[var(--accent)] text-[var(--bg)]"
                          : "bg-[var(--accent-2)] text-[var(--text)]"
                      } ${p.muted ? "opacity-60" : ""}`}
                    >
                      {initials(p.username)}
                    </div>
                    {/* Speaking ring — shows when not muted */}
                    {!p.muted && (
                      <div className="absolute inset-0 rounded-full border-2 border-green-500/50 animate-pulse" />
                    )}
                    {/* Status badges */}
                    <div className="absolute -bottom-1 -right-1 flex gap-0.5">
                      {p.muted && (
                        <div className="bg-[var(--bg)] rounded-full p-0.5">
                          <MicOffSmall />
                        </div>
                      )}
                      {p.deafened && (
                        <div className="bg-[var(--bg)] rounded-full p-0.5">
                          <DeafSmall />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Name */}
                  <span
                    className={`text-sm font-medium truncate max-w-[100px] ${
                      isSelf ? "text-[var(--accent)]" : "text-[var(--text)]"
                    } ${p.muted ? "opacity-60" : ""}`}
                  >
                    {displayName(p.username)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Bottom Controls Bar */}
      <div className="px-6 py-4 border-t border-[var(--accent-2)]/30 bg-[var(--panel)] shrink-0">
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
