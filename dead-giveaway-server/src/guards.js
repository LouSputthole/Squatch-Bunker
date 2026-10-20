// Payload guards, rate limiting and the never-throw wrapper.
//
// Socket payloads arrive untrusted. Every handler checks the shape of the
// fields it reads, every handler runs inside `safe()` so one bad packet never
// takes the process down, and every event spends from a per-player bucket.
// Patterns carried over from squatch-chat realtime/server.ts.

export function isPlainObject(v) {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

export const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

/** Serialized size in bytes, or Infinity if the value cannot be serialized. */
export function jsonSize(v) {
  try {
    const s = JSON.stringify(v);
    return s === undefined ? Infinity : Buffer.byteLength(s, 'utf8');
  } catch {
    return Infinity;
  }
}

/**
 * Token buckets keyed by string. `allow(key, rate, burst)` refills `rate`
 * tokens per second up to `burst` and spends one. Rejections do not spend.
 */
export function createLimiter({ now = () => Date.now() } = {}) {
  const buckets = new Map();
  return {
    allow(key, rate, burst = rate) {
      const t = now();
      let b = buckets.get(key);
      if (!b) {
        b = { tokens: burst, at: t, burst };
        buckets.set(key, b);
      } else {
        b.tokens = Math.min(burst, b.tokens + ((t - b.at) / 1000) * rate);
        b.at = t;
      }
      if (b.tokens < 1) return false;
      b.tokens -= 1;
      return true;
    },
    /** Forget buckets idle long enough to be full again. */
    prune(maxIdleMs = 60_000) {
      const t = now();
      for (const [key, b] of buckets) if (t - b.at > maxIdleMs) buckets.delete(key);
    },
    get size() {
      return buckets.size;
    },
  };
}

/** Wrap a handler so a sync throw or a rejected promise is logged, never fatal. */
export function safe(label, fn, onError = (err) => console.error(`[dg] handler ${label} failed:`, err)) {
  return (...args) => {
    try {
      const result = fn(...args);
      if (result && typeof result.then === 'function') result.catch(onError);
    } catch (err) {
      onError(err);
    }
  };
}
