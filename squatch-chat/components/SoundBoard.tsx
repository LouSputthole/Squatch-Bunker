"use client";

import { useState, useEffect, useRef, useCallback } from "react";

// Built-in one-shot sounds (static files in public/soundboard).
const BUILT_IN: { name: string; emoji: string; src: string }[] = [
  { name: "Airhorn", emoji: "📢", src: "/soundboard/airhorn.mp3" },
  { name: "Rimshot", emoji: "🥁", src: "/soundboard/rimshot.mp3" },
  { name: "Applause", emoji: "👏", src: "/soundboard/applause.mp3" },
  { name: "Drumroll", emoji: "🪘", src: "/soundboard/drumroll.mp3" },
  { name: "Ta-da", emoji: "🎉", src: "/soundboard/tada.mp3" },
  { name: "Scratch", emoji: "💿", src: "/soundboard/record-scratch.mp3" },
  { name: "Ding", emoji: "🔔", src: "/soundboard/bell-ding.mp3" },
  { name: "Sad Trombone", emoji: "🎺", src: "/soundboard/sad-trombone.mp3" },
];

const MAX_FILE = 600_000; // ~600KB raw -> ~800KB base64 (under the server cap)

interface CustomSound { id: string; name: string; emoji: string; dataUrl: string; createdBy: string }

export default function SoundBoard({
  serverId,
  currentUserId,
  onPlay,
}: {
  serverId?: string;
  currentUserId?: string;
  onPlay: (src: string, name?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState<CustomSound[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!serverId) return;
    try {
      const r = await fetch(`/api/servers/${serverId}/sounds`);
      if (r.ok) setCustom((await r.json()).sounds || []);
    } catch { /* ignore */ }
  }, [serverId]);

  useEffect(() => { if (open) load(); }, [open, load]);

  async function handleFile(file: File) {
    setError("");
    setUploading(true);
    try {
      if (!file.type.startsWith("audio/")) throw new Error("Please pick an audio file");
      if (file.size > MAX_FILE) throw new Error("File too large — keep it short (≤8s)");
      const dataUrl = await new Promise<string>((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result as string);
        fr.onerror = () => rej(new Error("Couldn't read file"));
        fr.readAsDataURL(file);
      });
      const dur = await new Promise<number>((res) => {
        const a = new Audio(dataUrl);
        a.onloadedmetadata = () => res(a.duration || 0);
        a.onerror = () => res(99);
      });
      if (dur > 8.5) throw new Error("Clip must be 8 seconds or less");
      const name = file.name.replace(/\.[^.]+$/, "").slice(0, 24) || "Sound";
      const r = await fetch(`/api/servers/${serverId}/sounds`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, dataUrl }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Upload failed");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function del(id: string) {
    if (!serverId) return;
    const r = await fetch(`/api/servers/${serverId}/sounds/${id}`, { method: "DELETE" });
    if (r.ok) setCustom((c) => c.filter((s) => s.id !== id));
    else setError("Couldn't delete that sound");
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        title="Soundboard"
        aria-label="Soundboard"
        className="text-[var(--text)] flex items-center justify-center"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-50 w-72 bg-[var(--panel)] border border-[var(--accent-2)]/30 rounded-xl shadow-2xl overflow-hidden">
            <div className="px-3 py-2 border-b border-[var(--accent-2)]/20 flex items-center justify-between">
              <span className="text-sm font-semibold text-[var(--text)]">Soundboard</span>
              <span className="text-[10px] text-[var(--muted)]">plays for everyone</span>
            </div>

            <div className="p-2 grid grid-cols-3 gap-1.5 max-h-64 overflow-y-auto">
              {BUILT_IN.map((s) => (
                <button
                  key={s.src}
                  onClick={() => onPlay(s.src, s.name)}
                  className="flex flex-col items-center gap-1 py-2 rounded-lg bg-[var(--panel-2)] hover:bg-amber-600/20 text-[var(--text)] transition-colors"
                  title={s.name}
                >
                  <span className="text-lg">{s.emoji}</span>
                  <span className="text-[10px] truncate w-full text-center px-1">{s.name}</span>
                </button>
              ))}
              {custom.map((s) => (
                <div key={s.id} className="relative group">
                  <button
                    onClick={() => onPlay(s.dataUrl, s.name)}
                    className="w-full flex flex-col items-center gap-1 py-2 rounded-lg bg-[var(--panel-2)] hover:bg-amber-600/20 text-[var(--text)] transition-colors"
                    title={s.name}
                  >
                    <span className="text-lg">{s.emoji}</span>
                    <span className="text-[10px] truncate w-full text-center px-1">{s.name}</span>
                  </button>
                  {(s.createdBy === currentUserId) && (
                    <button
                      onClick={() => del(s.id)}
                      className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[var(--danger)] text-white text-[10px] hidden group-hover:flex items-center justify-center"
                      title="Delete sound"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="px-3 py-2 border-t border-[var(--accent-2)]/20">
              {error && <p className="text-[10px] text-[var(--danger)] mb-1">{error}</p>}
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading || !serverId}
                className="w-full text-xs py-1.5 rounded-lg bg-amber-600/30 text-amber-200 hover:bg-amber-600/40 disabled:opacity-40 transition-colors"
              >
                {uploading ? "Uploading…" : "＋ Upload a sound (≤8s)"}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
