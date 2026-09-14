import { describe, it, expect } from "vitest";
import {
  RETRY_BACKOFF_MINUTES,
  MAX_RETRIES,
  nextRetryAt,
} from "./retryFailedPublishes";

// The backoff ladder is the user-visible contract of self-healing: a failed
// publish retries after 5 min, then 30 min, then 2 h — and never again after
// that (escalation). processDueRetries() itself is an integration surface
// (DB + publishPost) covered by the live check; these pin the math and the
// escalation boundary.
describe("publish retry backoff", () => {
  it("uses a 5 min → 30 min → 2 h ladder", () => {
    expect(RETRY_BACKOFF_MINUTES).toEqual([5, 30, 120]);
    expect(MAX_RETRIES).toBe(3);
  });

  it("first retry is due 5 minutes after the original failure", () => {
    const failedAt = new Date("2026-10-01T09:00:00.000Z");
    // count = 0 completed retries → next is attempt 1 → +5 min
    expect(nextRetryAt(0, failedAt)).toBe("2026-10-01T09:05:00.000Z");
  });

  it("second retry waits 30 minutes, third waits 2 hours", () => {
    const at = new Date("2026-10-01T09:00:00.000Z");
    expect(nextRetryAt(1, at)).toBe("2026-10-01T09:30:00.000Z");
    expect(nextRetryAt(2, at)).toBe("2026-10-01T11:00:00.000Z");
  });

  it("clamps past the ladder instead of going negative or huge", () => {
    // A defensive count (>= MAX) still yields the last step, never undefined.
    const at = new Date("2026-10-01T09:00:00.000Z");
    expect(nextRetryAt(5, at)).toBe("2026-10-01T11:00:00.000Z");
  });
});
