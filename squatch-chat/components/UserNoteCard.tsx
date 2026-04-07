"use client";
import { useState, useEffect } from "react";

interface Props {
  targetUserId: string;
  username: string;
}

export function UserNoteCard({ targetUserId, username }: Props) {
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/users/${targetUserId}/note`)
      .then(r => r.json())
      .then(d => {
        setNote(d.note ?? "");
        setLoading(false);
      });
  }, [targetUserId]);

  async function handleSave() {
    await fetch(`/api/users/${targetUserId}/note`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: note }),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (loading) return null;

  return (
    <div className="mt-2">
      <label className="block text-xs text-[var(--muted)] mb-1 uppercase tracking-wide">
        Note about {username}
      </label>
      <textarea
        value={note}
        onChange={e => setNote(e.target.value.slice(0, 500))}
        onBlur={handleSave}
        placeholder="Add a private note..."
        rows={3}
        className="w-full px-2 py-1.5 text-xs bg-[var(--panel-2)] border border-[var(--accent-2)] rounded text-[var(--text)] placeholder:text-[var(--muted)] resize-none focus:outline-none focus:border-[var(--accent)]"
      />
      <div className="flex justify-between items-center mt-1">
        <span className="text-[10px] text-[var(--muted)]">{note.length}/500</span>
        {saved && <span className="text-[10px] text-green-400">Saved</span>}
      </div>
    </div>
  );
}
