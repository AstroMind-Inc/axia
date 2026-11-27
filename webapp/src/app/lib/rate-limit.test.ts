import { describe, expect, it, beforeEach } from "vitest";
import { rateLimit, resetRateLimits } from "./rate-limit";

describe("rateLimit", () => {
  beforeEach(() => resetRateLimits());

  it("allows requests up to the limit, then returns 429 with Retry-After", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 30; i++) expect(rateLimit("u1", "analysis", t0 + i)).toBeNull();
    const blocked = rateLimit("u1", "analysis", t0 + 31);
    expect(blocked?.status).toBe(429);
    expect(Number(blocked?.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("keeps users and buckets independent", () => {
    const t0 = 2_000_000;
    for (let i = 0; i < 30; i++) rateLimit("u1", "analysis", t0 + i);
    expect(rateLimit("u2", "analysis", t0 + 40)).toBeNull();
    expect(rateLimit("u1", "compute", t0 + 40)).toBeNull();
  });

  it("frees capacity once the window has passed", () => {
    const t0 = 3_000_000;
    for (let i = 0; i < 30; i++) rateLimit("u1", "analysis", t0 + i);
    expect(rateLimit("u1", "analysis", t0 + 10 * 60_000 + 100)).toBeNull();
  });

  it("enforces the daily cap even when the short window is clear", () => {
    let t = 4_000_000;
    let allowed = 0;
    for (let i = 0; i < 400; i++) {
      if (rateLimit("u1", "analysis", t) === null) allowed++;
      t += 60_000; // one a minute: never trips the 10-minute window
    }
    expect(allowed).toBe(200);
  });
});
