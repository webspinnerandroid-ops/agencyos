import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  holdExpiresAt,
  AUTO_PUBLISH_HOLD_MINUTES,
} from "./content-map-autopublish";

// The hold arithmetic is the user-visible contract of the undo window: arm
// time + exactly 15 minutes, computed on the server. processDueHolds() itself
// is an integration surface (DB + WP HTTP) covered by the live E2E check;
// these tests pin the pure logic.
describe("auto-publish hold", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("expires exactly 15 minutes after arming", () => {
    const arm = new Date("2026-10-01T09:00:00.000Z");
    expect(holdExpiresAt(arm)).toBe("2026-10-01T09:15:00.000Z");
  });

  it("uses the current time when no arm time is given", () => {
    vi.setSystemTime(new Date("2026-10-01T23:59:30.000Z"));
    expect(holdExpiresAt()).toBe("2026-10-02T00:14:30.000Z");
  });

  it("exposes a 15-minute window", () => {
    expect(AUTO_PUBLISH_HOLD_MINUTES).toBe(15);
  });
});
