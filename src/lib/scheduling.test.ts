import { describe, expect, it } from "vitest";
import {
  normalizeScheduledAt,
  formatScheduledAtLocal,
} from "./scheduling";
import {
  LIFECYCLE_STEPS,
  STEP_IDS,
  stepIndexFor,
  nextStepAfter,
} from "./lifecycle-steps";

describe("normalizeScheduledAt", () => {
  it("passes through already-qualified ISO strings unchanged", () => {
    expect(normalizeScheduledAt("2026-08-10T20:30:00.000Z")).toBe(
      "2026-08-10T20:30:00.000Z"
    );
    expect(normalizeScheduledAt("2026-08-10T14:30:00-06:00")).toBe(
      "2026-08-10T20:30:00.000Z"
    );
  });

  it("converts a naive datetime-local value using the browser offset", () => {
    // 14:30 local in UTC-6 (offset +360) → 20:30 UTC
    expect(normalizeScheduledAt("2026-08-10T14:30", 360)).toBe(
      "2026-08-10T20:30:00.000Z"
    );
    // 14:30 local in UTC+2 (offset -120) → 12:30 UTC
    expect(normalizeScheduledAt("2026-08-10T14:30", -120)).toBe(
      "2026-08-10T12:30:00.000Z"
    );
  });

  it("defaults to 9:00 local when only a date is given", () => {
    expect(normalizeScheduledAt("2026-08-10", 360)).toBe(
      "2026-08-10T15:00:00.000Z"
    );
  });

  it("handles Date objects and epoch numbers", () => {
    const d = new Date("2026-08-10T20:30:00.000Z");
    expect(normalizeScheduledAt(d)).toBe("2026-08-10T20:30:00.000Z");
    expect(normalizeScheduledAt(d.getTime())).toBe("2026-08-10T20:30:00.000Z");
  });

  it("returns null for empty or unparseable input", () => {
    expect(normalizeScheduledAt(null)).toBeNull();
    expect(normalizeScheduledAt("")).toBeNull();
    expect(normalizeScheduledAt("not-a-date")).toBeNull();
    expect(normalizeScheduledAt(new Date("invalid"))).toBeNull();
  });
});

describe("formatScheduledAtLocal", () => {
  it("returns null for empty input", () => {
    expect(formatScheduledAtLocal(null)).toBeNull();
    expect(formatScheduledAtLocal("")).toBeNull();
  });
  it("formats a UTC ISO instant", () => {
    const out = formatScheduledAtLocal("2026-08-10T20:30:00.000Z");
    expect(out).toBeTruthy();
    expect(out).toContain("2026");
  });
});

describe("lifecycle step ordering", () => {
  it("exposes exactly six ordered steps", () => {
    expect(LIFECYCLE_STEPS.map((s) => s.id)).toEqual([
      "client_workspace",
      "connections",
      "brand_profile",
      "content_plan",
      "publish_targets",
      "go_live",
    ]);
  });

  it("resolves step ids to indexes", () => {
    expect(stepIndexFor("client_workspace")).toBe(0);
    expect(stepIndexFor("go_live")).toBe(5);
    expect(stepIndexFor("unknown")).toBe(0);
  });

  it("only ever advances one step at a time and clamps at the end", () => {
    expect(nextStepAfter(0)).toBe(1);
    expect(nextStepAfter(3)).toBe(4);
    expect(nextStepAfter(5)).toBe(5);
  });

  it("keeps STEP_IDS aligned with LIFECYCLE_STEPS", () => {
    expect(STEP_IDS).toEqual(LIFECYCLE_STEPS.map((s) => s.id));
  });
});
