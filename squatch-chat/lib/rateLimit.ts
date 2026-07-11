// In-memory token bucket rate limiter
// Configurable via env: RATE_LIMIT_REQUESTS (default 30), RATE_LIMIT_WINDOW_MS (default 60000)

const REQUESTS = parseInt(process.env.RATE_LIMIT_REQUESTS ?? "30");
const WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? "60000");

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

interface WeightedBucket {
  used: number;
  resetAt: number;
}

const weightedBuckets = new Map<string, WeightedBucket>();

// Clean up stale buckets periodically
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    buckets.forEach((bucket, key) => {
      if (bucket.resetAt < now) buckets.delete(key);
    });
    weightedBuckets.forEach((bucket, key) => {
      if (bucket.resetAt < now) weightedBuckets.delete(key);
    });
  }, WINDOW_MS).unref?.();
}

/**
 * Fixed-window limiter with per-call weight (e.g. upload bytes) and per-key
 * window/max instead of the module-global config. Consumes only when allowed,
 * so a rejected call doesn't burn budget.
 * ponytail: in-memory like the bucket above — per-node on multi-node deploys;
 * move both to a shared store if hosted ever runs >1 instance.
 */
export function checkWeightedLimit(
  key: string,
  weight: number,
  max: number,
  windowMs: number,
): { allowed: boolean; resetAt: number } {
  const now = Date.now();
  let bucket = weightedBuckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    bucket = { used: 0, resetAt: now + windowMs };
    weightedBuckets.set(key, bucket);
  }
  if (bucket.used + weight > max) return { allowed: false, resetAt: bucket.resetAt };
  bucket.used += weight;
  return { allowed: true, resetAt: bucket.resetAt };
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
