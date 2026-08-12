import { describe, it, expect, vi, afterEach } from "vitest";
import {
  checkStripeBalance,
  checkResendUsage,
  autoCheck,
} from "./subscription-check";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe("checkStripeBalance", () => {
  afterEach(() => vi.restoreAllMocks());

  it("converts Stripe's cents balance to dollars", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          available: [{ amount: 12550, currency: "usd" }],
        })
      )
    );
    const r = await checkStripeBalance("sk_test");
    expect(r.creditRemaining).toBe(125.5);
  });

  it("sums multiple balances and throws on provider errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          available: [
            { amount: 1000, currency: "usd" },
            { amount: 500, currency: "usd" },
          ],
        })
      )
    );
    expect((await checkStripeBalance("sk")).creditRemaining).toBe(15);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 401)));
    await expect(checkStripeBalance("bad")).rejects.toThrow();
  });
});

describe("checkResendUsage", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reports remaining emails in the cycle", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ usage: 1200, limit: 3000 }))
    );
    const r = await checkResendUsage("re_test");
    expect(r.creditRemaining).toBe(1800);
    expect(r.detail).toContain("1,200");
  });

  it("returns null credit on unlimited plans", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ usage: 500, limit: 0 }))
    );
    const r = await checkResendUsage("re_test");
    expect(r.creditRemaining).toBeNull();
  });

  it("throws when the provider rejects the key", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 403)));
    await expect(checkResendUsage("bad")).rejects.toThrow();
  });
});

describe("autoCheck", () => {
  afterEach(() => vi.restoreAllMocks());

  it("routes stripe and resend to their checks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ available: [{ amount: 500 }] }))
    );
    expect((await autoCheck("stripe", "k")).creditRemaining).toBe(5);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ usage: 10, limit: 100 }))
    );
    expect((await autoCheck("resend", "k")).creditRemaining).toBe(90);
  });

  it("rejects unsupported providers", async () => {
    await expect(autoCheck("manual", "k")).rejects.toThrow(/No auto-check/);
    await expect(autoCheck("docusign", "k")).rejects.toThrow(/No auto-check/);
  });
});
