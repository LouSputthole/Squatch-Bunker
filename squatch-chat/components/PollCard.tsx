"use client";

import { useEffect, useMemo, useState } from "react";
import { getSocket } from "@/lib/socket";

export interface PollData {
  id: string;
  channelId: string;
  creatorId: string;
  question: string;
  allowMultiple: boolean;
  closesAt?: string | null;
  closedAt?: string | null;
  options: Array<{
    id: string;
    text: string;
    position: number;
    votes: Array<{ userId: string }>;
  }>;
  votes: Array<{ userId: string; optionId: string }>;
}

export default function PollCard({
  initialPoll,
  currentUserId,
  canClose,
  onChange,
}: {
  initialPoll: PollData;
  currentUserId?: string;
  canClose?: boolean;
  onChange?: (poll: PollData) => void;
}) {
  const [poll, setPoll] = useState(initialPoll);
  const [busyOption, setBusyOption] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [previousInitialPoll, setPreviousInitialPoll] = useState(initialPoll);
  const [clock, setClock] = useState<number | null>(null);

  if (previousInitialPoll !== initialPoll) {
    setPreviousInitialPoll(initialPoll);
    setPoll(initialPoll);
  }

  useEffect(() => {
    const immediate = window.setTimeout(() => setClock(Date.now()), 0);
    const interval = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => {
      window.clearTimeout(immediate);
      window.clearInterval(interval);
    };
  }, []);

  const totalVotes = poll.options.reduce((sum, option) => sum + option.votes.length, 0);
  const closed = Boolean(poll.closedAt) || Boolean(
    clock !== null && poll.closesAt && new Date(poll.closesAt).getTime() <= clock,
  );
  const myVotes = useMemo(
    () => new Set(poll.votes.filter((vote) => vote.userId === currentUserId).map((vote) => vote.optionId)),
    [poll.votes, currentUserId],
  );

  function update(next: PollData) {
    setPoll(next);
    onChange?.(next);
    getSocket().emit("poll:update", { pollId: next.id, channelId: next.channelId });
  }

  async function vote(optionId: string) {
    if (!currentUserId || closed) return;
    setBusyOption(optionId);
    setError("");
    try {
      const response = await fetch(`/api/polls/${poll.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optionId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Vote failed");
      update(data.poll);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Vote failed");
    } finally {
      setBusyOption(null);
    }
  }

  async function closePoll() {
    const response = await fetch(`/api/polls/${poll.id}`, { method: "DELETE" });
    const data = await response.json();
    if (response.ok) update(data.poll);
    else setError(data.error || "Could not close this poll");
  }

  return (
    <section className="mt-2 max-w-lg rounded-xl border border-[var(--accent-2)]/35 bg-[var(--panel-2)] p-3" aria-label={`Poll: ${poll.question}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--text)]">{poll.question}</p>
          <p className="text-[10px] text-[var(--muted)]">
            Camp Vote ? {poll.allowMultiple ? "Choose any" : "Choose one"} ? {totalVotes} vote{totalVotes === 1 ? "" : "s"}
          </p>
        </div>
        {closed && <span className="text-[10px] rounded-full bg-[var(--muted)]/15 px-2 py-0.5 text-[var(--muted)]">Closed</span>}
      </div>
      <div className="mt-3 space-y-2">
        {poll.options.map((option) => {
          const percent = totalVotes ? Math.round((option.votes.length / totalVotes) * 100) : 0;
          const selected = myVotes.has(option.id);
          return (
            <button
              key={option.id}
              disabled={closed || busyOption !== null}
              onClick={() => void vote(option.id)}
              className={`relative w-full overflow-hidden rounded-lg border px-3 py-2 text-left text-xs transition-colors disabled:cursor-default ${selected ? "border-[var(--accent-2)] text-[var(--text)]" : "border-[var(--accent-2)]/25 text-[var(--muted)] hover:border-[var(--accent-2)]/60"}`}
            >
              <span className="absolute inset-y-0 left-0 bg-[var(--accent-2)]/12" style={{ width: `${percent}%` }} />
              <span className="relative flex justify-between gap-3"><span>{selected ? "? " : ""}{option.text}</span><span>{percent}% ? {option.votes.length}</span></span>
            </button>
          );
        })}
      </div>
      {poll.closesAt && !poll.closedAt && <p className="text-[10px] text-[var(--muted)] mt-2">Closes {new Date(poll.closesAt).toLocaleString()}</p>}
      {error && <p role="alert" className="text-[10px] text-[var(--danger)] mt-2">{error}</p>}
      {canClose && !closed && <button className="text-[10px] text-[var(--muted)] hover:text-[var(--danger)] mt-2" onClick={() => void closePoll()}>Close vote</button>}
    </section>
  );
}
