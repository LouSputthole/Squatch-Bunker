// Centralized configuration — all env vars and shared constants in one place.
// Nothing is hardcoded. Every value comes from env vars with dev-only fallbacks.

export const config = {
  // Server URLs
  appUrl: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  socketUrl: process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001",
  socketPort: parseInt(process.env.SOCKET_PORT || "3001", 10),
  socketPath: process.env.SOCKET_PATH || "/api/socketio",

  // Auth
  jwtSecret: process.env.JWT_SECRET || "campfire-secret-change-me",
  cookieName: process.env.COOKIE_NAME || "squatch-token",

  // Database
  databaseUrl: process.env.DATABASE_URL || "",

  // Environment
  isProduction: process.env.NODE_ENV === "production",

  // Cookie settings — use Lax by default (works for same-origin on HTTP LAN).
  // SameSite=None requires Secure (HTTPS). Only opt in via COOKIE_SECURE=1
  // when running behind HTTPS with cross-origin needs.
  get cookieFlags(): string {
    const forceSecure = process.env.COOKIE_SECURE === "1";
    const secure = forceSecure ? " Secure;" : "";
    const sameSite = forceSecure ? "None" : "Lax";
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
