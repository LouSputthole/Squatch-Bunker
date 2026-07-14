"use client";

import type { FormEvent } from "react";
import type { Channel } from "@/types/chat";

interface GatheringFormProps {
  channels: Channel[];
  title: string;
  description: string;
  startsAt: string;
  durationMinutes: string;
  channelId: string;
  saving: boolean;
  editing: boolean;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onStartsAtChange: (value: string) => void;
  onDurationChange: (value: string) => void;
  onChannelChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}

export default function GatheringForm(props: GatheringFormProps) {
  return (
    <form
      onSubmit={props.onSubmit}
      className="mx-5 mt-4 grid gap-3 rounded-xl border border-amber-500/20 bg-[var(--panel-2)]/55 p-4 sm:grid-cols-2"
    >
      <label className="text-xs text-[var(--muted)] sm:col-span-2">
        Gathering name
        <input
          required
          minLength={3}
          maxLength={100}
          value={props.title}
          onChange={(event) => props.onTitleChange(event.target.value)}
          className="mt-1 w-full rounded-lg border border-[var(--accent-2)]/30 bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)]"
          placeholder="Friday night around the fire"
        />
      </label>
      <label className="text-xs text-[var(--muted)]">
        Starts
        <input
          required
          type="datetime-local"
          value={props.startsAt}
          onChange={(event) => props.onStartsAtChange(event.target.value)}
          className="mt-1 w-full rounded-lg border border-[var(--accent-2)]/30 bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)]"
        />
      </label>
      <label className="text-xs text-[var(--muted)]">
        Duration
        <select
          value={props.durationMinutes}
          onChange={(event) => props.onDurationChange(event.target.value)}
          className="mt-1 w-full rounded-lg border border-[var(--accent-2)]/30 bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)]"
        >
          <option value="30">30 minutes</option>
          <option value="60">1 hour</option>
          <option value="90">90 minutes</option>
          <option value="120">2 hours</option>
          <option value="180">3 hours</option>
        </select>
      </label>
      <label className="text-xs text-[var(--muted)] sm:col-span-2">
        Linked fire
        <select
          value={props.channelId}
          onChange={(event) => props.onChannelChange(event.target.value)}
          className="mt-1 w-full rounded-lg border border-[var(--accent-2)]/30 bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)]"
        >
          <option value="">No linked channel</option>
          {props.channels.map((channel) => (
            <option key={channel.id} value={channel.id}>
              {channel.type === "voice" ? "Voice" : "#"} {channel.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs text-[var(--muted)] sm:col-span-2">
        Note for the group
        <textarea
          maxLength={1000}
          rows={2}
          value={props.description}
          onChange={(event) => props.onDescriptionChange(event.target.value)}
          className="mt-1 w-full resize-none rounded-lg border border-[var(--accent-2)]/30 bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)]"
          placeholder="What should everyone bring or know?"
        />
      </label>
      <button
        type="submit"
        disabled={props.saving}
        className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-black disabled:opacity-50 sm:col-span-2"
      >
        {props.saving
          ? "Saving..."
          : props.editing
            ? "Update Gathering"
            : "Light the Gathering"}
      </button>
    </form>
  );
}
