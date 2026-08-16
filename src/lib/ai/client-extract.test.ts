import { describe, expect, it } from "vitest";
import { extractClientFromMessage } from "./client-extract";

describe("extractClientFromMessage", () => {
  it("extracts the client name and website from an onboarding message", () => {
    const r = extractClientFromMessage(
      "I am onboarding a new client, the company is Acme Roasters at acmeroasters.com. Please run the full onboarding step by step."
    );
    expect(r.name).toBe("Acme Roasters");
    expect(r.website).toBe("acmeroasters.com");
  });

  it("handles 'client is called <name>'", () => {
    const r = extractClientFromMessage("the client is called Bob's Burgers");
    expect(r.name).toBe("Bob's Burgers");
  });

  it("handles 'new client <name>'", () => {
    expect(extractClientFromMessage("new client Acme Roasters").name).toBe(
      "Acme Roasters"
    );
  });

  it("handles 'client name is <name>' with an ampersand", () => {
    expect(extractClientFromMessage("client name is Johnson & Johnson").name).toBe(
      "Johnson & Johnson"
    );
  });

  it("handles hyphenated company names", () => {
    expect(extractClientFromMessage("client is Mega-Corp").name).toBe("Mega-Corp");
  });

  it("returns null (no name) but keeps the website when only a domain is given", () => {
    const r = extractClientFromMessage(
      "bringing on a new client, they are at giantbyte.com"
    );
    expect(r.name).toBeNull();
    expect(r.website).toBe("giantbyte.com");
  });

  it("never emits 'campaign' as a client name", () => {
    const r = extractClientFromMessage("client is the new campaign");
    expect(r.name).toBeNull();
  });

  it("extracts the name after 'onboarding <name>' without a company keyword", () => {
    const r = extractClientFromMessage(
      "I am onboarding Acme Roasters at acmeroasters.com — a coffee roastery. Let's set up their full campaign."
    );
    expect(r.name).toBe("Acme Roasters");
    expect(r.website).toBe("acmeroasters.com");
  });

  it("does not emit 'new client' as a name after 'onboarding'", () => {
    const r = extractClientFromMessage(
      "onboarding a new client at giantbyte.com, they sell software"
    );
    expect(r.name).toBeNull();
    expect(r.website).toBe("giantbyte.com");
  });
});
