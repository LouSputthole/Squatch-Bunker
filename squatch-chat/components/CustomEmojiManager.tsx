"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface CustomEmoji {
  id: string;
  name: string;
  url: string;
  serverId: string;
}

interface CustomEmojiManagerProps {
  serverId: string;
  open: boolean;
  onClose: () => void;
}

export default function CustomEmojiManager({ serverId, open, onClose }: CustomEmojiManagerProps) {
  const [emojis, setEmojis] = useState<CustomEmoji[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [newName, setNewName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchEmojis = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/servers/${serverId}/emoji`);
      if (!res.ok) throw new Error("Failed to load emoji");
      const data = await res.json();
      setEmojis(data.emojis ?? []);
    } catch {
      setError("Could not load custom emoji.");
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    if (open) fetchEmojis();
  }, [open, fetchEmojis]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    setUploadError("");
    const file = fileRef.current?.files?.[0];
    if (!file) { setUploadError("Choose an image file."); return; }
    const trimmed = newName.trim().replace(/\s+/g, "_");
    if (!trimmed) { setUploadError("Enter an emoji name."); return; }
    if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
      setUploadError("Name can only contain letters, numbers, and underscores.");
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const uploadRes = await fetch("/api/upload", { method: "POST", body: form });
      if (!uploadRes.ok) throw new Error("Upload failed");
      const { url } = await uploadRes.json();

      const postRes = await fetch(`/api/servers/${serverId}/emoji`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, url }),
      });
      if (!postRes.ok) throw new Error("Failed to save emoji");
      const { emoji } = await postRes.json();
      setEmojis((prev) => [...prev, emoji]);
      setNewName("");
      if (fileRef.current) fileRef.current.value = "";
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(emojiId: string) {
    setDeletingId(emojiId);
    try {
      const res = await fetch(`/api/servers/${serverId}/emoji/${emojiId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
      setEmojis((prev) => prev.filter((e) => e.id !== emojiId));
    } catch {
      // silently leave the emoji in place; could surface error here
    } finally {
      setDeletingId(null);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg mx-4 bg-[var(--panel)] rounded-xl border border-[var(--accent-2)]/30 shadow-2xl flex flex-col"
        style={{ maxHeight: "80vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--accent-2)]/20 shrink-0">
          <h2 className="text-lg font-bold text-[var(--text)]">Custom Emoji</h2>
          <button
            onClick={onClose}
            className="text-[var(--muted)] hover:text-[var(--text)] text-2xl leading-none w-8 h-8 flex items-center justify-center rounded hover:bg-[var(--panel-2)]/50 transition-colors"
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        {/* Add emoji form */}
        <form onSubmit={handleUpload} className="px-6 py-4 border-b border-[var(--accent-2)]/20 shrink-0 space-y-3">
          <p className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">Add Emoji</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="emoji_name"
              maxLength={32}
              className="w-36 shrink-0 px-3 py-2 text-sm bg-[var(--panel-2)] text-[var(--text)] border border-[var(--accent-2)]/30 rounded-lg focus:outline-none focus:border-[var(--accent-2)] placeholder:text-[var(--muted)]"
            />
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              className="flex-1 min-w-0 text-sm text-[var(--muted)] file:mr-2 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-[var(--accent-2)]/20 file:text-[var(--text)] hover:file:bg-[var(--accent-2)]/30 file:cursor-pointer cursor-pointer"
            />
            <button
              type="submit"
              disabled={uploading}
              className="shrink-0 px-4 py-2 rounded-lg text-sm font-semibold bg-[var(--accent-2)] text-[var(--text)] hover:bg-[var(--accent)] transition-colors disabled:opacity-40"
            >
              {uploading ? "Uploading…" : "Add"}
            </button>
          </div>
          {uploadError && (
            <p className="text-xs text-[var(--danger)]">{uploadError}</p>
          )}
        </form>

        {/* Emoji grid */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading && (
            <p className="text-sm text-[var(--muted)] text-center py-8">Loading…</p>
          )}
          {error && (
            <p className="text-sm text-[var(--danger)] text-center py-8">{error}</p>
          )}
          {!loading && !error && emojis.length === 0 && (
            <p className="text-sm text-[var(--muted)] text-center py-8">
              No custom emoji yet. Add one above!
            </p>
          )}
          {!loading && emojis.length > 0 && (
            <div className="grid grid-cols-4 gap-3">
              {emojis.map((emoji) => (
                <div
                  key={emoji.id}
                  className="flex flex-col items-center gap-1.5 p-2 rounded-lg bg-[var(--panel-2)] border border-[var(--accent-2)]/20 group relative"
                >
                  <img
                    src={emoji.url}
                    alt={emoji.name}
                    className="w-12 h-12 object-contain rounded"
                  />
                  <span className="text-[11px] text-[var(--muted)] truncate w-full text-center">
                    :{emoji.name}:
                  </span>
                  <button
                    onClick={() => handleDelete(emoji.id)}
                    disabled={deletingId === emoji.id}
                    className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center rounded text-[var(--danger)] bg-[var(--panel)]/80 opacity-0 group-hover:opacity-100 transition-opacity text-xs hover:bg-[var(--danger)]/20 disabled:opacity-40"
                    aria-label={`Delete :${emoji.name}:`}
                    title="Delete"
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
