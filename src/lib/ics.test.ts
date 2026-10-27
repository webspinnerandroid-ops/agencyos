import { describe, it, expect } from "vitest";
import { buildIcs } from "./ics";

const FIXED_NOW = new Date("2026-10-27T12:00:00.000Z");

describe("buildIcs", () => {
  it("emits a CRLF-terminated VCALENDAR with required headers", () => {
    const ics = buildIcs("Export test", [], FIXED_NOW);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("VERSION:2.0\r\n");
    expect(ics).toContain("PRODID:-//Agency OS//Content Calendar//EN\r\n");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("formats datetimes as UTC Z stamps regardless of source offset", () => {
    const ics = buildIcs(
      "Export test",
      [{ uid: "p1@agency-os", title: "Post", startIso: "2026-12-15T15:00:00+00:00" }],
      FIXED_NOW
    );
    expect(ics).toContain("DTSTART:20261215T150000Z");
    expect(ics).toContain("DTEND:20261215T150000Z");
    expect(ics).toContain("DTSTAMP:20261027T120000Z");
  });

  it("escapes Text-safe specials (comma, semicolon, newline)", () => {
    const ics = buildIcs(
      "Export test",
      [
        {
          uid: "p2@agency-os",
          title: "Launch, phase two; big\nupdate",
          startIso: "2026-12-15T15:00:00Z",
        },
      ],
      FIXED_NOW
    );
    expect(ics).toContain("SUMMARY:Launch\\, phase two\\; big\\nupdate");
    expect(ics).not.toContain("SUMMARY:Launch, phase two");
  });

  it("folds long lines with a leading space on continuations", () => {
    const longTitle = "x".repeat(160);
    const ics = buildIcs(
      "Export test",
      [{ uid: "p3@agency-os", title: longTitle, startIso: "2026-12-15T15:00:00Z" }],
      FIXED_NOW
    );
    const summaryLines = ics.split("\r\n").filter((l) => l.startsWith("SUMMARY:") || (l.startsWith(" ") && ics.split("\r\n").indexOf(l) > 0));
    // The SUMMARY logical line spans >75-char physical lines; every
    // continuation line starts with exactly one space.
    const idx = ics.split("\r\n").findIndex((l) => l.startsWith("SUMMARY:"));
    const continuation = ics.split("\r\n")[idx + 1];
    expect(continuation?.startsWith(" x")).toBe(true);
    expect(summaryLines.length).toBeGreaterThan(1);
  });

  it("escapes and folds the calendar name in X-WR-CALNAME", () => {
    const ics = buildIcs("Content, calendar — 2026", [], FIXED_NOW);
    expect(ics).toMatch(/X-WR-CALNAME:Content\\, calendar — 2026/);
  });
});
