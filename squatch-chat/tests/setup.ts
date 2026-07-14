import { TEST_DB_URL } from "./db-path";

// Runs (via Vitest setupFiles) before any app module is imported. lib/config
// validates JWT_SECRET at import time and throws if it is missing or < 32 chars,
// so it must exist first. A CI-provided JWT_SECRET is honoured; otherwise a
// long throwaway value is used.
process.env.JWT_SECRET ||= "test-jwt-secret-please-ignore-0123456789-abcdef";

// Tests are hermetic: always point at the throwaway SQLite file, never a real DB.
process.env.DATABASE_URL = TEST_DB_URL;

// Route tests use distinct, documentation-only client addresses to isolate the
// in-memory limiter. Production keeps forwarding headers untrusted by default.
process.env.CAMPFIRE_TRUST_PROXY_HOPS ||= "1";
