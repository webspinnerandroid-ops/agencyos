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

/**
 * RFC 5545 §3.1 folding: content lines SHOULD NOT exceed 75 octets, and a
 * fold must never split a multi-octet sequence. We therefore fold on UTF-8
 * octets and iterate by code point, so a surrogate pair (e.g. an emoji at
 * the fold boundary) can never be torn in half — that would be byte-level
 * corruption a strict calendar importer (Google) renders as U+FFFD.
 *
 * Octet counting must be plain JS, not Buffer.byteLength: this module runs
 * inside the calendar's client component, where node Buffer does not exist.
 */
function utf8Octets(line: string): number {
  let n = 0;
  for (let i = 0; i < line.length; ) {
    const c = line.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < line.length) {
      const c2 = line.charCodeAt(i + 1);
      if (c2 >= 0xdc00 && c2 <= 0xdfff) {
        n += 4; // astral code point
        i += 2;
        continue;
      }
    }
    n += c <= 0x7f ? 1 : c <= 0x7ff ? 2 : 3; // lone surrogates encode as 3
    i += 1;
  }
  return n;
}

function foldLine(line: string): string {
  if (utf8Octets(line) <= 75) return line;
  const parts: string[] = [];
  let rest = line;
  while (utf8Octets(rest) > 75) {
    // Iterate by code point: `ch` is always a whole grapheme unit, so astral
    // pairs are consumed atomically. Continuation lines carry the RFC-mandated
    // leading space, which counts toward the next line's 75-octet budget.
    let cut = 0;
    let used = 0;
    for (const ch of rest) {
      const cp = ch.codePointAt(0)!;
      const o = cp >= 0x10000 ? 4 : cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : 3; // astral pairs = 4 octets
      if (used + o > 75) break;
      used += o;
      cut += ch.length;
    }
    if (cut === 0) break; // single code point over budget cannot happen for valid text
    parts.push(rest.slice(0, cut));
    rest = " " + rest.slice(cut);
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
