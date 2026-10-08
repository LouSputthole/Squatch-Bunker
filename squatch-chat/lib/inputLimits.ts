// Shared caps for user-supplied text. Next.js route modules may only export
// handlers and route config, so limits shared across routes live here.

export const MAX_MESSAGE_LENGTH = 4000;
export const MAX_REACTION_EMOJI_LENGTH = 64;
export const MAX_SERVER_NAME_LENGTH = 100;
export const MAX_SERVER_DESCRIPTION_LENGTH = 500;
export const MAX_CHANNEL_NAME_LENGTH = 100;
export const MAX_CHANNEL_DESCRIPTION_LENGTH = 200;
export const MAX_CHANNEL_TOPIC_LENGTH = 1024;

/** Cooldowns offered by the channel slow-mode picker. */
export const SLOW_MODE_SECONDS = [0, 5, 10, 30, 60, 300, 900, 3600, 21600] as const;

export type ParsedText = { ok: true; value: string } | { ok: false; error: string };

export function parseServerName(value: unknown): ParsedText {
  if (typeof value !== "string" || !value.trim()) {
    return { ok: false, error: "Server name is required" };
  }
  const name = value.trim();
  if (name.length > MAX_SERVER_NAME_LENGTH) {
    return { ok: false, error: `Server name must be at most ${MAX_SERVER_NAME_LENGTH} characters` };
  }
  return { ok: true, value: name };
}

/** Channel names are slugged (lowercase, whitespace → "-") before the cap. */
export function parseChannelName(value: unknown): ParsedText {
  if (typeof value !== "string" || !value.trim()) {
    return { ok: false, error: "Channel name is required" };
  }
  const name = value.trim().toLowerCase().replace(/\s+/g, "-");
  if (name.length > MAX_CHANNEL_NAME_LENGTH) {
    return { ok: false, error: `Channel name must be at most ${MAX_CHANNEL_NAME_LENGTH} characters` };
  }
  return { ok: true, value: name };
}

export function isSlowModeSeconds(value: unknown): value is (typeof SLOW_MODE_SECONDS)[number] {
  return typeof value === "number" && (SLOW_MODE_SECONDS as readonly number[]).includes(value);
}
