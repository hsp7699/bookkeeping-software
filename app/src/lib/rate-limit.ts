import "server-only";

// A small in-memory fixed-window limiter. Enough for a single-server install;
// put a shared store behind it if you ever run more than one app instance.
const hits = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const h = hits.get(key);
  if (!h || h.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    return { ok: true, retryAfterSec: 0 };
  }
  h.count++;
  return { ok: h.count <= limit, retryAfterSec: Math.ceil((h.resetAt - now) / 1000) };
}
