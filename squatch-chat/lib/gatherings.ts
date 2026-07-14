export const GATHERING_MIN_DURATION_MINUTES = 15;
export const GATHERING_MAX_DURATION_MINUTES = 24 * 60;
export const GATHERING_REMINDER_WINDOW_MS = 15 * 60 * 1000;
export const GATHERING_RSVP_STATUSES = ["going", "maybe", "declined"] as const;

export type GatheringRsvpStatus = (typeof GATHERING_RSVP_STATUSES)[number];
export type GatheringPhase = "upcoming" | "reminder" | "active" | "ended";

export interface GatheringMutation {
  title?: string;
  description?: string | null;
  startsAt?: Date;
  durationMinutes?: number;
  channelId?: string | null;
}

type GatheringValidation =
  | { ok: true; data: GatheringMutation }
  | { ok: false; error: string };

export function parseRsvpStatus(value: unknown): GatheringRsvpStatus | null {
  return typeof value === "string" &&
    (GATHERING_RSVP_STATUSES as readonly string[]).includes(value)
    ? (value as GatheringRsvpStatus)
    : null;
}

export function gatheringTiming(
  startsAt: Date | string,
  durationMinutes: number,
  now = new Date(),
) {
  const start = startsAt instanceof Date ? startsAt : new Date(startsAt);
  const endsAt = new Date(start.getTime() + durationMinutes * 60 * 1000);
  const untilStartMs = start.getTime() - now.getTime();
  const phase: GatheringPhase =
    now.getTime() >= endsAt.getTime()
      ? "ended"
      : now.getTime() >= start.getTime()
        ? "active"
        : untilStartMs <= GATHERING_REMINDER_WINDOW_MS
          ? "reminder"
          : "upcoming";
  return { startsAt: start, endsAt, untilStartMs, phase };
}

export function parseGatheringMutation(
  body: Record<string, unknown>,
  options: { partial?: boolean; now?: Date } = {},
): GatheringValidation {
  const partial = options.partial === true;
  const now = options.now ?? new Date();
  const data: GatheringMutation = {};

  if (!partial || Object.prototype.hasOwnProperty.call(body, "title")) {
    if (typeof body.title !== "string") {
      return { ok: false, error: "Title is required" };
    }
    const title = body.title.trim();
    if (title.length < 3 || title.length > 100) {
      return { ok: false, error: "Title must be between 3 and 100 characters" };
    }
    data.title = title;
  }

  if (Object.prototype.hasOwnProperty.call(body, "description")) {
    if (body.description !== null && typeof body.description !== "string") {
      return { ok: false, error: "Description must be text" };
    }
    const description =
      typeof body.description === "string" ? body.description.trim() : "";
    if (description.length > 1_000) {
      return { ok: false, error: "Description must be 1,000 characters or fewer" };
    }
    data.description = description || null;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(body, "startsAt")) {
    if (typeof body.startsAt !== "string") {
      return { ok: false, error: "Start time is required" };
    }
    const startsAt = new Date(body.startsAt);
    if (Number.isNaN(startsAt.getTime())) {
      return { ok: false, error: "Start time is invalid" };
    }
    if (startsAt.getTime() <= now.getTime()) {
      return { ok: false, error: "Start time must be in the future" };
    }
    data.startsAt = startsAt;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(body, "durationMinutes")) {
    const duration = body.durationMinutes ?? 60;
    if (
      typeof duration !== "number" ||
      !Number.isInteger(duration) ||
      duration < GATHERING_MIN_DURATION_MINUTES ||
      duration > GATHERING_MAX_DURATION_MINUTES
    ) {
      return {
        ok: false,
        error: `Duration must be between ${GATHERING_MIN_DURATION_MINUTES} and ${GATHERING_MAX_DURATION_MINUTES} minutes`,
      };
    }
    data.durationMinutes = duration;
  }

  if (Object.prototype.hasOwnProperty.call(body, "channelId")) {
    if (body.channelId === null || body.channelId === "") {
      data.channelId = null;
    } else if (typeof body.channelId !== "string") {
      return { ok: false, error: "Linked channel is invalid" };
    } else {
      data.channelId = body.channelId.trim();
    }
  }

  if (partial && Object.keys(data).length === 0) {
    return { ok: false, error: "Nothing to update" };
  }

  return { ok: true, data };
}

interface GatheringForResponse {
  id: string;
  serverId: string;
  channelId: string | null;
  creatorId: string;
  title: string;
  description: string | null;
  startsAt: Date;
  durationMinutes: number;
  createdAt: Date;
  updatedAt: Date;
  channel: { id: string; name: string; type: string } | null;
  creator: { id: string; username: string; avatar: string | null };
  rsvps: Array<{ userId: string; status: string }>;
}

export function gatheringResponse(
  gathering: GatheringForResponse,
  viewerId: string,
  options: {
    canManageServer: boolean;
    canViewChannel: boolean;
    now?: Date;
  },
) {
  const { canManageServer, canViewChannel, now = new Date() } = options;
  const counts: Record<GatheringRsvpStatus, number> = {
    going: 0,
    maybe: 0,
    declined: 0,
  };
  for (const rsvp of gathering.rsvps) {
    const status = parseRsvpStatus(rsvp.status);
    if (status) counts[status] += 1;
  }

  const timing = gatheringTiming(
    gathering.startsAt,
    gathering.durationMinutes,
    now,
  );
  const viewerRsvp = gathering.rsvps.find(
    (rsvp) => rsvp.userId === viewerId,
  );
  return {
    id: gathering.id,
    serverId: gathering.serverId,
    channelId: canViewChannel ? gathering.channelId : null,
    creatorId: gathering.creatorId,
    title: gathering.title,
    description: gathering.description,
    startsAt: timing.startsAt.toISOString(),
    endsAt: timing.endsAt.toISOString(),
    durationMinutes: gathering.durationMinutes,
    phase: timing.phase,
    reminder: timing.phase === "reminder",
    channel: canViewChannel ? gathering.channel : null,
    creator: gathering.creator,
    participantCounts: counts,
    participantCount: counts.going,
    myRsvp: parseRsvpStatus(viewerRsvp?.status) ?? null,
    canManage: canManageServer || gathering.creatorId === viewerId,
    createdAt: gathering.createdAt.toISOString(),
    updatedAt: gathering.updatedAt.toISOString(),
  };
}
