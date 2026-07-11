"use client";

/**
 * Persistent "Voice Connected" bar. Shows while you're in a voice call but
 * viewing a different (text) channel — so the call keeps running in the
 * background and this bar is how you mute / deafen / hang up / jump back.
 * It's the ONLY disconnect path once channel-clicks stop leaving the call,
 * so it must always be reachable (incl. mobile).
 */
interface VoiceStatusBarProps {
  channelName: string;
  muted: boolean;
  deafened: boolean;
  reconnecting: boolean;
  onReturn: () => void;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onDisconnect: () => void;
}

export default function VoiceStatusBar({
  channelName,
  muted,
  deafened,
  reconnecting,
  onReturn,
  onToggleMute,
  onToggleDeafen,
  onDisconnect,
}: VoiceStatusBarProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-[var(--panel-2)] border-t border-[var(--accent-2)]/40 shadow-lg">
      {/* Status + channel name — click to jump back into the room */}
      <button
        onClick={onReturn}
        className="flex items-center gap-2 min-w-0 flex-1 text-left group"
        title="Return to the call"
        aria-label={`Return to ${channelName} voice room`}
      >
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          {!reconnecting && (
            <span className="absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-60 animate-ping" />
          )}
          <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${reconnecting ? "bg-yellow-500" : "bg-green-500"}`} />
        </span>
        <span className="min-w-0">
          <span className={`block text-xs font-semibold leading-tight ${reconnecting ? "text-yellow-400" : "text-green-400"}`}>
            {reconnecting ? "Reconnecting…" : "Voice Connected"}
          </span>
          <span className="block text-xs text-[var(--muted)] truncate group-hover:text-[var(--text)] transition-colors">
            🔊 {channelName}
          </span>
        </span>
      </button>

      {/* Controls */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={onToggleMute}
          title={muted ? "Unmute" : "Mute"}
          aria-label={muted ? "Unmute microphone" : "Mute microphone"}
          aria-pressed={muted}
          className={`p-1.5 rounded transition-colors ${muted ? "text-[var(--danger)] bg-[var(--danger)]/15" : "text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--panel)]"}`}
        >
          {muted ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="2" y1="2" x2="22" y2="22" />
              <path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2" />
              <path d="M5 10v2a7 7 0 0 0 12 5" />
              <path d="M15 9.34V5a3 3 0 0 0-5.68-1.33" />
              <path d="M9 9v3a3 3 0 0 0 5.12 2.12" />
              <line x1="12" y1="19" x2="12" y2="23" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
            </svg>
          )}
        </button>

        <button
          onClick={onToggleDeafen}
          title={deafened ? "Undeafen" : "Deafen"}
          aria-label={deafened ? "Undeafen" : "Deafen"}
          aria-pressed={deafened}
          className={`p-1.5 rounded transition-colors ${deafened ? "text-[var(--danger)] bg-[var(--danger)]/15" : "text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--panel)]"}`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
            <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
            {deafened && <line x1="2" y1="2" x2="22" y2="22" />}
          </svg>
        </button>

        <button
          onClick={onDisconnect}
          title="Disconnect"
          aria-label="Disconnect from voice"
          className="p-1.5 rounded text-[var(--danger)] hover:bg-[var(--danger)]/15 transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" />
            <line x1="2" y1="2" x2="22" y2="22" />
          </svg>
        </button>
      </div>
    </div>
  );
}
