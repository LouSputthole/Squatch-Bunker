"use client";
import { useState, useEffect, useRef } from "react";
import { toast, toastResponseError } from "@/lib/toast";

interface Props {
  targetUserId: string;
  username: string;
}

/** Private note about another user — only the author can read it (GET/PUT /api/users/:id/note). */
export function UserNoteCard({ targetUserId, username }: Props) {
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const lastSavedRef = useRef("");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/users/${targetUserId}/note`)
      .then(r => (r.ok ? r.json() : { note: null }))
      .then(d => {
        if (cancelled) return;
        const loaded = typeof d.note === "string" ? d.note : "";
        lastSavedRef.current = loaded;
        setNote(loaded);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [targetUserId]);

  async function handleSave() {
    if (note === lastSavedRef.current || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/users/${targetUserId}/note`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: note }),
      });
      if (!res.ok) {
        await toastResponseError(res, "Couldn't save your note");
        return;
      }
      lastSavedRef.current = note;
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      toast("Couldn't save your note", "error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return null;

  return (
    <div>
      <label
        htmlFor={`user-note-${targetUserId}`}
        className="block text-xs font-semibold text-[var(--muted)] mb-2 uppercase tracking-wide"
      >
        Note about {username}
      </label>
      <textarea
        id={`user-note-${targetUserId}`}
        value={note}
        onChange={e => setNote(e.target.value.slice(0, 500))}
        onBlur={handleSave}
        placeholder="Add a private note only you can see..."
        rows={3}
        className="w-full px-3 py-2 text-sm bg-[var(--panel-2)] border border-[var(--accent-2)]/30 rounded-lg text-[var(--text)] placeholder:text-[var(--muted)] resize-none focus:outline-none focus:border-[var(--accent)]"
      />
      <div className="flex justify-between items-center mt-1">
        <span className="text-[10px] text-[var(--muted)]">{note.length}/500 · saved when you click away</span>
        {saving ? (
          <span className="text-[10px] text-[var(--muted)]">Saving…</span>
        ) : saved ? (
          <span className="text-[10px] text-[var(--accent)]">Saved</span>
        ) : null}
      </div>
    </div>
  );
}
