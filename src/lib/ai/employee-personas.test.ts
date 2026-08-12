import { describe, it, expect } from "vitest";
import {
  EMPLOYEE_PERSONAS,
  buildEmployeeSystemPrompt,
} from "./employee-personas";

describe("employee personas", () => {
  it("has a persona for every hired employee key", () => {
    const keys = [
      "penny", "eva", "sonny", "stan", "rachel", "scout",
      "dev", "gauge", "nina", "juno", "linda",
    ];
    for (const key of keys) {
      expect(EMPLOYEE_PERSONAS[key], key).toBeDefined();
    }
  });

  it("every persona has the core expert sections", () => {
    for (const [key, p] of Object.entries(EMPLOYEE_PERSONAS)) {
      expect(p.rules.length, `${key} rules`).toBeGreaterThan(0);
      expect(p.outputContract.length, `${key} output contract`).toBeGreaterThan(0);
      expect(p.grounding.length, `${key} grounding`).toBeGreaterThan(0);
      expect(p.guardrails.length, `${key} guardrails`).toBeGreaterThan(0);
    }
  });

  it("includes the anti-fabrication guardrail in persona prompts", () => {
    const prompt = buildEmployeeSystemPrompt("penny");
    expect(prompt).toContain("Never invent statistics");
    const gaugePrompt = buildEmployeeSystemPrompt("gauge");
    expect(gaugePrompt).toContain("estimate");
  });

  it("merges custom instructions, guidelines, and assets as overrides", () => {
    const prompt = buildEmployeeSystemPrompt("penny", {
      customInstructions: "ALWAYS write in British English.",
      guidelines: "Two rounds of review before delivery.",
      assets: "See style-guide.pdf for tone.",
      workspaceContext: "Client: Coal Creek; voice: warm, direct.",
      clientName: "Coal Creek",
    });
    expect(prompt).toContain("Cheryl");
    expect(prompt).toContain("ALWAYS write in British English.");
    expect(prompt).toContain("Two rounds of review before delivery.");
    expect(prompt).toContain("style-guide.pdf");
    expect(prompt).toContain("Coal Creek");
    // Tenant overrides appear after the default rules.
    expect(prompt.indexOf("ALWAYS write")).toBeGreaterThan(
      prompt.indexOf("## Non-negotiable rules")
    );
  });

  it("falls back to a generic persona for unknown keys", () => {
    const prompt = buildEmployeeSystemPrompt("unknown_key");
    expect(prompt).toContain("Agency Team Member");
    expect(prompt).toContain("Never fabricate");
  });
});
