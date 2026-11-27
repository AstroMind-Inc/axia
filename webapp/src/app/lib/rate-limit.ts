import { NextResponse } from "next/server";

// Per-user request limits for the routes that cost money or CPU.
//
// Any Google account can sign in, and each analysis request fans out into
// several OpenAI calls, so without a limit one account can run up the bill
// or saturate the box for everyone else. This is an in-process limiter: the
// webapp runs as a single Node process on one host, so counters live in
// memory and reset on restart. If the app is ever scaled out, move this to a
// shared store.

type Window = { limit: number; windowMs: number };

const BUCKETS = {
  /** Multi-agent chat and validation: several OpenAI calls each. */
  analysis: [
    { limit: 30, windowMs: 10 * 60_000 },
    { limit: 200, windowMs: 24 * 60 * 60_000 },
  ],
  /** Spectrum analysis, embeddings, neighbour scans: CPU on this host. */
  compute: [{ limit: 120, windowMs: 60_000 }],
  /** Writes that store data on disk. */
  upload: [{ limit: 20, windowMs: 60 * 60_000 }],
} satisfies Record<string, Window[]>;

export type Bucket = keyof typeof BUCKETS;

const hits = new Map<string, number[]>();
let lastSweep = Date.now();

function sweep(now: number) {
  // Drop keys with no hits inside the longest window, so memory stays
  // proportional to recently active users.
  const longest = Math.max(...Object.values(BUCKETS).flat().map((w) => w.windowMs));
  for (const [key, times] of hits) {
    if (!times.length || now - times[times.length - 1] > longest) hits.delete(key);
  }
  lastSweep = now;
}

/**
 * Record a request for `userId` in `bucket`. Returns a 429 response when the
 * user is over any of the bucket's limits, otherwise null.
 */
export function rateLimit(userId: string, bucket: Bucket, now = Date.now()): NextResponse | null {
  if (now - lastSweep > 10 * 60_000) sweep(now);

  const key = `${bucket}:${userId}`;
  const windows: Window[] = BUCKETS[bucket];
  const longest = Math.max(...windows.map((w) => w.windowMs));
  const times = (hits.get(key) ?? []).filter((t) => now - t < longest);

  for (const { limit, windowMs } of windows) {
    const inWindow = times.filter((t) => now - t < windowMs);
    if (inWindow.length >= limit) {
      const retryAfterS = Math.max(1, Math.ceil((inWindow[0] + windowMs - now) / 1000));
      hits.set(key, times);
      return NextResponse.json(
        { message: "Too many requests. Please wait and try again." },
        { status: 429, headers: { "Retry-After": String(retryAfterS) } },
      );
    }
  }

  times.push(now);
  hits.set(key, times);
  return null;
}

/** Test hook. */
export function resetRateLimits() {
  hits.clear();
}
