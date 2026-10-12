"use client";

import Image from "next/image";
import { useState, useRef, useEffect } from "react";
import { useEscape } from "@/hooks/useEscape";

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


async function requestGifs(query: string, signal: AbortSignal): Promise<Gif[]> {
  const url = query
    ? `/api/gifs?q=${encodeURIComponent(query)}`
    : "/api/gifs";
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("Failed to load GIFs");
  const data = await response.json() as { gifs?: Gif[] };
  return data.gifs || [];
}

function GifResult({ gif, onSelect, onClose }: {
  gif: Gif;
  onSelect: (gifUrl: string) => void;
  onClose: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={() => {
        onSelect(gif.url);
        onClose();
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-label={gif.title ? `Send GIF: ${gif.title}` : "Send GIF"}
      title={gif.title || undefined}
      className="relative rounded-lg overflow-hidden aspect-square hover:ring-2 hover:ring-[var(--accent-2)] transition-all group"
    >
      <Image
        src={hovered ? gif.url : gif.preview || gif.url}
        alt={gif.title}
        fill
        sizes="9rem"
        className="object-cover"
        unoptimized
      />
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
    </button>
  );
}
export default function GifPicker({ onSelect, onClose }: GifPickerProps) {
  const [search, setSearch] = useState("");
  const [gifs, setGifs] = useState<Gif[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const requestControllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const requestId = ++requestIdRef.current;
    requestControllerRef.current = controller;

    searchRef.current?.focus();
    requestGifs("", controller.signal)
      .then((results) => {
        if (requestId === requestIdRef.current) setGifs(results);
      })
      .catch((error: unknown) => {
        if (
          requestId === requestIdRef.current
          && !(error instanceof DOMException && error.name === "AbortError")
        ) {
          setGifs([]);
          setFailed(true);
        }
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false);
      });

    return () => {
      requestControllerRef.current?.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  useEscape(onClose);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [onClose]);

  function handleSearchChange(value: string) {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      requestControllerRef.current?.abort();
      const controller = new AbortController();
      const requestId = ++requestIdRef.current;
      requestControllerRef.current = controller;
      setLoading(true);
      setFailed(false);
      requestGifs(value, controller.signal)
        .then((results) => {
          if (requestId === requestIdRef.current) setGifs(results);
        })
        .catch((error: unknown) => {
          if (
            requestId === requestIdRef.current
            && !(error instanceof DOMException && error.name === "AbortError")
          ) {
            setGifs([]);
            setFailed(true);
          }
        })
        .finally(() => {
          if (requestId === requestIdRef.current) setLoading(false);
        });
    }, 400);
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
          aria-label="Search GIFs"
          className="w-full px-3 py-1.5 text-sm bg-[var(--panel-2)] text-[var(--text)] border border-[var(--accent-2)]/30 rounded-lg focus:outline-none focus:border-[var(--accent-2)] placeholder:text-[var(--muted)]"
        />
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-[var(--muted)] text-sm">
            Loading GIFs...
          </div>
        ) : gifs.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-8 text-center text-[var(--muted)]">
            <span className="text-2xl mb-2" aria-hidden="true">🎬</span>
            <span className="text-sm text-[var(--text)]">
              {failed ? "Couldn't load GIFs right now" : search ? "No GIFs found" : "GIFs aren't set up on this server"}
            </span>
            {!failed && !search && (
              <span className="mt-1 text-[11px]">Server owners can turn them on with a GIPHY or Tenor API key.</span>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            {gifs.map((gif) => (
              <GifResult
                key={gif.id}
                gif={gif}
                onSelect={onSelect}
                onClose={onClose}
              />
            ))}
          </div>
        )}
      </div>

      {gifs.length > 0 && (
        <div className="px-2 py-1 border-t border-[var(--accent-2)]/20 text-center">
          <span className="text-[10px] text-[var(--muted)]">Powered by GIPHY</span>
        </div>
      )}
    </div>
  );
}
