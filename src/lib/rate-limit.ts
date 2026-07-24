// Tiny in-memory rate limiter for unauthed routes.
//
// Why in-memory? Vercel's Edge runtime + Next.js Route Handlers
// run on serverless functions; the function instance can be
// recycled between requests, which means the counter can be reset.
// For our threat model (a bot spamming the public submit form or
// the AI endpoint) this is fine — the worst case is a determined
// attacker gets a fresh window every cold-start, which is still
// vastly better than no limit. If we ever need strict limits, swap
// this for a Redis / Upstash counter (~30 lines).
//
// Usage:
//   const rl = rateLimit({ key: `submit:${ip}`, limit: 5, windowMs: 60_000 });
//   if (!rl.allowed) return NextResponse.json({ error: "..." }, { status: 429 });

type Entry = { count: number; resetAt: number };

const store = new Map<string, Entry>();

// Periodic cleanup. We don't need this to be exact — the Map is
// process-local and the OS will reclaim memory if it grows out of
// bounds. The cleanup just keeps it from leaking abandoned keys
// after the window passes.
const CLEANUP_INTERVAL = 5 * 60_000; // 5 minutes
const MAX_AGE = 30 * 60_000; // 30 minutes
if (typeof setInterval !== "undefined") {
  // Guard for environments where setInterval is missing (e.g. Edge
  // runtime during testing). The cleanup is a nicety, not a
  // correctness requirement.
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of store) {
      if (v.resetAt + MAX_AGE < now) store.delete(k);
    }
  }, CLEANUP_INTERVAL).unref?.();
}

export function rateLimit(args: {
  key: string;
  limit: number;
  windowMs: number;
}):
  | { allowed: true; remaining: number; resetAt: number }
  | { allowed: false; remaining: 0; resetAt: number } {
  const now = Date.now();
  const entry = store.get(args.key);
  if (!entry || entry.resetAt < now) {
    const next: Entry = { count: 1, resetAt: now + args.windowMs };
    store.set(args.key, next);
    return { allowed: true, remaining: args.limit - 1, resetAt: next.resetAt };
  }
  if (entry.count >= args.limit) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }
  entry.count++;
  return { allowed: true, remaining: args.limit - entry.count, resetAt: entry.resetAt };
}

// Reset for tests.
export function __resetRateLimit() {
  store.clear();
}

/**
 * Best-effort client IP from common proxy headers. Returns 'unknown'
 * if none are present (e.g. in a test environment).
 */
export function getClientIp(headers: Headers): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "unknown"
  );
}
