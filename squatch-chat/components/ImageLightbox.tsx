"use client";

import { useEffect, useCallback } from "react";

interface ImageLightboxProps {
  src: string;
  allSrcs: string[];
  onClose: () => void;
  onNavigate: (src: string) => void;
}

export default function ImageLightbox({ src, allSrcs, onClose, onNavigate }: ImageLightboxProps) {
  const currentIndex = allSrcs.indexOf(src);

  const goPrev = useCallback(() => {
    if (currentIndex > 0) onNavigate(allSrcs[currentIndex - 1]);
  }, [currentIndex, allSrcs, onNavigate]);

  const goNext = useCallback(() => {
    if (currentIndex < allSrcs.length - 1) onNavigate(allSrcs[currentIndex + 1]);
  }, [currentIndex, allSrcs, onNavigate]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") goPrev();
      if (e.key === "ArrowRight") goNext();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, goPrev, goNext]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-white/70 hover:text-white text-3xl leading-none z-10"
        title="Close (Esc)"
      >
        ×
      </button>

      {/* Counter */}
      {allSrcs.length > 1 && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 text-white/60 text-sm">
          {currentIndex + 1} / {allSrcs.length}
        </div>
      )}

      {/* Prev button */}
      {currentIndex > 0 && (
        <button
          onClick={(e) => { e.stopPropagation(); goPrev(); }}
          className="absolute left-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white text-4xl leading-none px-2 py-1 bg-black/30 rounded"
          title="Previous (←)"
        >
          ‹
        </button>
      )}

      {/* Image */}
      <img
        src={src}
        alt=""
        className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        draggable={false}
      />

      {/* Next button */}
      {currentIndex < allSrcs.length - 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); goNext(); }}
          className="absolute right-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white text-4xl leading-none px-2 py-1 bg-black/30 rounded"
          title="Next (→)"
        >
          ›
        </button>
      )}
    </div>
  );
}
