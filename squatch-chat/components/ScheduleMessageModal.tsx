"use client";
import { useState, useEffect } from "react";
import { useEscape } from "@/hooks/useEscape";
import { toast, toastResponseError } from "@/lib/toast";

interface ScheduledMsg { id: string; content: string; sendAt: string; sent: boolean }

const pad = (n: number) => String(n).padStart(2, "0");

/** YYYY-MM-DD in the user's local timezone (toISOString would give the UTC date). */
function localDateValue(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function localTimeValue(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Builds a Date from the local date + time input values. */
function fromLocalFields(date: string, time: string): Date | null {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  if ([y, m, d, hh, mm].some((n) => !Number.isFinite(n))) return null;
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

interface Props {
  channelId: string;
  pendingContent?: string;
  onClose: () => void;
}

export function ScheduleMessageModal({ channelId, pendingContent = "", onClose }: Props) {
  const [content, setContent] = useState(pendingContent);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [scheduled, setScheduled] = useState<ScheduledMsg[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEscape(onClose);

  useEffect(() => {
    const timer = setTimeout(() => {
      const d = new Date(Date.now() + 60 * 60 * 1000);
      setDate(localDateValue(d));
      setTime(localTimeValue(d));
      fetch(`/api/channels/${channelId}/scheduled`)
        .then(async (r) => {
          if (!r.ok) {
            await toastResponseError(r, "Couldn't load scheduled messages");
            return;
          }
          const data = await r.json();
          setScheduled(data.messages ?? []);
        })
        .catch(() => toast("Couldn't load scheduled messages", "error"));
    }, 0);
    return () => clearTimeout(timer);
  }, [channelId]);

  async function handleSchedule(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim() || !date || !time) return;
    const when = fromLocalFields(date, time);
    if (!when || Number.isNaN(when.getTime())) { setError("Pick a valid date and time"); return; }
    if (when.getTime() <= Date.now()) { setError("Pick a time in the future"); return; }
    setLoading(true);
    setError("");
    try {
      const sendAt = when.toISOString();
      const res = await fetch(`/api/channels/${channelId}/scheduled`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: content.trim(), sendAt }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed"); return; }
      setScheduled(prev => [...prev, data.message]);
      setContent("");
      toast(`Message scheduled for ${when.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`, "success");
      onClose();
    } catch { setError("Request failed"); }
    finally { setLoading(false); }
  }

  async function cancelScheduled(id: string) {
    try {
      const res = await fetch(`/api/channels/${channelId}/scheduled?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) {
        await toastResponseError(res, "Couldn't cancel the scheduled message");
        return;
      }
      setScheduled(prev => prev.filter(m => m.id !== id));
    } catch {
      toast("Couldn't cancel the scheduled message", "error");
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="schedule-message-title" className="bg-[var(--panel)] rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--accent-2)]/20">
          <h2 id="schedule-message-title" className="font-semibold text-[var(--text)]">Schedule Message</h2>
          <button onClick={onClose} aria-label="Close" className="text-[var(--muted)] hover:text-[var(--text)] text-xl">×</button>
        </div>

        <div className="p-4">
          {error && <div role="alert" className="mb-3 p-2 bg-[var(--danger)]/15 text-[var(--danger)] rounded text-sm">{error}</div>}

          <form onSubmit={handleSchedule} className="space-y-3">
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="Message content..."
              aria-label="Message content"
              autoFocus
              rows={3}
              className="w-full px-3 py-2 text-sm bg-[var(--panel-2)] border border-[var(--accent-2)] rounded text-[var(--text)] placeholder:text-[var(--muted)] resize-none"
            />
            <div className="flex gap-2">
              <div className="flex-1">
                <label htmlFor="schedule-date" className="block text-xs text-[var(--muted)] mb-1">Date</label>
                <input id="schedule-date" type="date" value={date} min={localDateValue(new Date())} onChange={e => setDate(e.target.value)}
                  className="w-full px-2 py-1.5 text-sm bg-[var(--panel-2)] border border-[var(--accent-2)] rounded text-[var(--text)]" />
              </div>
              <div className="flex-1">
                <label htmlFor="schedule-time" className="block text-xs text-[var(--muted)] mb-1">Time</label>
                <input id="schedule-time" type="time" value={time} onChange={e => setTime(e.target.value)}
                  className="w-full px-2 py-1.5 text-sm bg-[var(--panel-2)] border border-[var(--accent-2)] rounded text-[var(--text)]" />
              </div>
            </div>
            <button type="submit" disabled={loading || !content.trim() || !date || !time}
              className="w-full py-2 bg-[var(--accent-2)] text-[var(--text)] rounded hover:bg-[var(--accent)] transition-colors disabled:opacity-50 text-sm font-medium">
              {loading ? "Scheduling..." : "Schedule Message"}
            </button>
          </form>

          {scheduled.length > 0 && (
            <div className="mt-4">
              <h3 className="text-xs text-[var(--muted)] uppercase tracking-wide mb-2">Pending ({scheduled.length})</h3>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {scheduled.map(msg => (
                  <div key={msg.id} className="flex items-start gap-2 p-2 bg-[var(--panel-2)] rounded text-xs">
                    <div className="flex-1 min-w-0">
                      <div className="text-[var(--text)] truncate">{msg.content}</div>
                      <div className="text-[var(--muted)] mt-0.5">{new Date(msg.sendAt).toLocaleString()}</div>
                    </div>
                    <button onClick={() => void cancelScheduled(msg.id)} className="text-[var(--danger)] hover:opacity-80 shrink-0">Cancel</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
