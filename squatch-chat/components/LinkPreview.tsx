"use client";
import { useState, useEffect } from "react";

interface OGData {
  title?: string | null;
  description?: string | null;
  image?: string | null;
  siteName?: string | null;
  url: string;
}

const previewCache = new Map<string, OGData | null>();

const URL_REGEX = /https?:\/\/[^\s<)]+/g;

/** Extract up to 3 URLs from text */
export function extractUrls(text: string): string[] {
  return Array.from(text.matchAll(URL_REGEX), (m) => m[0]).slice(0, 3);
}

function LinkPreviewCard({ url }: { url: string }) {
  const [data, setData] = useState<OGData | null>(previewCache.get(url) ?? null);
  const [loaded, setLoaded] = useState(previewCache.has(url));

  useEffect(() => {
    if (previewCache.has(url)) {
      setData(previewCache.get(url) ?? null);
      setLoaded(true);
      return;
    }
    const controller = new AbortController();
    fetch(`/api/og-preview?url=${encodeURIComponent(url)}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((d) => {
        if (d.title || d.description) {
          previewCache.set(url, d);
          setData(d);
        } else {
          previewCache.set(url, null);
        }
      })
      .catch(() => { previewCache.set(url, null); })
      .finally(() => setLoaded(true));
    return () => controller.abort();
  }, [url]);

  if (!loaded || !data) return null;

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
          loading="lazy"
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

export function LinkPreview({ url }: { url: string }) {
  return <LinkPreviewCard url={url} />;
}

/** Render link previews for all URLs found in message content */
export default function LinkPreviews({ content }: { content: string }) {
  const urls = extractUrls(content);
  if (urls.length === 0) return null;
  return (
    <div className="space-y-1">
      {urls.map((u) => (
        <LinkPreviewCard key={u} url={u} />
      ))}
    </div>
  );
}
