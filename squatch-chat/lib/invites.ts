export type InviteAvailability = "active" | "revoked" | "expired" | "exhausted";

export interface ManagedInviteState {
  inviteExpiresAt: Date | string | null;
  inviteMaxUses: number | null;
  inviteUseCount: number;
  inviteRevokedAt: Date | string | null;
}

export const MIN_INVITE_LIFETIME_SECONDS = 60;
export const MAX_INVITE_LIFETIME_SECONDS = 365 * 24 * 60 * 60;
export const MAX_INVITE_USES = 100_000;

function asDate(value: Date | string | null): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function getInviteAvailability(
  invite: ManagedInviteState,
  now = new Date(),
): InviteAvailability {
  if (invite.inviteRevokedAt) return "revoked";

  const expiresAt = asDate(invite.inviteExpiresAt);
  if (expiresAt && expiresAt.getTime() <= now.getTime()) return "expired";

  if (
    invite.inviteMaxUses !== null &&
    invite.inviteUseCount >= invite.inviteMaxUses
  ) {
    return "exhausted";
  }

  return "active";
}

export function remainingInviteUses(invite: ManagedInviteState): number | null {
  if (invite.inviteMaxUses === null) return null;
  return Math.max(0, invite.inviteMaxUses - invite.inviteUseCount);
}

export function inviteAvailabilityMessage(status: InviteAvailability): string {
  if (status === "revoked") return "This invite link has been revoked";
  if (status === "expired") return "This invite link has expired";
  if (status === "exhausted") return "This invite link has reached its use limit";
  return "Invite is active";
}

interface ParsedInviteRegeneration {
  ok: true;
  expiresAt?: Date | null;
  maxUses?: number | null;
}

interface InvalidInviteRegeneration {
  ok: false;
  error: string;
}

/**
 * Parse optional settings supplied while rotating the canonical invite.
 * Omitted values preserve the current setting; null explicitly removes it.
 */
export function parseInviteRegeneration(
  body: Record<string, unknown>,
  now = new Date(),
): ParsedInviteRegeneration | InvalidInviteRegeneration {
  const result: ParsedInviteRegeneration = { ok: true };

  if (Object.prototype.hasOwnProperty.call(body, "inviteExpiresInSeconds")) {
    const seconds = body.inviteExpiresInSeconds;
    if (seconds === null) {
      result.expiresAt = null;
    } else if (
      typeof seconds !== "number" ||
      !Number.isInteger(seconds) ||
      seconds < MIN_INVITE_LIFETIME_SECONDS ||
      seconds > MAX_INVITE_LIFETIME_SECONDS
    ) {
      return {
        ok: false,
        error: "Invite expiry must be between 1 minute and 365 days",
      };
    } else {
      result.expiresAt = new Date(now.getTime() + seconds * 1000);
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "inviteMaxUses")) {
    const maxUses = body.inviteMaxUses;
    if (maxUses === null) {
      result.maxUses = null;
    } else if (
      typeof maxUses !== "number" ||
      !Number.isInteger(maxUses) ||
      maxUses < 1 ||
      maxUses > MAX_INVITE_USES
    ) {
      return {
        ok: false,
        error: `Invite use limit must be between 1 and ${MAX_INVITE_USES.toLocaleString()}`,
      };
    } else {
      result.maxUses = maxUses;
    }
  }

  return result;
}
