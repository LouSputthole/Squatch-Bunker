"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface SoundTheme {
  id: string;
  name: string;
  icon: string;
  sounds: { file: string; label: string }[];
}

const THEMES: SoundTheme[] = [
  {
    id: "campfire",
    name: "Campfire",
    icon: "🔥",
    sounds: [
      { file: "/sounds/campfire-crackle.mp3", label: "Crackling fire" },
      { file: "/sounds/campfire-wind.mp3", label: "Gentle wind" },
      { file: "/sounds/campfire-crickets.mp3", label: "Night crickets" },
    ],
  },
  {
    id: "forest",
    name: "Forest",
    icon: "🌲",
    sounds: [
      { file: "/sounds/forest-birds.mp3", label: "Birdsong" },
      { file: "/sounds/forest-stream.mp3", label: "Babbling stream" },
      { file: "/sounds/forest-leaves.mp3", label: "Rustling leaves" },
    ],
  },
  {
    id: "rain",
    name: "Rainstorm",
    icon: "🌧️",
    sounds: [
      { file: "/sounds/rain-light.mp3", label: "Light rain" },
      { file: "/sounds/rain-thunder.mp3", label: "Distant thunder" },
      { file: "/sounds/rain-roof.mp3", label: "Rain on roof" },
    ],
  },
  {
    id: "ocean",
    name: "Ocean",
    icon: "🌊",
    sounds: [
      { file: "/sounds/ocean-waves.mp3", label: "Waves" },
      { file: "/sounds/ocean-seagulls.mp3", label: "Seagulls" },
      { file: "/sounds/ocean-wind.mp3", label: "Coastal wind" },
    ],
  },
  {
    id: "night",
    name: "Night Sky",
    icon: "🌙",
    sounds: [
      { file: "/sounds/night-owls.mp3", label: "Owls" },
      { file: "/sounds/night-frogs.mp3", label: "Frogs" },
      { file: "/sounds/night-wind.mp3", label: "Night breeze" },
    ],
  },
  {
    id: "cave",
    name: "Cave",
    icon: "🪨",
    sounds: [
      { file: "/sounds/cave-drip.mp3", label: "Water drips" },
      { file: "/sounds/cave-echo.mp3", label: "Cave echoes" },
      { file: "/sounds/cave-rumble.mp3", label: "Deep rumble" },
    ],
  },
];

// All unique sound files needed (for asset list)
export const ALL_SOUND_FILES = THEMES.flatMap((t) => t.sounds.map((s) => s.file));

interface TrackState {
  volume: number;
  playing: boolean;
}

export default function AmbientSounds() {
  const [open, setOpen] = useState(false);
  const [activeTheme, setActiveTheme] = useState<string | null>(null);
  const [masterVolume, setMasterVolume] = useState(0.3);
  const [tracks, setTracks] = useState<Record<string, TrackState>>({});
  const audioRefs = useRef<Record<string, HTMLAudioElement>>({});

  const theme = THEMES.find((t) => t.id === activeTheme);

  const stopAll = useCallback(() => {
    Object.values(audioRefs.current).forEach((audio) => {
      audio.pause();
      audio.currentTime = 0;
    });
    audioRefs.current = {};
    setTracks({});
  }, []);

  const selectTheme = useCallback((themeId: string) => {
    stopAll();
    setActiveTheme(themeId);
    const t = THEMES.find((th) => th.id === themeId);
    if (!t) return;
    const initial: Record<string, TrackState> = {};
    t.sounds.forEach((s) => {
      initial[s.file] = { volume: 0.5, playing: true };
    });
    setTracks(initial);
  }, [stopAll]);

  // Manage audio elements
  useEffect(() => {
    if (!theme) return;

    theme.sounds.forEach((s) => {
      const state = tracks[s.file];
      if (!state) return;

      let audio = audioRefs.current[s.file];
      if (!audio) {
        audio = new Audio(s.file);
        audio.loop = true;
        audio.preload = "auto";
        audioRefs.current[s.file] = audio;
      }

      audio.volume = state.volume * masterVolume;

      if (state.playing && audio.paused) {
        audio.play().catch(() => {});
      } else if (!state.playing && !audio.paused) {
        audio.pause();
      }
    });
  }, [theme, tracks, masterVolume]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      Object.values(audioRefs.current).forEach((a) => {
        a.pause();
        a.currentTime = 0;
      });
    };
  }, []);

  function toggleTrack(file: string) {
    setTracks((prev) => ({
      ...prev,
      [file]: { ...prev[file], playing: !prev[file]?.playing },
    }));
  }

  function setTrackVolume(file: string, vol: number) {
    setTracks((prev) => ({
      ...prev,
      [file]: { ...prev[file], volume: vol },
    }));
  }

  const isPlaying = Object.values(tracks).some((t) => t.playing);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
          isPlaying
            ? "bg-amber-600/30 text-amber-400 animate-pulse"
            : "bg-[var(--panel-2)] text-[var(--muted)] hover:text-[var(--text)]"
        }`}
        title="Ambient Sounds"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
      </button>

      {open && (
        <div className="absolute bottom-12 right-0 w-72 bg-[var(--panel)] border border-[var(--accent-2)]/30 rounded-xl shadow-2xl z-50 overflow-hidden">
          {/* Header */}
          <div className="px-4 py-3 border-b border-[var(--accent-2)]/20 flex items-center justify-between">
            <span className="text-sm font-semibold text-[var(--text)]">Ambient Sounds</span>
            {isPlaying && (
              <button
                onClick={() => { stopAll(); setActiveTheme(null); }}
                className="text-xs text-red-400 hover:text-red-300"
              >
                Stop All
              </button>
            )}
          </div>

          {/* Theme selector */}
          <div className="px-3 py-2 border-b border-[var(--accent-2)]/20">
            <div className="grid grid-cols-3 gap-1.5">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => selectTheme(t.id)}
                  className={`flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg text-xs transition-colors ${
                    activeTheme === t.id
                      ? "bg-amber-600/20 text-amber-300 border border-amber-600/30"
                      : "bg-[var(--panel-2)] text-[var(--muted)] hover:text-[var(--text)] border border-transparent"
                  }`}
                >
                  <span className="text-base">{t.icon}</span>
                  <span className="truncate w-full text-center">{t.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Individual track controls */}
          {theme && (
            <div className="px-3 py-2 space-y-2">
              {theme.sounds.map((s) => {
                const state = tracks[s.file] || { volume: 0.5, playing: false };
                return (
                  <div key={s.file} className="flex items-center gap-2">
                    <button
                      onClick={() => toggleTrack(s.file)}
                      className={`w-6 h-6 rounded flex items-center justify-center text-xs ${
                        state.playing ? "text-amber-400" : "text-[var(--muted)]"
                      }`}
                    >
                      {state.playing ? "▶" : "⏸"}
                    </button>
                    <span className="text-xs text-[var(--text)] flex-1 truncate">{s.label}</span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={state.volume}
                      onChange={(e) => setTrackVolume(s.file, parseFloat(e.target.value))}
                      className="w-16 accent-amber-500"
                    />
                  </div>
                );
              })}
            </div>
          )}

          {/* Master volume */}
          <div className="px-3 py-2 border-t border-[var(--accent-2)]/20 flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--muted)] shrink-0">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            </svg>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={masterVolume}
              onChange={(e) => setMasterVolume(parseFloat(e.target.value))}
              className="flex-1 accent-amber-500"
            />
            <span className="text-xs text-[var(--muted)] w-8 text-right">{Math.round(masterVolume * 100)}%</span>
          </div>
        </div>
      )}
    </div>
  );
}
