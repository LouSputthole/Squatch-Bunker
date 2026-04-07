"use client";
import { useState, useEffect } from "react";

interface OGData {
  title?: string | null;
  description?: string | null;
  image?: string | null;
  siteName?: string | null;
  url: string;
}

export function LinkPreview({ url }: { url: string }) {
  const [data, setData] = useState<OGData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch(`/api/og-preview?url=${encodeURIComponent(url)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.title || d.description) setData(d);
        else setFailed(true);
      })
      .catch(() => setFailed(true));
  }, [url]);

  if (failed || !data) return null;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="block mt-2 max-w-md border border-[var(--accent-2)]/30 rounded-lg overflow-hidden hover:border-[var(--accent-2)]/60 transition-colors bg-[var(--panel-2)]"
    >
      {data.image && (
        <img
          src={data.image}
          alt={data.title ?? ""}
          className="w-full h-32 object-cover"
          onError={(e) => (e.currentTarget.style.display = "none")}
        />
      )}
      <div className="p-3">
        {data.siteName && <div className="text-xs text-[var(--accent)] mb-1">{data.siteName}</div>}
        {data.title && <div className="text-sm font-semibold text-[var(--text)] line-clamp-2">{data.title}</div>}
        {data.description && (
          <div className="text-xs text-[var(--muted)] mt-1 line-clamp-2">{data.description}</div>
        )}
      </div>
    </a>
  );
}
