"use client";
import Avatar from "@/components/Avatar";

export interface StageState {
  channelId: string;
  active: boolean;
  hostId: string | null;
  speakers: { userId: string; username: string }[];
  queue: { userId: string; username: string }[];
  limits: { maxSpeakers: number };
}

interface AudienceMember {
  userId: string;
  username: string;
  avatar?: string | null;
}

interface FiresideStageProps {
  stage: StageState;
  audience: AudienceMember[];
  currentUserId: string;
  canControl: boolean;
  error?: string | null;
  displayName: (username: string) => string;
  onRequest: () => void;
  onWithdraw: () => void;
  onPromote: (userId: string) => void;
  onDemote: (userId: string) => void;
}

/**
 * Stage banner for fireside-stage voice rooms: who is on stage, the
 * raise-hand queue, host/moderator controls, and the listening audience.
 * Speaking rights are advisory — the audience self-mutes client-side, the
 * same trust boundary as Pass the Lantern.
 */
export default function FiresideStage({
  stage,
  audience,
  currentUserId,
  canControl,
  error,
  displayName,
  onRequest,
  onWithdraw,
  onPromote,
  onDemote,
}: FiresideStageProps) {
  const isSpeaker = stage.speakers.some((s) => s.userId === currentUserId);
  const isQueued = stage.queue.some((q) => q.userId === currentUserId);
  const stageFull = stage.speakers.length >= stage.limits.maxSpeakers;

  return (
    <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/25 text-xs shrink-0">
      <div className="flex flex-wrap items-center justify-center gap-2">
        <span aria-hidden="true">🎙️</span>
        <span className="font-semibold text-amber-200">
          Fireside Stage · {stage.speakers.length}/{stage.limits.maxSpeakers} speaking
        </span>
        {isSpeaker ? (
          currentUserId !== stage.hostId && (
            <button
              onClick={() => onDemote(currentUserId)}
              className="px-2.5 py-1 rounded-full bg-white/5 text-amber-100 hover:bg-white/10"
            >
              Step down
            </button>
          )
        ) : isQueued ? (
          <button
            onClick={onWithdraw}
            className="px-2.5 py-1 rounded-full bg-white/5 text-amber-100/80 hover:bg-white/10"
          >
            Lower hand
          </button>
        ) : (
          <button
            onClick={onRequest}
            className="px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-100 hover:bg-amber-500/30"
          >
            ✋ Raise hand
          </button>
        )}
        {!isSpeaker && !isQueued && (
          <span className="text-amber-100/60">You&apos;re in the audience</span>
        )}
        {stage.queue.length > 0 && (
          <span className="text-amber-100/60">
            Hands up:{" "}
            {stage.queue.map((entry, index) => (
              <span key={entry.userId}>
                {index > 0 && ", "}
                {displayName(entry.username)}
                {canControl && (
                  <button
                    onClick={() => onPromote(entry.userId)}
                    disabled={stageFull}
                    title={stageFull ? "The stage is full" : `Bring ${displayName(entry.username)} up`}
                    className="ml-1 px-1.5 rounded-full bg-amber-500 text-amber-950 font-semibold hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    ↑
                  </button>
                )}
              </span>
            ))}
          </span>
        )}
        {canControl && stage.speakers.some((s) => s.userId !== currentUserId) && (
          <span className="text-amber-100/50">
            {stage.speakers
              .filter((s) => s.userId !== stage.hostId)
              .map((s) => (
                <button
                  key={s.userId}
                  onClick={() => onDemote(s.userId)}
                  title={`Move ${displayName(s.username)} to the audience`}
                  className="ml-1 px-1.5 rounded-full bg-white/5 text-amber-100/70 hover:bg-white/10"
                >
                  {displayName(s.username)} ↓
                </button>
              ))}
          </span>
        )}
        {error && <span className="text-red-300">{error}</span>}
      </div>
      {audience.length > 0 && (
        <div className="mt-1.5 flex items-center justify-center gap-1.5 overflow-x-auto">
          <span className="text-amber-100/50 shrink-0">Around the fire:</span>
          {audience.slice(0, 12).map((member) => (
            <span key={member.userId} title={displayName(member.username)} className="shrink-0">
              <Avatar
                username={member.username}
                avatarUrl={member.avatar}
                size={20}
                className={member.userId === currentUserId ? "bg-amber-600/80 text-[var(--bg)]" : "bg-[#2a2a2e] text-[var(--text)]"}
              />
            </span>
          ))}
          {audience.length > 12 && (
            <span className="text-amber-100/50 shrink-0">+{audience.length - 12} more</span>
          )}
        </div>
      )}
    </div>
  );
}
