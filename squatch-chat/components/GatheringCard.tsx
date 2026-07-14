"use client";

import { gatheringTiming, type GatheringRsvpStatus } from "@/lib/gatherings";

export interface GatheringView {
  id: string;
  creatorId: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  phase: "upcoming" | "reminder" | "active" | "ended";
  reminder: boolean;
  channel: { id: string; name: string; type: string } | null;
  participantCounts: Record<GatheringRsvpStatus, number>;
  participantCount: number;
  myRsvp: GatheringRsvpStatus | null;
  canManage: boolean;
  creator: { id: string; username: string; avatar: string | null };
}

interface GatheringCardProps {
  gathering: GatheringView;
  clock: number | null;
  onRsvp: (status: GatheringRsvpStatus) => void;
  onEdit: () => void;
  onDelete: () => void;
  onJoinChannel: () => void;
}

function timingLabel(gathering: GatheringView, clock: number | null): string {
  if (clock === null) return new Date(gathering.startsAt).toLocaleString();
  const timing = gatheringTiming(
    gathering.startsAt,
    gathering.durationMinutes,
    new Date(clock),
  );
  if (timing.phase === "active") {
    return `Live · ${Math.max(1, Math.ceil((timing.endsAt.getTime() - clock) / 60000))}m left`;
  }
  const minutes = Math.max(1, Math.ceil(timing.untilStartMs / 60000));
  if (minutes < 60) return `Starts in ${minutes}m`;
  if (minutes < 24 * 60) return `Starts in ${Math.ceil(minutes / 60)}h`;
  return new Date(gathering.startsAt).toLocaleString();
}

export default function GatheringCard({
  gathering,
  clock,
  onRsvp,
  onEdit,
  onDelete,
  onJoinChannel,
}: GatheringCardProps) {
  const phase =
    clock === null
      ? gathering.phase
      : gatheringTiming(
          gathering.startsAt,
          gathering.durationMinutes,
          new Date(clock),
        ).phase;
  const reminder = phase === "reminder";
  const active = phase === "active";

  return (
    <article
      className={`rounded-xl border p-4 ${
        active
          ? "border-green-500/45 bg-green-500/5"
          : reminder
            ? "border-amber-400/50 bg-amber-500/5"
            : "border-[var(--accent-2)]/20 bg-[var(--panel-2)]/35"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-[var(--text)]">{gathering.title}</h3>
            {(active || reminder) && (
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                active
                  ? "bg-green-500/20 text-green-300"
                  : "bg-amber-500/20 text-amber-300"
              }`}>
                {active ? "LIVE NOW" : "STARTING SOON"}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs font-medium text-amber-300">
            {timingLabel(gathering, clock)}
            {" · "}
            {new Date(gathering.startsAt).toLocaleString()}
          </p>
          {gathering.description && (
            <p className="mt-2 text-sm text-[var(--muted)]">{gathering.description}</p>
          )}
          <p className="mt-2 text-xs text-[var(--muted)]">
            Hosted by {gathering.creator.username}
            {gathering.channel && ` · ${gathering.channel.type === "voice" ? "Voice" : "#"} ${gathering.channel.name}`}
          </p>
        </div>
        {gathering.canManage && (
          <div className="flex gap-1">
            {!active && (
              <button onClick={onEdit} className="px-2 py-1 text-xs text-[var(--muted)] hover:text-[var(--text)]">
                Edit
              </button>
            )}
            <button onClick={onDelete} className="px-2 py-1 text-xs text-red-400 hover:text-red-300">
              Cancel
            </button>
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--accent-2)]/15 pt-3">
        {([
          ["going", "Going"],
          ["maybe", "Maybe"],
          ["declined", "Can't go"],
        ] as const).map(([status, label]) => (
          <button
            key={status}
            onClick={() => onRsvp(status)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              gathering.myRsvp === status
                ? "border-amber-400/60 bg-amber-500/20 text-amber-200"
                : "border-[var(--accent-2)]/25 text-[var(--muted)] hover:text-[var(--text)]"
            }`}
          >
            {label} · {gathering.participantCounts[status]}
          </button>
        ))}
        <span className="ml-auto text-xs text-[var(--muted)]">
          {gathering.participantCount} going
        </span>
        {active && gathering.channel && (
          <button
            onClick={onJoinChannel}
            className="rounded-lg bg-green-500 px-3 py-1.5 text-xs font-bold text-black hover:bg-green-400"
          >
            Join the fire
          </button>
        )}
      </div>
    </article>
  );
}
