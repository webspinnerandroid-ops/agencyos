import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import {
  verifyConnectSignature,
  buildProposalHtml,
  isDocuSignConfigured,
} from "./docusign";

describe("verifyConnectSignature", () => {
  const SECRET = "test-connect-secret";

  beforeEach(() => {
    process.env.DOCUSIGN_CONNECT_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.DOCUSIGN_CONNECT_SECRET;
  });

  it("accepts a valid HMAC signature", () => {
    const body = JSON.stringify({ event: "envelope-completed", data: {} });
    const sig = crypto.createHmac("sha256", SECRET).update(body).digest("base64");
    expect(verifyConnectSignature(body, [sig])).toBe(true);
  });

  it("rejects a tampered body", () => {
    const body = JSON.stringify({ event: "envelope-completed", data: {} });
    const sig = crypto
      .createHmac("sha256", SECRET)
      .update(body)
      .digest("base64");
    const tampered = body.replace("envelope-completed", "envelope-sent");
    expect(verifyConnectSignature(tampered, [sig])).toBe(false);
  });

  it("rejects when no secret is configured", () => {
    delete process.env.DOCUSIGN_CONNECT_SECRET;
    const body = "{}";
    const sig = crypto.createHmac("sha256", SECRET).update(body).digest("base64");
    expect(verifyConnectSignature(body, [sig])).toBe(false);
  });

  it("rejects when no signature headers are present", () => {
    const body = "{}";
    expect(verifyConnectSignature(body, [])).toBe(false);
  });

  it("accepts a signature delivered under a later header slot (-2)", () => {
    const body = "raw-payload";
    const sig = crypto.createHmac("sha256", SECRET).update(body).digest("base64");
    expect(verifyConnectSignature(body, [undefined, sig] as string[])).toBe(true);
  });
});

describe("isDocuSignConfigured", () => {
  afterEach(() => {
    delete process.env.DOCUSIGN_INTEGRATION_KEY;
    delete process.env.DOCUSIGN_USER_ID;
    delete process.env.DOCUSIGN_PRIVATE_KEY;
    delete process.env.DOCUSIGN_PRIVATE_KEY_BASE64;
  });

  it("is false with nothing set", () => {
    expect(isDocuSignConfigured()).toBe(false);
  });

  it("is true with integration key + user + private key", () => {
    process.env.DOCUSIGN_INTEGRATION_KEY = "ik";
    process.env.DOCUSIGN_USER_ID = "uid";
    process.env.DOCUSIGN_PRIVATE_KEY = "-----BEGIN RSA PRIVATE KEY-----";
    expect(isDocuSignConfigured()).toBe(true);
  });

  it("accepts the base64-encoded private key variant", () => {
    process.env.DOCUSIGN_INTEGRATION_KEY = "ik";
    process.env.DOCUSIGN_USER_ID = "uid";
    process.env.DOCUSIGN_PRIVATE_KEY_BASE64 = Buffer.from("key").toString("base64");
    expect(isDocuSignConfigured()).toBe(true);
  });

  it("is false when a piece is missing", () => {
    process.env.DOCUSIGN_INTEGRATION_KEY = "ik";
    expect(isDocuSignConfigured()).toBe(false);
  });
});

describe("buildProposalHtml", () => {
  const base = {
    title: "SEO Proposal — Bronze",
    tierName: "Bronze – Essentials",
    price: 1000,
    url: "https://example.com",
    location: "Toronto, Ontario, Canada",
    executiveSummary: "A 6-month plan to grow organic visibility.",
    keywords: [
      { keyword: "dentist toronto", searchVolume: 1200, difficulty: "medium", intent: "commercial" },
    ],
    deliverables: ["2 long-form blog posts per month"],
    calendar: [
      {
        month: 1,
        focusArea: "Foundation",
        pieces: [{ type: "blog_post", title: "Best Dentists in Toronto" }],
      },
    ],
    signerName: "Jane Client",
    signerEmail: "jane@example.com",
    preparedBy: "Agency OS",
  };

  it("renders the sign marker so the anchor tab can be placed", () => {
    const html = buildProposalHtml(base);
    expect(html).toContain("SIGN_HERE_MARKER");
  });

  it("includes location when provided", () => {
    const html = buildProposalHtml(base);
    expect(html).toContain("Toronto, Ontario, Canada");
  });

  it("escapes HTML in user-supplied text", () => {
    const html = buildProposalHtml({
      ...base,
      signerName: "<script>alert(1)</script>",
      executiveSummary: "Trust <b>us</b> & more",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Trust &lt;b&gt;us&lt;/b&gt; &amp; more");
  });

  it("renders a custom consult price when the tier has no price", () => {
    const html = buildProposalHtml({ ...base, price: null });
    expect(html).toContain("Custom Consult");
  });

  it("omits keyword/calendar sections when absent", () => {
    const html = buildProposalHtml({
      ...base,
      keywords: [],
      deliverables: [],
      calendar: [],
    });
    expect(html).toContain("Executive Summary");
    expect(html).not.toContain("Target Keywords");
    expect(html).not.toContain("Deliverables");
  });
});
