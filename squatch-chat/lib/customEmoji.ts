// Custom server emoji: shared shapes and the rules for using them safely in
// message text (`:name:` tokens) and as reactions.

export interface CustomEmoji {
  id: string;
  name: string;
  url: string;
}

/** name -> image URL for one server; only ever built through toCustomEmojiMap. */
export type CustomEmojiMap = ReadonlyMap<string, string>;

export const EMPTY_CUSTOM_EMOJI_MAP: CustomEmojiMap = new Map();

const TOKEN_RE = /^:([A-Za-z0-9_]{1,32}):$/;
// Emoji images are uploaded through /api/upload, which serves them from
// /uploads/<random>.<ext>. Anything else (remote hosts, data:, javascript:,
// path tricks) is never rendered, even if a row somehow holds it.
const SAFE_URL_RE = /^\/uploads\/[A-Za-z0-9][A-Za-z0-9._-]{0,254}\.(?:png|jpe?g|gif|webp)$/i;

export function customEmojiToken(name: string): string {
  return `:${name}:`;
}

/** The emoji name inside a `:name:` token, or null when the string is not one. */
export function parseCustomEmojiToken(value: string): string | null {
  return TOKEN_RE.exec(value)?.[1] ?? null;
}

export function isSafeCustomEmojiUrl(url: unknown): url is string {
  return typeof url === "string" && SAFE_URL_RE.test(url) && !url.includes("..");
}

/** Build the render map from an emoji API response, dropping malformed rows. */
export function toCustomEmojiMap(rows: unknown): CustomEmojiMap {
  const map = new Map<string, string>();
  if (!Array.isArray(rows)) return map;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const { name, url } = row as Record<string, unknown>;
    if (typeof name !== "string" || !parseCustomEmojiToken(customEmojiToken(name))) continue;
    if (!isSafeCustomEmojiUrl(url)) continue;
    map.set(name, url);
  }
  return map;
}
