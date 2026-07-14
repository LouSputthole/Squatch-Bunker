"use client";

import { useState } from "react";

interface CreatePollModalProps {
  channelId: string;
  onClose: () => void;
  onCreated: (message: unknown) => void;
}

export default function CreatePollModal({ channelId, onClose, onCreated }: CreatePollModalProps) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [allowMultiple, setAllowMultiple] = useState(false);
  const [duration, setDuration] = useState("24");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const hours = Number(duration);
    const closesAt = hours > 0 ? new Date(Date.now() + hours * 60 * 60 * 1000).toISOString() : null;
    try {
      const response = await fetch("/api/polls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId, question, options, allowMultiple, closesAt }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not create poll");
      onCreated(data.message);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create poll");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] bg-black/70 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="create-poll-title">
      <form onSubmit={submit} className="w-full max-w-md rounded-xl border border-[var(--accent-2)]/35 bg-[var(--panel)] shadow-2xl p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="create-poll-title" className="font-semibold text-[var(--text)]">Start a Camp Vote</h2>
            <p className="text-xs text-[var(--muted)]">Take a quick trail decision together.</p>
          </div>
          <button type="button" onClick={onClose} className="text-[var(--muted)] hover:text-[var(--text)] text-xl" aria-label="Close">&times;</button>
        </div>
        <label className="block mt-4 text-xs text-[var(--muted)]">
          Question
          <input
            autoFocus
            maxLength={300}
            required
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            className="mt-1 w-full rounded-lg border border-[var(--accent-2)]/30 bg-[var(--panel-2)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent-2)]"
          />
        </label>
        <div className="mt-3 space-y-2">
          <span className="text-xs text-[var(--muted)]">Options</span>
          {options.map((option, index) => (
            <div key={index} className="flex gap-2">
              <input
                required
                maxLength={120}
                value={option}
                placeholder={`Option ${index + 1}`}
                onChange={(event) => setOptions((current) => current.map((value, position) => position === index ? event.target.value : value))}
                className="flex-1 rounded-lg border border-[var(--accent-2)]/30 bg-[var(--panel-2)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent-2)]"
              />
              {options.length > 2 && <button type="button" onClick={() => setOptions((current) => current.filter((_, position) => position !== index))} className="text-[var(--muted)] hover:text-[var(--danger)]" aria-label={`Remove option ${index + 1}`}>&times;</button>}
            </div>
          ))}
          {options.length < 10 && <button type="button" onClick={() => setOptions((current) => [...current, ""])} className="text-xs text-[var(--accent-2)] hover:underline">+ Add option</button>}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="text-xs text-[var(--muted)]">
            Close after
            <select value={duration} onChange={(event) => setDuration(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--accent-2)]/30 bg-[var(--panel-2)] px-2 py-2 text-sm text-[var(--text)]">
              <option value="1">1 hour</option>
              <option value="24">24 hours</option>
              <option value="168">7 days</option>
              <option value="0">No deadline</option>
            </select>
          </label>
          <label className="flex items-end gap-2 pb-2 text-xs text-[var(--muted)]">
            <input type="checkbox" checked={allowMultiple} onChange={(event) => setAllowMultiple(event.target.checked)} />
            Multiple choices
          </label>
        </div>
        {error && <p role="alert" className="mt-3 text-xs text-[var(--danger)]">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-[var(--muted)] hover:text-[var(--text)]">Cancel</button>
          <button disabled={saving} className="rounded-lg bg-[var(--accent-2)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Starting..." : "Start vote"}</button>
        </div>
      </form>
    </div>
  );
}
