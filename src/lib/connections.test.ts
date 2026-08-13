import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  decodeTokenBundle,
  encodeTokenBundle,
  buildGoogleAuthUrl,
  PROVIDER_SCOPES,
  exchangeGoogleCode,
  listGA4Properties,
  listSearchConsoleSites,
} from "./connections";

beforeEach(() => {
  process.env.ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
  process.env.NEXT_PUBLIC_SITE_URL = "https://platform.example.com";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("token encryption round-trip", () => {
  it("encrypts at rest (ciphertext differs from plaintext) and decrypts back", () => {
    const bundle = {
      access_token: "ya29.abc123",
      refresh_token: "1//xyz",
      expires_at: 1234567890,
    };
    const encrypted = encodeTokenBundle(bundle);
    expect(encrypted).not.toContain("ya29.abc123");
    expect(encrypted).not.toContain("refresh_token");
    expect(decodeTokenBundle(encrypted)).toEqual(bundle);
  });
});

describe("buildGoogleAuthUrl", () => {
  it("uses the right scope per provider and includes offline consent", () => {
    const ga4 = buildGoogleAuthUrl("google_analytics", "state-1");
    const sc = buildGoogleAuthUrl("search_console", "state-2");
    expect(ga4).toContain(encodeURIComponent(PROVIDER_SCOPES.google_analytics));
    expect(sc).toContain(encodeURIComponent(PROVIDER_SCOPES.search_console));
    expect(ga4).toContain("access_type=offline");
    expect(ga4).toContain("prompt=consent");
    expect(ga4).toContain("redirect_uri=" + encodeURIComponent("https://platform.example.com/api/auth/callback/google"));
    expect(ga4).toContain("state=state-1");
    // Search Console must NOT get analytics scope and vice versa.
    expect(sc).not.toContain(encodeURIComponent(PROVIDER_SCOPES.google_analytics));
    expect(ga4).not.toContain(encodeURIComponent(PROVIDER_SCOPES.search_console));
  });
});

describe("exchangeGoogleCode", () => {
  it("posts the authorization code and returns a token bundle", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "ya29.new",
        refresh_token: "1//fresh",
        expires_in: 3600,
        scope: "https://www.googleapis.com/auth/analytics.readonly",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const tokens = await exchangeGoogleCode("the-code");
    expect(tokens.access_token).toBe("ya29.new");
    expect(tokens.refresh_token).toBe("1//fresh");
    expect(tokens.scope).toContain("analytics.readonly");
    const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect(body.get("code")).toBe("the-code");
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("client_id")).toBe("test-client-id");
  });

  it("throws a readable error on a failed exchange", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "invalid_grant", error_description: "Code expired" }),
    }));
    await expect(exchangeGoogleCode("bad")).rejects.toThrow("Code expired");
  });
});

describe("resource listing", () => {
  it("flattens GA4 account summaries into properties", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        accountSummaries: [
          {
            name: "accounts/123",
            displayName: "Acme Agency",
            propertySummaries: [
              { property: "properties/111", displayName: "Client A Site" },
              { property: "properties/222", displayName: "Client B Blog" },
            ],
          },
          { name: "accounts/999", displayName: "Other" },
        ],
      }),
    }));
    const props = await listGA4Properties("token");
    expect(props).toEqual([
      { propertyId: "111", displayName: "Client A Site", accountName: "Acme Agency" },
      { propertyId: "222", displayName: "Client B Blog", accountName: "Acme Agency" },
    ]);
  });

  it("lists Search Console sites", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        siteEntry: [
          { siteUrl: "sc-domain:acme.com", permissionLevel: "siteFullUser" },
          { siteUrl: "https://blog.acme.com/", permissionLevel: "siteRestrictedUser" },
        ],
      }),
    }));
    const sites = await listSearchConsoleSites("token");
    expect(sites).toHaveLength(2);
    expect(sites[0].siteUrl).toBe("sc-domain:acme.com");
  });

  it("surfaces Google API errors with the message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: "Request had insufficient authentication scopes." } }),
    }));
    await expect(listGA4Properties("token")).rejects.toThrow("insufficient authentication scopes");
  });
});
