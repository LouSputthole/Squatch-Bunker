/**
 * Campfire desktop — static file handler for user uploads.
 *
 * When installed, the app folder (and its bundled `public/`) is read-only, so
 * uploads are written to the writable data dir instead (CAMPFIRE_UPLOAD_DIR).
 * Next only serves files from its own bundled `public/`, so this handler serves
 * `/uploads/*` and `/avatars/*` from the data dir before Next sees the request.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { join, normalize, extname, sep } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".zip": "application/zip",
};

export function makeStaticHandler(baseDir: string) {
  const roots = {
    "/uploads/": normalize(join(baseDir, "uploads")) + sep,
    "/avatars/": normalize(join(baseDir, "avatars")) + sep,
  };

  return function handleStatic(req: IncomingMessage, res: ServerResponse): boolean {
    const rawUrl = (req.url || "").split("?")[0];
    const prefix = (Object.keys(roots) as (keyof typeof roots)[]).find((p) =>
      rawUrl.startsWith(p),
    );
    if (!prefix) return false;

    let rel: string;
    try {
      rel = decodeURIComponent(rawUrl.slice(1));
    } catch {
      res.statusCode = 400;
      res.end();
      return true;
    }

    const full = normalize(join(baseDir, rel));
    // Reject path traversal — the resolved path must stay inside the served root.
    if (!full.startsWith(roots[prefix])) {
      res.statusCode = 403;
      res.end();
      return true;
    }

    // Missing file: let Next handle it (it will 404) rather than serving nothing.
    if (!existsSync(full) || !statSync(full).isFile()) return false;

    res.statusCode = 200;
    res.setHeader("Content-Type", MIME[extname(full).toLowerCase()] || "application/octet-stream");
    // Uploads are content-addressed (random filename per upload) → immutable.
    // Avatars reuse a STABLE filename per user (`<userId>.<ext>`), so immutable
    // would pin the old image in Chromium's cache for a year after a change.
    res.setHeader(
      "Cache-Control",
      prefix === "/uploads/" ? "public, max-age=31536000, immutable" : "no-cache",
    );
    const stream = createReadStream(full);
    // Without a listener a stream 'error' (file deleted/locked between stat and
    // open) is an uncaught exception that kills the whole server process.
    stream.on("error", (err) => {
      console.error(`[Campfire] static read failed for ${full}:`, err.message);
      if (!res.headersSent) res.statusCode = 500;
      res.end();
    });
    stream.pipe(res);
    return true;
  };
}
