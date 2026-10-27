/**
 * Minimal RFC 5545 ICS (iCalendar) builder for exporting scheduled posts.
 *
 * Constraints honored deliberately:
 *  - CRLF line endings and 75-char folding with a leading space on
 *    continuation lines (RFC 5545 §3.1).
 *  - Text escaping for backslash, semicolon, comma and newlines (§3.3.11).
 *  - All datetimes emitted in UTC ("Z" suffix) so calendar clients never
 *    re-interpret the viewer's offset.
 */

export interface IcsEvent {
  /** Stable identifier — for posts, `<id>@agency-os`. */
  uid: string;
  title: string;
  description?: string | null;
  /** Any ISO 8601 instant the platform's Date can parse (+offset or Z). */
  startIso: string;
}

function icsEscape(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n/g, "\\n")
    .replace(/\r|\n/g, "\\n");
}

/** RFC 5545 §3.1 folding: content lines SHOULD NOT exceed 75 chars. */
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let rest = line;
  while (rest.length > 75) {
    parts.push(rest.slice(0, 75));
    rest = " " + rest.slice(75);
  }
  parts.push(rest);
  return parts.join("\r\n");
}

/** 2026-12-15T15:00:00.000Z -> 20261215T150000Z */
function utcStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * Builds a complete VCALENDAR document. Zero-length events (DTSTART equals
 * DTEND) are intentional: a post's publish time is an instant, not a meeting.
 * `now` defaults to the current time and feeds every DTSTAMP; pass a fixed
 * Date in tests for deterministic output.
 */
export function buildIcs(
  calendarName: string,
  events: IcsEvent[],
  now: Date = new Date()
): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Agency OS//Content Calendar//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${icsEscape(calendarName)}`,
  ];
  const dtstamp = utcStamp(now);
  for (const ev of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${icsEscape(ev.uid)}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${utcStamp(new Date(ev.startIso))}`,
      `DTEND:${utcStamp(new Date(ev.startIso))}`,
      `SUMMARY:${icsEscape(ev.title)}`,
      "STATUS:CONFIRMED"
    );
    if (ev.description) {
      lines.push(`DESCRIPTION:${icsEscape(ev.description)}`);
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
