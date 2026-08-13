import { describe, it, expect, vi, afterEach } from "vitest";
import {
  checkStripeBalance,
  checkResendUsage,
  checkFalBilling,
  checkOpenAIKey,
  checkGoogleAIKey,
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

describe("checkFalBilling", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reads the fal.ai credit balance and uses the Key prefix", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ credits: { current_balance: 24.5, currency: "USD" } }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await checkFalBilling("fal-key");
    expect(r.creditRemaining).toBe(24.5);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("account/billing");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Key fal-key" });
  });

  it("returns null credit when balance is missing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ username: "team" })));
    const r = await checkFalBilling("fal-key");
    expect(r.creditRemaining).toBeNull();
  });

  it("throws on auth failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 401)));
    await expect(checkFalBilling("bad")).rejects.toThrow();
  });
});

describe("checkOpenAIKey", () => {
  afterEach(() => vi.restoreAllMocks());

  it("validates the key and reports no balance endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ data: [] })));
    const r = await checkOpenAIKey("sk-openai");
    expect(r.creditRemaining).toBeNull();
    expect(r.detail).toMatch(/doesn't expose a balance/i);
  });

  it("throws when the key is invalid", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 401)));
    await expect(checkOpenAIKey("bad")).rejects.toThrow();
  });
});

describe("checkGoogleAIKey", () => {
  afterEach(() => vi.restoreAllMocks());

  it("validates the key and reports no balance endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ models: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await checkGoogleAIKey("g-key");
    expect(r.creditRemaining).toBeNull();
    expect(r.detail).toMatch(/doesn't expose a credit balance/i);
    expect(String(fetchMock.mock.calls[0][0])).toContain("key=g-key");
  });

  it("throws when the key is invalid", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 400)));
    await expect(checkGoogleAIKey("bad")).rejects.toThrow();
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

  it("routes fal/openai/google to their checks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ credits: { current_balance: 3 } }))
    );
    expect((await autoCheck("fal", "k")).creditRemaining).toBe(3);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ data: [] })));
    expect((await autoCheck("openai", "k")).creditRemaining).toBeNull();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ models: [] })));
    expect((await autoCheck("google", "k")).creditRemaining).toBeNull();
  });

  it("rejects unsupported providers", async () => {
    await expect(autoCheck("manual", "k")).rejects.toThrow(/No auto-check/);
    await expect(autoCheck("docusign", "k")).rejects.toThrow(/No auto-check/);
  });
});
