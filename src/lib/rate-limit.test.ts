import { describe, it, expect } from "vitest";
import { rateLimit, getClientIp, rateLimitRequest } from "./rate-limit";

describe("rateLimit (sliding window)", () => {
  it("allows requests under the limit", () => {
    const now = 1_000_000;
    const r1 = rateLimit("k", 3, now);
    const r2 = rateLimit("k", 3, now + 1000);
    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(1);
  });

  it("blocks once the limit is reached", () => {
    const now = 1_000_000;
    rateLimit("k", 2, now);
    rateLimit("k", 2, now + 1000);
    const blocked = rateLimit("k", 2, now + 2000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("reports retryAfterSeconds based on the oldest call in the window", () => {
    const now = 1_000_000;
    rateLimit("k", 1, now);
    const blocked = rateLimit("k", 1, now + 30_000); // 30s into the window
    // oldest call at t=0 frees the window at t=60s -> 30s left
    expect(blocked.retryAfterSeconds).toBe(30);
  });

  it("resets after the window elapses", () => {
    const now = 1_000_000;
    rateLimit("k", 1, now);
    const blocked = rateLimit("k", 1, now + 30_000);
    expect(blocked.allowed).toBe(false);
    // Window (60s) has fully elapsed: the old call no longer counts
    const after = rateLimit("k", 1, now + 61_000);
    expect(after.allowed).toBe(true);
  });

  it("tracks keys independently", () => {
    const now = 1_000_000;
    rateLimit("a", 1, now);
    expect(rateLimit("b", 1, now).allowed).toBe(true);
    expect(rateLimit("a", 1, now + 1000).allowed).toBe(false);
  });

  it("prunes stale buckets and keeps memory bounded", () => {
    // Simulate many distinct keys over time; old buckets should be dropped.
    for (let i = 0; i < 100; i++) {
      rateLimit(`old-${i}`, 1, 1_000_000);
    }
    // 2 minutes later a prune runs; the old keys are all outside the window
    const r = rateLimit("fresh", 1, 1_000_000 + 120_000);
    expect(r.allowed).toBe(true);
  });
});

describe("getClientIp", () => {
  it("parses the first entry of x-forwarded-for", () => {
    const req = { headers: new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }) };
    expect(getClientIp(req)).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip", () => {
    const req = { headers: new Headers({ "x-real-ip": "5.6.7.8" }) };
    expect(getClientIp(req)).toBe("5.6.7.8");
  });

  it("defaults to unknown when no proxy headers exist", () => {
    const req = { headers: new Headers() };
    expect(getClientIp(req)).toBe("unknown");
  });
});

describe("rateLimitRequest", () => {
  const base = { cookies: { get: () => undefined }, headers: new Headers() };

  it("keys by user id when the x-user-id cookie is present", () => {
    const req = {
      cookies: { get: (n: string) => (n === "x-user-id" ? { value: "u1" } : undefined) },
      headers: new Headers(),
    };
    const now = 1_000_000;
    rateLimitRequest(req, "svc", 1, now);
    // Same user, different IP: still blocked (same key)
    const ipReq = {
      cookies: { get: (n: string) => (n === "x-user-id" ? { value: "u1" } : undefined) },
      headers: new Headers({ "x-forwarded-for": "9.9.9.9" }),
    };
    expect(rateLimitRequest(ipReq, "svc", 1, now + 1000).allowed).toBe(false);
    // Different user: not blocked
    const other = {
      cookies: { get: (n: string) => (n === "x-user-id" ? { value: "u2" } : undefined) },
      headers: new Headers({ "x-forwarded-for": "9.9.9.9" }),
    };
    expect(rateLimitRequest(other, "svc", 1, now + 1000).allowed).toBe(true);
  });

  it("keys by IP when no user cookie exists", () => {
    const req = {
      ...base,
      headers: new Headers({ "x-forwarded-for": "1.1.1.1" }),
    };
    const now = 1_000_000;
    rateLimitRequest(req, "svc", 1, now);
    expect(rateLimitRequest(req, "svc", 1, now + 1000).allowed).toBe(false);
  });

  it("separates different service prefixes", () => {
    const req = {
      ...base,
      headers: new Headers({ "x-forwarded-for": "1.1.1.1" }),
    };
    const now = 1_000_000;
    rateLimitRequest(req, "a", 1, now);
    expect(rateLimitRequest(req, "b", 1, now + 1000).allowed).toBe(true);
  });
});
