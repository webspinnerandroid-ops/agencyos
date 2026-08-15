import { describe, it, expect } from "vitest";
import {
  normalizeStoredPrice,
  fmt,
  classifyDrift,
  detectWebhookService,
  buildWebhookPayload,
  type DriftSummary,
} from "./price-drift";

describe("normalizeStoredPrice", () => {
  it("parses plain and formatted dollar amounts", () => {
    expect(normalizeStoredPrice("29")).toBe(29);
    expect(normalizeStoredPrice("$29")).toBe(29);
    expect(normalizeStoredPrice("$29.99")).toBe(29.99);
    expect(normalizeStoredPrice("$ 1,299")).toBe(1299);
    expect(normalizeStoredPrice("$1,299.50")).toBe(1299.5);
    expect(normalizeStoredPrice("  $0  ")).toBe(0);
  });

  it("returns null for missing or unparseable values", () => {
    expect(normalizeStoredPrice("")).toBeNull();
    expect(normalizeStoredPrice("free")).toBeNull();
    expect(normalizeStoredPrice("abc")).toBeNull();
    expect(normalizeStoredPrice("$")).toBeNull();
    expect(normalizeStoredPrice(undefined as unknown as string)).toBeNull();
  });
});

describe("classifyDrift", () => {
  it("flags SYNCED when stored matches the live price within tolerance", () => {
    expect(classifyDrift(29, 2900)).toBe("SYNCED");
    expect(classifyDrift(49, 4900)).toBe("SYNCED");
    expect(classifyDrift(29.99, 2999)).toBe("SYNCED");
    expect(classifyDrift(29, 2900.05)).toBe("SYNCED");
  });

  it("flags DRIFT when stored differs from the live price", () => {
    expect(classifyDrift(29, 3900)).toBe("DRIFT");
    expect(classifyDrift(30, 2900)).toBe("DRIFT");
    expect(classifyDrift(29, 2901)).toBe("DRIFT");
    expect(classifyDrift(69, 6901)).toBe("DRIFT");
  });

  it("distinguishes missing live price from missing stored price", () => {
    expect(classifyDrift(29, null)).toBe("NO STRIPE PRICE");
    expect(classifyDrift(null, null)).toBe("NO STORED PRICE");
  });

  it("flags an unparseable stored price as drift", () => {
    expect(classifyDrift(null, 2900)).toBe("DRIFT (stored unparseable)");
  });
});

describe("fmt", () => {
  it("renders whole dollars without decimals and cents otherwise", () => {
    expect(fmt(2900)).toBe("29");
    expect(fmt(4900)).toBe("49");
    expect(fmt(2999)).toBe("29.99");
    expect(fmt(6900)).toBe("69");
  });
});

describe("webhook payloads", () => {
  const summary: DriftSummary = {
    total: 2,
    failures: 1,
    ok: false,
    entries: [
      {
        kind: "plan",
        id: "foundation",
        status: "SYNCED",
        storedStr: "$49/mo",
        liveStr: "$49/mo (price_abc)",
      },
      {
        kind: "hub",
        id: "content",
        status: "DRIFT",
        storedStr: "$29/mo",
        liveStr: "$39/mo (price_def)",
      },
    ],
  };

  it("detects the service from the webhook URL", () => {
    expect(
      detectWebhookService("https://discord.com/api/webhooks/123/abc")
    ).toBe("discord");
    expect(
      detectWebhookService("https://hooks.slack.com/services/T1/B2/x3")
    ).toBe("slack");
    expect(
      detectWebhookService("https://example.com/hooks/whatever")
    ).toBe("slack");
  });

  it("builds a Discord embed payload", () => {
    const p = buildWebhookPayload("discord", summary, "123");
    expect(p.username).toBe("Price Drift Check");
    const embeds = p.embeds as Array<Record<string, unknown>>;
    expect(embeds).toHaveLength(1);
    expect(embeds[0].title).toContain("1 item(s) out of sync");
    expect(embeds[0].color).toBe(0xe74c3c);
    const fields = embeds[0].fields as Array<Record<string, unknown>>;
    expect(fields).toHaveLength(2);
    expect(fields[0].name).toBe("plan foundation");
    expect(fields[1].value).toContain("DRIFT");
    expect(fields[1].value).toContain("$29/mo");
    expect(embeds[0].footer).toEqual({ text: "Agency OS · workflow run 123" });
  });

  it("builds a Slack attachment payload", () => {
    const p = buildWebhookPayload("slack", summary, undefined);
    expect(p.text).toContain("1 item(s) out of sync");
    const att = (p.attachments as Array<Record<string, unknown>>)[0];
    expect(att.color).toBe("danger");
    const fields = att.fields as Array<Record<string, unknown>>;
    expect(fields[0].title).toBe("plan foundation");
    expect(fields[0].value).toContain("SYNCED");
  });

  it("uses the success style when everything is synced", () => {
    const okSummary: DriftSummary = { ...summary, failures: 0, ok: true };
    const discord = buildWebhookPayload(
      "discord",
      okSummary,
      undefined
    ) as { embeds: Array<{ color: number; title: string }> };
    expect(discord.embeds[0].color).toBe(0x2ecc71);
    expect(discord.embeds[0].title).toContain("ALL SYNCED");

    const slack = buildWebhookPayload("slack", okSummary, undefined) as {
      attachments: Array<{ color: string }>;
    };
    expect(slack.attachments[0].color).toBe("good");
  });
});
