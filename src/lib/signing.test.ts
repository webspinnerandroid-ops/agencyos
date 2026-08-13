import { describe, it, expect } from "vitest";
import {
  newSignToken,
  signUrlForToken,
  buildSignedAgreementHtml,
  SIGNING_TERMS,
} from "./signing";

describe("signing lib", () => {
  it("generates unique, URL-safe tokens", () => {
    const a = newSignToken();
    const b = newSignToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(24);
  });

  it("builds signing URLs from tokens", () => {
    const url = signUrlForToken("abc123");
    expect(url).toMatch(/\/sign\/abc123$/);
  });

  it("builds a signed agreement HTML with terms, signature, and timestamp", () => {
    const html = buildSignedAgreementHtml({
      tierName: "Growth Plan",
      price: 1500,
      url: "https://example.com",
      location: "Toronto, ON",
      executiveSummary: "A six-month SEO program.",
      signerName: "Jane Client",
      signerEmail: "jane@example.com",
      signatureDataUrl: "data:image/png;base64,AAAA",
      signatureType: "drawn",
      signedAt: "2026-08-13T12:00:00Z",
      ipAddress: "203.0.113.7",
    });

    expect(html).toContain("SIGNED AGREEMENT");
    expect(html).toContain("Growth Plan");
    expect(html).toContain("$1,500/month");
    expect(html).toContain("Jane Client");
    expect(html).toContain("jane@example.com");
    expect(html).toContain("data:image/png;base64,AAAA");
    expect(html).toContain("203.0.113.7");
    expect(html).toContain("60 days");
    expect(html).toContain(SIGNING_TERMS[0].heading);
  });

  it("renders a typed signature as a name, not an image", () => {
    const html = buildSignedAgreementHtml({
      tierName: "Starter",
      price: null,
      url: "https://example.com",
      location: null,
      executiveSummary: "",
      signerName: "Bob Client",
      signerEmail: "bob@example.com",
      signatureDataUrl: null,
      signatureType: "typed",
      signedAt: "2026-08-13T12:00:00Z",
      ipAddress: null,
    });

    expect(html).toContain("Bob Client");
    expect(html).not.toContain("<img");
    expect(html).toContain("Signature type: typed");
  });

  it("covers the agreed cancellation/TOS clauses", () => {
    const joined = SIGNING_TERMS.map((t) => t.heading).join(" ");
    expect(joined).toContain("Term & Cancellation");
    expect(SIGNING_TERMS).toHaveLength(10);
  });
});
