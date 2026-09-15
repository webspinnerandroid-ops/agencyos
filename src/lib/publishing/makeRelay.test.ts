import { describe, it, expect } from "vitest";
import { isValidRelayUrl, RELAY_PLATFORMS } from "./makeRelay";

/**
 * The Make relay's security-critical surface is URL validation: the webhook
 * URL is a bearer credential (anyone holding it can post to the tenant's
 * social accounts), so the validator must accept real Make hook hosts and
 * reject lookalikes, non-HTTPS, and garbage. These tests pin that behavior.
 */
describe("Make relay URL validation", () => {
  it("accepts real Make.com webhook hosts (all regions)", () => {
    expect(isValidRelayUrl("https://hook.eu2.make.com/abc123")).toBe(true);
    expect(isValidRelayUrl("https://hook.us1.make.com/token")).toBe(true);
    expect(isValidRelayUrl("https://hook.make.com/xyz")).toBe(true);
  });

  it("rejects non-HTTPS and non-Make hosts", () => {
    expect(isValidRelayUrl("http://hook.eu2.make.com/abc123")).toBe(false);
    expect(isValidRelayUrl("https://evil.example.com/hook")).toBe(false);
    expect(isValidRelayUrl("https://hook.eu2.make.com.evil.io/steal")).toBe(
      false
    );
    expect(isValidRelayUrl("https://make.com.hook.evil.io/x")).toBe(false);
  });

  it("rejects garbage and empty input", () => {
    expect(isValidRelayUrl("")).toBe(false);
    expect(isValidRelayUrl("not a url")).toBe(false);
    expect(isValidRelayUrl("javascript:alert(1)")).toBe(false);
  });
});

describe("Make relay platform coverage", () => {
  it("covers every non-direct platform plus Facebook and Instagram", () => {
    for (const p of [
      "facebook",
      "instagram",
      "linkedin",
      "tiktok",
      "threads",
      "reddit",
      "pinterest",
    ]) {
      expect(RELAY_PLATFORMS.has(p), p).toBe(true);
    }
  });

  it("excludes the direct-OAuth platforms that bypass the relay", () => {
    expect(RELAY_PLATFORMS.has("twitter")).toBe(false);
    expect(RELAY_PLATFORMS.has("youtube")).toBe(false);
    expect(RELAY_PLATFORMS.has("gbp")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Per-client overrides + payload identity (migration 114)
// ---------------------------------------------------------------------------

import { vi, beforeEach } from "vitest";
import { publishViaRelay, getRelayWebhookUrl } from "./makeRelay";

// In-memory stand-ins for the two config tables.
const db: Record<string, unknown | null> = {
  make_relay_config: null,
  make_relay_client_overrides: null,
};

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: () => chain(table),
      upsert: () => chain(table),
      update: () => chain(table),
      delete: () => chain(table),
    }),
  }),
}));

// Builder with only the chain pieces the relay module uses.
function chain(table: string) {
  const p: PromiseLike<{ data: unknown }> = {
    then: (resolve) => resolve({ data: db[table] ?? null }),
  };
  const obj: Record<string, unknown> = {
    maybeSingle: () => p,
    single: () => p,
  };
  return new Proxy(obj, {
    get(target, prop) {
      if (prop in target) return target[prop];
      // eq/order/limit etc. return the same chainable.
      target[prop] = () => obj;
      return target[prop];
    },
  });
}

vi.mock("@/lib/encryption", () => ({
  encrypt: (v: string) => `enc:${v}`,
  decrypt: (v: string) => (v.startsWith("enc:") ? v.slice(4) : null),
}));

const delivered: { url?: string; body?: unknown } = {};
vi.mock("@/lib/fetch-with-timeout", () => ({
  fetchWithTimeout: async (url: string, init: RequestInit) => {
    delivered.url = url;
    delivered.body = JSON.parse(String(init.body));
    return { ok: true, json: async () => ({ id: "mk_1" }) };
  },
}));

beforeEach(() => {
  db.make_relay_config = {
    encrypted_url: "enc:https://hook.eu2.make.com/tenant",
    enabled: true,
  };
  db.make_relay_client_overrides = null;
  delivered.url = undefined;
  delivered.body = undefined;
});

describe("Make relay per-client webhook resolution", () => {
  it("uses the client override when one is enabled", async () => {
    db.make_relay_client_overrides = {
      encrypted_url: "enc:https://hook.eu2.make.com/clientA",
      enabled: true,
    };
    const url = await getRelayWebhookUrl("t1", "client-a");
    expect(url).toBe("https://hook.eu2.make.com/clientA");
  });

  it("falls back to the tenant-wide URL when no override exists", async () => {
    const url = await getRelayWebhookUrl("t1", "client-b");
    expect(url).toBe("https://hook.eu2.make.com/tenant");
  });

  it("falls back to the tenant-wide URL when the override is paused", async () => {
    db.make_relay_client_overrides = {
      encrypted_url: "enc:https://hook.eu2.make.com/clientA",
      enabled: false,
    };
    const url = await getRelayWebhookUrl("t1", "client-a");
    expect(url).toBe("https://hook.eu2.make.com/tenant");
  });

  it("falls back to the tenant-wide URL when no clientId is given", async () => {
    const url = await getRelayWebhookUrl("t1");
    expect(url).toBe("https://hook.eu2.make.com/tenant");
  });
});

describe("Make relay payload identity", () => {
  it("delivers clientId and clientName in the webhook payload", async () => {
    const res = await publishViaRelay({
      platform: "facebook",
      caption: "Hello",
      mediaUrls: [],
      scheduledAt: null,
      postPlatformId: "pp1",
      tenantId: "t1",
      clientId: "client-a",
      clientName: "Decore Hotels",
    });
    expect(res.status).toBe("published");
    expect(res.platformPostId).toBe("mk_1");
    expect(delivered.body).toMatchObject({
      platform: "facebook",
      clientId: "client-a",
      clientName: "Decore Hotels",
      postPlatformId: "pp1",
      tenantId: "t1",
    });
  });

  it("skips cleanly when neither override nor tenant URL exists", async () => {
    db.make_relay_config = null;
    const res = await publishViaRelay({
      platform: "instagram",
      caption: "Hi",
      mediaUrls: [],
      scheduledAt: null,
      postPlatformId: "pp2",
      tenantId: "t1",
      clientId: "client-a",
      clientName: null,
    });
    expect(res.status).toBe("skipped");
    expect(delivered.url).toBeUndefined();
  });
});
