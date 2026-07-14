"use client";

import { useCallback, useEffect, useState } from "react";
import type { Channel } from "@/types/chat";
import GatheringForm from "@/components/GatheringForm";
import GatheringCard, {
  type GatheringView,
} from "@/components/GatheringCard";
import {
  gatheringTiming,
  type GatheringPhase,
  type GatheringRsvpStatus,
} from "@/lib/gatherings";

interface GatheringsPanelProps {
  open: boolean;
  serverId: string;
  channels: Channel[];
  onClose: () => void;
  onJoinChannel: (channelId: string) => void;
}

function toLocalInput(iso: string): string {
  const date = new Date(iso);
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function phaseAt(gathering: GatheringView, clock: number | null): GatheringPhase {
  if (clock === null) return gathering.phase;
  return gatheringTiming(
    gathering.startsAt,
    gathering.durationMinutes,
    new Date(clock),
  ).phase;
}

export default function GatheringsPanel({
  open,
  serverId,
  channels,
  onClose,
  onJoinChannel,
}: GatheringsPanelProps) {
  const [gatherings, setGatherings] = useState<GatheringView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("60");
  const [channelId, setChannelId] = useState("");
  const [saving, setSaving] = useState(false);
  const [clock, setClock] = useState<number | null>(null);

  const loadGatherings = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/servers/${serverId}/gatherings`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to load gatherings");
      setGatherings(data.gatherings || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load gatherings");
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    if (!open) return;
    const loadTimer = window.setTimeout(() => void loadGatherings(), 0);
    const immediate = window.setTimeout(() => setClock(Date.now()), 0);
    const interval = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => {
      window.clearTimeout(loadTimer);
      window.clearTimeout(immediate);
      window.clearInterval(interval);
    };
  }, [open, loadGatherings]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  function resetForm() {
    setFormOpen(false);
    setEditingId(null);
    setTitle("");
    setDescription("");
    setStartsAt("");
    setDurationMinutes("60");
    setChannelId("");
  }

  function beginCreate() {
    const start = new Date(Date.now() + 60 * 60 * 1000);
    start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0);
    setEditingId(null);
    setTitle("");
    setDescription("");
    setStartsAt(toLocalInput(start.toISOString()));
    setDurationMinutes("60");
    setChannelId("");
    setError("");
    setFormOpen(true);
  }

  function beginEdit(gathering: GatheringView) {
    setEditingId(gathering.id);
    setTitle(gathering.title);
    setDescription(gathering.description || "");
    setStartsAt(toLocalInput(gathering.startsAt));
    setDurationMinutes(String(gathering.durationMinutes));
    setChannelId(gathering.channel?.id || "");
    setError("");
    setFormOpen(true);
  }

  function replaceGathering(updated: GatheringView) {
    setGatherings((current) =>
      current
        .map((gathering) => (gathering.id === updated.id ? updated : gathering))
        .sort(
          (left, right) =>
            new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime(),
        ),
    );
  }

  async function saveGathering(event: React.FormEvent) {
    event.preventDefault();
    const start = new Date(startsAt);
    if (Number.isNaN(start.getTime())) {
      setError("Choose a valid start time");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const endpoint = editingId
        ? `/api/gatherings/${editingId}`
        : `/api/servers/${serverId}/gatherings`;
      const response = await fetch(endpoint, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          startsAt: start.toISOString(),
          durationMinutes: Number(durationMinutes),
          channelId: channelId || null,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to save gathering");
      if (editingId) {
        replaceGathering(data.gathering);
      } else {
        setGatherings((current) =>
          [...current, data.gathering].sort(
            (left, right) =>
              new Date(left.startsAt).getTime() -
              new Date(right.startsAt).getTime(),
          ),
        );
      }
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save gathering");
    } finally {
      setSaving(false);
    }
  }

  async function deleteGathering(gathering: GatheringView) {
    if (!window.confirm(`Cancel “${gathering.title}”?`)) return;
    const response = await fetch(`/api/gatherings/${gathering.id}`, {
      method: "DELETE",
    });
    if (response.ok) {
      setGatherings((current) =>
        current.filter((item) => item.id !== gathering.id),
      );
      if (editingId === gathering.id) resetForm();
      return;
    }
    const data = await response.json();
    setError(data.error || "Failed to cancel gathering");
  }

  async function setRsvp(
    gatheringId: string,
    status: GatheringRsvpStatus,
  ) {
    const response = await fetch(`/api/gatherings/${gatheringId}/rsvp`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || "Failed to update RSVP");
      return;
    }
    replaceGathering(data.gathering);
  }

  if (!open) return null;

  const visibleGatherings = gatherings.filter(
    (gathering) => phaseAt(gathering, clock) !== "ended",
  );
  const reminders = visibleGatherings.filter(
    (gathering) => phaseAt(gathering, clock) === "reminder",
  ).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4"
      onClick={onClose}
    >
      <section
        className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-amber-500/25 bg-[var(--panel)] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        aria-label="Camp Gatherings"
      >
        <header className="flex items-center gap-3 border-b border-[var(--accent-2)]/20 px-5 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/15 text-xl">
            🏕️
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-[var(--text)]">Camp Gatherings</h2>
              {reminders > 0 && (
                <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                  {reminders} starting soon
                </span>
              )}
            </div>
            <p className="text-xs text-[var(--muted)]">
              Plan a time, choose a fire, and see who is coming.
            </p>
          </div>
          <button
            onClick={formOpen ? resetForm : beginCreate}
            className="rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-[var(--bg)] hover:bg-[var(--accent-2)]"
          >
            {formOpen ? "Cancel" : "New Gathering"}
          </button>
          <button
            onClick={onClose}
            className="text-2xl leading-none text-[var(--muted)] hover:text-[var(--text)]"
            aria-label="Close gatherings"
          >
            ×
          </button>
        </header>

        {error && (
          <div className="mx-5 mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        {formOpen && (
          <GatheringForm
            channels={channels}
            title={title}
            description={description}
            startsAt={startsAt}
            durationMinutes={durationMinutes}
            channelId={channelId}
            saving={saving}
            editing={editingId !== null}
            onTitleChange={setTitle}
            onDescriptionChange={setDescription}
            onStartsAtChange={setStartsAt}
            onDurationChange={setDurationMinutes}
            onChannelChange={setChannelId}
            onSubmit={saveGathering}
          />
        )}

        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {loading && (
            <p className="py-10 text-center text-sm text-[var(--muted)]">
              Checking the trail...
            </p>
          )}
          {!loading && visibleGatherings.length === 0 && (
            <div className="rounded-xl border border-dashed border-[var(--accent-2)]/30 px-5 py-10 text-center">
              <p className="text-base text-[var(--text)]">No gatherings planned</p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Pick a time and give everyone a fire to gather around.
              </p>
            </div>
          )}
          {!loading &&
            visibleGatherings.map((gathering) => (
              <GatheringCard
                key={gathering.id}
                gathering={gathering}
                clock={clock}
                onRsvp={(status) => void setRsvp(gathering.id, status)}
                onEdit={() => beginEdit(gathering)}
                onDelete={() => void deleteGathering(gathering)}
                onJoinChannel={() => {
                  if (!gathering.channel) return;
                  onJoinChannel(gathering.channel.id);
                  onClose();
                }}
              />
            ))}
        </div>
      </section>
    </div>
  );
}
