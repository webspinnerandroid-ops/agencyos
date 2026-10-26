/**
 * Scheduling helpers — normalize a naive `datetime-local` picker value
 * (e.g. "2026-08-10T14:30", no timezone) into a UTC ISO string using the
 * browser's timezone offset. Without this, "14:30" gets interpreted in the
 * server's local time, and the Inngest cron (which compares against UTC)
 * fires scheduled posts hours early or late.
 */

/**
 * Convert a naive local datetime string + the client's UTC offset (minutes,
 * as reported by `new Date().getTimezoneOffset()` — positive when the client
 * is behind UTC) into a UTC ISO timestamp.
 *
 * Accepts:
 *  - "2026-08-10T14:30" (datetime-local) — treated as local wall time
 *  - "2026-08-10T14:30:00.000Z" or any ISO with an offset — returned as-is
 *  - Date objects / epoch numbers — converted directly
 *
 * Returns the UTC ISO string, or null when the input is unparseable.
 */
export function normalizeScheduledAt(
  scheduledAt: string | number | Date | null | undefined,
  tzOffsetMinutes?: number | null
): string | null {
  if (scheduledAt == null || scheduledAt === "") return null;
  if (scheduledAt instanceof Date) {
    if (Number.isNaN(scheduledAt.getTime())) return null;
    return scheduledAt.toISOString();
  }
  if (typeof scheduledAt === "number") {
    if (!Number.isFinite(scheduledAt)) return null;
    return new Date(scheduledAt).toISOString();
  }

  const raw = String(scheduledAt).trim();
  if (!raw) return null;

  // Already timezone-qualified (ends with Z or ±HH:MM) — parse as-is.
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(raw)) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  // Naive local string — combine with the client offset.
  const match = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (!match) {
    // Fall back to Date parsing (server-local interpretation) as a last
    // resort so a malformed value never crashes the caller.
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = match[4] ? Number(match[4]) : 9; // default 9:00 local
  const minute = match[5] ? Number(match[5]) : 0;
  const second = match[6] ? Number(match[6]) : 0;

  // tzOffsetMinutes: minutes behind UTC (getTimezoneOffset). UTC = local + offset.
  const offset = typeof tzOffsetMinutes === "number" && Number.isFinite(tzOffsetMinutes)
    ? tzOffsetMinutes
    : 0;
  const utcMs =
    Date.UTC(year, month - 1, day, hour, minute, second) + offset * 60_000;

  return new Date(utcMs).toISOString();
}

/**
 * The browser's UTC offset (same sign convention as getTimezoneOffset —
 * positive when the client is behind UTC) **in force at a given naive local
 * wall-clock time**, not at "now".
 *
 * Why this exists: a slot picked from a `datetime-local` input must be stored
 * with the offset that applies on that date. Using `new Date()`'s offset means
 * a December slot scheduled from a summer session (or vice versa) is stored an
 * hour off wherever the agency observes DST.
 *
 * Falls back to the current offset when the input cannot be parsed.
 */
export function offsetMinutesForLocalDateTime(
  local: string | null | undefined
): number {
  const fallback = new Date().getTimezoneOffset();
  if (!local) return fallback;
  const match = String(local)
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) return fallback;

  // Constructing through the local-time Date constructor asks the runtime for
  // the offset in force at that instant, DST included.
  const at = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    match[4] ? Number(match[4]) : 9, // same 9:00 default as normalizeScheduledAt
    match[5] ? Number(match[5]) : 0,
    match[6] ? Number(match[6]) : 0
  );
  return Number.isNaN(at.getTime()) ? fallback : at.getTimezoneOffset();
}

/**
 * Describe a UTC ISO timestamp in the client's local timezone for display.
 * Returns a localized string like "Aug 10, 2026, 2:30 PM" or null.
 */
export function formatScheduledAtLocal(
  iso: string | null | undefined,
  tzOffsetMinutes?: number | null
): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  if (typeof tzOffsetMinutes === "number" && Number.isFinite(tzOffsetMinutes)) {
    d.setTime(d.getTime() - tzOffsetMinutes * 60_000);
  }
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
