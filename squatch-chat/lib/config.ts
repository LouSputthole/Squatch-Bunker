// Centralized configuration — all env vars and shared constants in one place.
// Nothing is hardcoded. Every value comes from env vars with dev-only fallbacks.

// Known insecure placeholder secrets that must never be used to sign JWTs.
const JWT_SECRET_PLACEHOLDERS = new Set([
  "campfire-secret-change-me",
  "campfire-secret-change-me-in-production",
]);

/**
 * Resolve and validate JWT_SECRET at startup. Fails fast (throws) when the
 * secret is missing, too short to be safe, or left at a known placeholder — so
 * a deploy can never silently fall back to a guessable signing key.
 */
function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      "JWT_SECRET is not set. Set a strong, random JWT_SECRET (at least 32 characters) before starting the server."
    );
  }
  if (secret.length < 32) {
    throw new Error(
      "JWT_SECRET is too short. Use at least 32 characters of random data."
    );
  }
  if (JWT_SECRET_PLACEHOLDERS.has(secret)) {
    throw new Error(
      "JWT_SECRET is set to a known placeholder value. Replace it with a strong, random secret."
    );
  }
  return secret;
}

export const config = {
  // Server URLs
  appUrl: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  socketUrl: process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001",
  socketPort: parseInt(process.env.SOCKET_PORT || "3001", 10),
  socketPath: process.env.SOCKET_PATH || "/api/socketio",

  // Auth — validated at startup; never falls back to a hardcoded secret.
  jwtSecret: resolveJwtSecret(),
  cookieName: process.env.COOKIE_NAME || "squatch-token",

  // Database
  databaseUrl: process.env.DATABASE_URL || "",

  // Environment
  isProduction: process.env.NODE_ENV === "production",

  // Cookie settings — Secure is on automatically for production (HTTPS) or when
  // explicitly opted in via COOKIE_SECURE=1, so an HTTPS prod deploy is Secure
  // by default. SameSite stays Lax (CSRF-safe, same-origin); COOKIE_SECURE=1
  // signals a cross-origin HTTPS deploy, which needs SameSite=None (and None
  // requires Secure). Local http dev stays non-Secure / Lax so cookies work
  // without TLS.
  get cookieFlags(): string {
    const crossOrigin = process.env.COOKIE_SECURE === "1";
    const secureEnabled = this.isProduction || crossOrigin;
    const secure = secureEnabled ? " Secure;" : "";
    const sameSite = crossOrigin ? "None" : "Lax";
    return `Path=/; HttpOnly; SameSite=${sameSite};${secure} Max-Age=${60 * 60 * 24 * 7}`;
  },

  // CORS — supports comma-separated origins for multi-domain
  get corsOrigins(): string | string[] {
    const origins = process.env.CORS_ORIGINS || this.appUrl;
    return origins.includes(",") ? origins.split(",").map((s) => s.trim()) : origins;
  },

  // Upload limits
  maxAvatarSize: parseInt(process.env.MAX_AVATAR_SIZE || String(2 * 1024 * 1024), 10),
  maxUploadSize: parseInt(process.env.MAX_UPLOAD_SIZE || String(10 * 1024 * 1024), 10),
};
