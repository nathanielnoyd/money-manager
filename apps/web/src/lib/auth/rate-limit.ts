import "server-only";

/**
 * Small in-memory fixed-window limiter. A self-hosted instance runs one web
 * process, so this is sufficient; it resets on restart.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 10_000) {
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    }
    return true;
  }
  b.count += 1;
  return b.count <= limit;
}

/** True when `key` has already used up `limit` in its current window (doesn't count a hit). */
export function isLimited(key: string, limit: number): boolean {
  const b = buckets.get(key);
  return !!b && b.resetAt > Date.now() && b.count >= limit;
}
