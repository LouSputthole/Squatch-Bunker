// 3D room scenes for voice rooms. The marketing site (LouSputthole/campfire-site)
// serves its three.js clearing parked on one scene at /room?room=<scene>, and
// components/CircleView.tsx frames it in an <iframe> behind the seats. The painted
// PNG in public/rooms stays underneath as the poster, the offline fallback, and the
// whole backdrop when the embed is off.
//
// NEXT_PUBLIC_CAMPFIRE_SCENES_URL (build time): the site's origin. Unset -> the
// official site; "off" -> painted scenes only (air-gapped or self-hosted servers
// that would rather not load a third-party frame).
export const DEFAULT_CAMPFIRE_SCENES_URL = "https://campfire-site-one.vercel.app";

export const SCENE_EMBED_MESSAGE_TYPE = "campfire:room";

function normalizeBase(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (value === "off") return null;
  const base = (value || DEFAULT_CAMPFIRE_SCENES_URL).replace(/\/+$/, "");
  return /^https?:\/\/[^/\s]+$/i.test(base) ? base : null;
}

export const CAMPFIRE_SCENES_URL: string | null = normalizeBase(process.env.NEXT_PUBLIC_CAMPFIRE_SCENES_URL);

/** Embed URL for a scene, or null when the embed is off or the base URL is invalid. */
export function roomSceneEmbedUrl(scene: string, base: string | null = CAMPFIRE_SCENES_URL): string | null {
  if (!base) return null;
  return `${base}/room?room=${encodeURIComponent(scene)}`;
}

/** Origin to address postMessage to (never "*": the frame is a third-party page). */
export function sceneEmbedOrigin(base: string | null = CAMPFIRE_SCENES_URL): string | null {
  if (!base) return null;
  try {
    return new URL(base).origin;
  } catch {
    return null;
  }
}

/** Exposed for tests. */
export const _normalizeSceneEmbedBase = normalizeBase;
