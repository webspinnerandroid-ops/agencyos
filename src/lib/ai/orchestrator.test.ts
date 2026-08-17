import { describe, expect, it } from "vitest";
import { fitFalImagePrompt } from "./orchestrator";

describe("fitFalImagePrompt", () => {
  it("returns short prompts unchanged", () => {
    const p = "A minimal logo for a coffee roaster";
    expect(fitFalImagePrompt(p)).toBe(p);
  });

  it("returns a prompt exactly at the limit unchanged", () => {
    const p = "x".repeat(1000);
    expect(fitFalImagePrompt(p)).toBe(p);
  });

  it("truncates a prompt over 1000 chars to exactly 1000", () => {
    const p = "BRAND DESIGN BRIEF\nBusiness: Agency OS.\n" + "y".repeat(2000);
    const out = fitFalImagePrompt(p);
    expect(out.length).toBeLessThanOrEqual(1000);
    expect(out).toContain("BRAND DESIGN BRIEF");
    expect(out).toContain("Agency OS");
  });

  it("trims trailing whitespace after truncation", () => {
    const p = "x".repeat(900) + " ".repeat(500) + "tail";
    const out = fitFalImagePrompt(p);
    expect(out.length).toBeLessThanOrEqual(1000);
    expect(out.endsWith(" ")).toBe(false);
    expect(out.endsWith("tail")).toBe(false); // trimEnd removed the padding after the slice
  });

  it("keeps the head of the brief so the user's direction survives", () => {
    const p = "Business: Acme Corp. Industry: SaaS. Audience: founders.\n" + "z".repeat(5000);
    const out = fitFalImagePrompt(p);
    expect(out.startsWith("Business: Acme Corp.")).toBe(true);
    expect(out).not.toContain("z".repeat(5000));
  });
});
