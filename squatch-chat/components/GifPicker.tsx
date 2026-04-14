"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface Gif {
  id: string;
  title: string;
  url: string;
  preview: string;
}

interface GifPickerProps {
  onSelect: (gifUrl: string) => void;
  onClose: () => void;
}

export default function GifPicker({ onSelect, onClose }: GifPickerProps) {
  const [search, setSearch] = useState("");
  const [gifs, setGifs] = useState<Gif[]>([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    searchRef.current?.focus();
    fetchGifs("");
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

  const fetchGifs = useCallback(async (query: string) => {
    setLoading(true);
    try {
      const url = query
        ? `/api/gifs?q=${encodeURIComponent(query)}`
        : "/api/gifs";
      const res = await fetch(url);
      const data = await res.json();
      setGifs(data.gifs || []);
    } catch {
      setGifs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  function handleSearchChange(value: string) {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchGifs(value), 400);
  }

  return (
    <div
      ref={ref}
      className="w-80 bg-[var(--panel)] border border-[var(--accent-2)]/30 rounded-xl shadow-2xl flex flex-col overflow-hidden"
      style={{ maxHeight: "400px" }}
    >
      <div className="p-2 border-b border-[var(--accent-2)]/20">
        <input
          ref={searchRef}
          type="text"
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Search GIFs..."
          className="w-full px-3 py-1.5 text-sm bg-[var(--panel-2)] text-[var(--text)] border border-[var(--accent-2)]/30 rounded-lg focus:outline-none focus:border-[var(--accent-2)] placeholder:text-[var(--muted)]"
        />
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-[var(--muted)] text-sm">
            Loading GIFs...
          </div>
        ) : gifs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-[var(--muted)]">
            <span className="text-2xl mb-2">🎬</span>
            <span className="text-sm">
              {search ? "No GIFs found" : "Set GIPHY_API_KEY in .env to enable GIFs"}
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            {gifs.map((gif) => (
              <button
                key={gif.id}
                onClick={() => { onSelect(gif.url); onClose(); }}
                className="relative rounded-lg overflow-hidden aspect-square hover:ring-2 hover:ring-[var(--accent-2)] transition-all group"
              >
                <img
                  src={gif.preview || gif.url}
                  alt={gif.title}
                  className="w-full h-full object-cover"
                  loading="lazy"
                  onMouseEnter={(e) => { (e.target as HTMLImageElement).src = gif.url; }}
                  onMouseLeave={(e) => { if (gif.preview) (e.target as HTMLImageElement).src = gif.preview; }}
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="px-2 py-1 border-t border-[var(--accent-2)]/20 text-center">
        <span className="text-[10px] text-[var(--muted)]">Powered by GIPHY</span>
      </div>
    </div>
  );
}
