import { describe, it, expect } from "vitest";
import {
  EVAL_SAMPLES,
  EVAL_ROLES,
  evalTeam,
  scoreEmployeeOutput,
} from "./eval";

describe("ai team eval loop", () => {
  it("has criteria for every employee in the persona catalog", () => {
    // Every persona key should have a criteria set so no employee is
    // unmeasured. (Some personas share pipelines, but each has rules.)
    const keys = [
      "penny",
      "eva",
      "sonny",
      "stan",
      "rachel",
      "scout",
      "dev",
      "gauge",
      "nina",
      "juno",
      "linda",
    ];
    for (const k of keys) {
      expect(EVAL_ROLES, `missing eval criteria for ${k}`).toContain(k);
    }
  });

  it("good samples pass every criterion", () => {
    for (const [role, sample] of Object.entries(EVAL_SAMPLES)) {
      const res = scoreEmployeeOutput(role, sample.good, {
        keyword: "friendship",
        platform: "instagram",
        today: "2026-08-12",
        internalUrls: ["/site/about"],
      });
      expect(
        res.verdict,
        `${role}: expected pass, got ${res.passed}/${res.total}: ` +
          res.criteria.filter((c) => !c.passed).map((c) => c.name).join(", ")
      ).toBe("pass");
    }
  });

  it("bad samples fail at least one criterion", () => {
    for (const [role, sample] of Object.entries(EVAL_SAMPLES)) {
      const res = scoreEmployeeOutput(role, sample.bad, {
        keyword: "friendship",
        platform: "instagram",
        today: "2026-08-12",
        internalUrls: ["/site/about"],
      });
      expect(
        res.verdict,
        `${role}: bad sample must not pass (got ${res.passed}/${res.total})`
      ).not.toBe("pass");
    }
  });

  it("evalTeam scores a whole crew at once", () => {
    const results = evalTeam({
      penny: EVAL_SAMPLES.penny.good,
      sonny: EVAL_SAMPLES.sonny.bad,
      nina: EVAL_SAMPLES.nina.good,
    });
    expect(results.penny.verdict).toBe("pass");
    expect(results.sonny.verdict).not.toBe("pass");
    expect(results.nina.verdict).toBe("pass");
  });

  it("Brett's chat-vs-phone regression is caught", () => {
    // The known bug: Brett opening a chat message with the phone greeting.
    const res = scoreEmployeeOutput("rachel", EVAL_SAMPLES.rachel.bad);
    const greeting = res.criteria.find((c) => c.name === "No phone script in chat");
    expect(greeting?.passed).toBe(false);
  });
});
