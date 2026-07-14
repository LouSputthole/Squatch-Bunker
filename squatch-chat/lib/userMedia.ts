import { resolve } from "node:path";

const CONTENT_TYPES: Record<string, string> = {
  gif: "image/gif",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  ogg: "audio/ogg",
  pdf: "application/pdf",
  png: "image/png",
  txt: "text/plain; charset=utf-8",
  webm: "audio/webm",
  webp: "image/webp",
  zip: "application/zip",
};

export function getUserMediaRoot(): string {
  const configuredRoot = process.env.CAMPFIRE_UPLOAD_DIR;
  if (configuredRoot) {
    return resolve(/*turbopackIgnore: true*/ configuredRoot);
  }
  return resolve(process.cwd(), "public");
}

export function resolveUserMediaPath(
  publicUrl: string,
  mediaRoot = getUserMediaRoot(),
): string | null {
  let pathname: string;
  try {
    pathname = decodeURIComponent(publicUrl.split(/[?#]/, 1)[0]);
  } catch {
    return null;
  }
  const match = pathname.match(
    /^\/(uploads|avatars)\/([A-Za-z0-9][A-Za-z0-9._-]{0,254})$/,
  );
  if (!match) return null;
  return resolve(mediaRoot, match[1], match[2]);
}

export function userMediaContentType(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPES[extension] ?? "application/octet-stream";
}

export function userMediaCacheControl(publicUrl: string): string {
  const pathname = publicUrl.split(/[?#]/, 1)[0];
  return pathname.startsWith("/uploads/")
    ? "public, max-age=31536000, immutable"
    : "public, max-age=0, must-revalidate";
}
