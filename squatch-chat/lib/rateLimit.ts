// In-memory token bucket rate limiter
// Configurable via env: RATE_LIMIT_REQUESTS (default 30), RATE_LIMIT_WINDOW_MS (default 60000)

const REQUESTS = parseInt(process.env.RATE_LIMIT_REQUESTS ?? "30");
const WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? "60000");

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Clean up stale buckets periodically
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    buckets.forEach((bucket, key) => {
      if (bucket.resetAt < now) buckets.delete(key);
    });
  }, WINDOW_MS);
}

export function checkRateLimit(key: string): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  let bucket = buckets.get(key);

  if (!bucket || bucket.resetAt < now) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(key, bucket);
  }

  bucket.count++;
  const remaining = Math.max(0, REQUESTS - bucket.count);
  const allowed = bucket.count <= REQUESTS;

  return { allowed, remaining, resetAt: bucket.resetAt };
}
