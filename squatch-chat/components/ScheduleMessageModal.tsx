"use client";
import { useState, useEffect } from "react";

interface ScheduledMsg { id: string; content: string; sendAt: string; sent: boolean }

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

  useEffect(() => {
    // Set default date/time to 1 hour from now
    const d = new Date(Date.now() + 60 * 60 * 1000);
    setDate(d.toISOString().slice(0, 10));
    setTime(d.toTimeString().slice(0, 5));

    // Load existing scheduled messages
    fetch(`/api/channels/${channelId}/scheduled`)
      .then(r => r.json())
      .then(d => setScheduled(d.messages ?? []));
  }, [channelId]);

  async function handleSchedule(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim() || !date || !time) return;
    setLoading(true);
    setError("");
    try {
      const sendAt = new Date(`${date}T${time}`).toISOString();
      const res = await fetch(`/api/channels/${channelId}/scheduled`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: content.trim(), sendAt }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed"); return; }
      setScheduled(prev => [...prev, data.message]);
      setContent("");
      onClose();
    } catch { setError("Request failed"); }
    finally { setLoading(false); }
  }

  async function cancelScheduled(id: string) {
    await fetch(`/api/channels/${channelId}/scheduled?id=${id}`, { method: "DELETE" });
    setScheduled(prev => prev.filter(m => m.id !== id));
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--panel)] rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--accent-2)]/20">
          <h2 className="font-semibold text-[var(--text)]">Schedule Message</h2>
          <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--text)] text-xl">×</button>
        </div>

        <div className="p-4">
          {error && <div className="mb-3 p-2 bg-red-500/20 text-red-400 rounded text-sm">{error}</div>}

          <form onSubmit={handleSchedule} className="space-y-3">
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="Message content..."
              rows={3}
              className="w-full px-3 py-2 text-sm bg-[var(--panel-2)] border border-[var(--accent-2)] rounded text-[var(--text)] placeholder:text-[var(--muted)] resize-none"
            />
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="block text-xs text-[var(--muted)] mb-1">Date</label>
                <input type="date" value={date} onChange={e => setDate(e.target.value)}
                  className="w-full px-2 py-1.5 text-sm bg-[var(--panel-2)] border border-[var(--accent-2)] rounded text-[var(--text)]" />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-[var(--muted)] mb-1">Time</label>
                <input type="time" value={time} onChange={e => setTime(e.target.value)}
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
                    <button onClick={() => cancelScheduled(msg.id)} className="text-red-400 hover:text-red-300 shrink-0">Cancel</button>
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
