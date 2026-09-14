/**
 * Content Map CSV import — parsing + row mapping.
 *
 * Pure functions, no I/O, so the API route stays thin and the rules are
 * unit-testable. The expected columns (header names are matched
 * case/space/underscore-insensitively; extra columns are ignored):
 *
 *   Title*         — the post title (falls back to Topic when absent)
 *   Keywords       — comma-separated; the FIRST keyword is the FOCUS keyword
 *   Topic*         — what the content is about (falls back to Title when absent)
 *   Type           — "blog" or "social" (default: blog)
 *   Platforms      — comma-separated social platforms (ignored for blog rows)
 *   Destination    — accepted as an alias of Platforms (the destination(s)
 *                    the post is bound for). Also optional.
 *   External Links — comma-separated source URLs to cite (OPTIONAL). When
 *                    absent, the row simply generates without preferred
 *                    sources — that is not an error. Malformed entries are
 *                    dropped with a note; valid ones are kept.
 *   Publish Date   — suggested publish date/time for the piece (OPTIONAL).
 *                    Accepts ISO dates or common spreadsheet formats; lands
 *                    on the map row and later on the draft. Unparseable
 *                    values import fine with a note — never an error.
 *
 * Title and Topic back each other up: a row needs at least one of them.
 * Internal links are NOT a CSV column — they come from the workspace
 * knowledge base (the client's site, uploaded/crawled there) and are
 * attached automatically at generation time when available.
 *
 * The output rows carry `importNote` warnings for soft issues (missing
 * keywords, unknown type/platform values) so the UI can show exactly what
 * was auto-corrected instead of silently guessing.
 */

export const CONTENT_TYPE_BLOG = "blog";
export const CONTENT_TYPE_SOCIAL = "social";

export const KNOWN_PLATFORMS = [
  "instagram",
  "twitter",
  "linkedin",
  "facebook",
  "tiktok",
  "threads",
] as const;

export interface ParsedCsvCell {
  value: string;
}

export interface CsvParseResult {
  header: string[];
  rows: string[][];
}

/**
 * RFC-4180-style CSV split: quoted fields may contain commas, escaped
 * double-quotes ("" → "), and newlines. CRLF and CR line endings handled.
 */
export function parseCsv(text: string): CsvParseResult {
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const s = text.replace(/^\uFEFF/, ""); // strip BOM

  while (i < s.length) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (ch === "\r") {
      if (s[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      records.push(row);
      row = [];
      i += 1;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      field = "";
      records.push(row);
      row = [];
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  // Final field/record (no trailing newline).
  if (field !== "" || row.length > 0) {
    row.push(field);
    records.push(row);
  }

  // Drop fully-empty trailing records (blank lines anywhere).
  const nonEmpty = records.filter((r) => r.some((c) => c.trim() !== ""));
  const [header = [], ...rest] = nonEmpty;
  return { header, rows: rest };
}

/**
 * Parse a suggested publish date from a CSV cell. Returns an ISO string
 * (UTC) or null when unparseable — never throws, since an unreadable date is
 * a note, not an import failure.
 *
 * Accepted: ISO (2026-05-01, 2026-05-01T14:30:00), M/D/YYYY with optional
 * h:mm AM/PM, and anything `new Date()` can read (1 May 2026, May 1, 2026).
 * All times are interpreted as the user's LOCAL wall time (what a human
 * means by "9:00" in a spreadsheet), then stored as UTC. Month/day values
 * are validated strictly — JS Date would otherwise silently roll "13/13"
 * into the next year.
 */
export function parsePublishDate(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;

  const valid = (dt: Date, y: number, mo: number, d: number): boolean =>
    !isNaN(dt.getTime()) &&
    mo >= 1 && mo <= 12 && d >= 1 && d <= 31 &&
    dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;

  // ISO: 2026-05-01 or 2026-05-01T14:30[:00] — local wall time.
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(value);
  if (iso) {
    const [, y, m, d, hh = "00", mm = "00", ss = "00"] = iso;
    const dt = new Date(
      Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss)
    );
    return valid(dt, Number(y), Number(m), Number(d)) ? dt.toISOString() : null;
  }

  // M/D/YYYY (US spreadsheet default) with optional h:mm AM/PM time.
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM))?$/i.exec(value);
  if (us) {
    const [, mo, d, y, hh12, mm = "00", ampm] = us;
    let hh = Number(hh12 ?? "0");
    if (ampm) {
      const pm = ampm.toUpperCase() === "PM";
      if (pm && hh < 12) hh += 12;
      if (!pm && hh === 12) hh = 0;
    }
    const dt = new Date(Number(y), Number(mo) - 1, Number(d), hh, Number(mm));
    return valid(dt, Number(y), Number(mo), Number(d)) ? dt.toISOString() : null;
  }

  // Fallback: "1 May 2026", "May 1, 2026", etc. — whatever the runtime can
  // read, in the local timezone. Invalid dates (NaN) return null.
  const fallback = new Date(value);
  return isNaN(fallback.getTime()) ? null : fallback.toISOString();
}

/** Case/space/underscore-insensitive header matcher: "Focus Keyword" ≈ "focus_keyword". */
function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

/**
 * A "placeholder" title names a content CATEGORY, not a topic — calendar
 * templates are full of them: "Blog Promotion", "Property Highlight",
 * "GBP Post", "Local Attraction". Generating a gated blog from these
 * produces generic junk.
 *
 * Exported so the batch runner can recognize placeholder rows at GENERATION
 * time too (rows imported before the guard existed, or re-activated): the
 * runner expands them into a real topic via the model instead of generating
 * from the category name (see content-map-batch.ts).
 */
export const GENERIC_TITLE_PATTERN =
  /^(blog|social|gbp|google business profile?|property|local attraction|guest experience|staff|industry|community|call to action|cta|behind the scenes|event|holiday|seasonal|testimonials?|promotion|announcement)( (post|promotion|update|content|highlight|spotlight|insight|story|moment|review|message)s?)?$/i;

export function isPlaceholderTitle(title: string): boolean {
  return GENERIC_TITLE_PATTERN.test(title.trim());
}

export interface MappedRow {
  rowNumber: number;
  title: string;
  /** keywords[0] is the FOCUS keyword. */
  keywords: string[];
  topic: string;
  contentType: "blog" | "social";
  platforms: string[];
  /** Preferred external sources to cite. Empty = none provided (fine). */
  externalLinks: string[];
  /** Suggested publish date (ISO) from the CSV. Null = none provided. */
  scheduledAt: string | null;
  /** Automation target (CSV "Auto Publish" column). Null = manual draft. */
  autoPublish: "wordpress" | null;
  /** Soft warnings: what was auto-corrected or defaulted for this row. */
  importNote: string | null;
}

export interface MapRowsResult {
  rows: MappedRow[];
  /** Rows skipped entirely, with the reason (no title AND no topic). */
  skipped: { rowNumber: number; reason: string }[];
}

/**
 * Parse the incoming keywords cell. Splits on commas, trims, drops empties.
 * An explicit "keywords" column carries the focus keyword first; a separate
 * "Focus Keyword" column (if present) is PREPENDED so it always wins.
 */
function splitKeywords(raw: string): string[] {
  return raw
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

/**
 * Parse an External Links cell: comma- or semicolon-separated URLs. Entries
 * that look like URLs (http(s)://…, or bare www./domain.tld) are kept and
 * normalized to https://…; anything else is dropped with a note. An absent
 * or empty cell returns [] — no note, no error (links are optional).
 */
export function splitExternalLinks(raw: string): { urls: string[]; dropped: string[] } {
  const entries = raw
    .split(/[,;]/)
    .map((u) => u.trim())
    .filter(Boolean);
  if (entries.length === 0) return { urls: [], dropped: [] };

  const urls: string[] = [];
  const dropped: string[] = [];
  for (const entry of entries) {
    const candidate = /^https?:\/\//i.test(entry)
      ? entry
      : /^(www\.|[a-z0-9-]+\.[a-z]{2,})/i.test(entry)
        ? `https://${entry}`
        : null;
    if (!candidate) {
      dropped.push(entry);
      continue;
    }
    try {
      const parsed = new URL(candidate);
      // Reject obviously broken forms (spaces, no host).
      if (!parsed.hostname.includes(".") || /\s/.test(candidate.replace(/^https?:\/\//, ""))) {
        dropped.push(entry);
        continue;
      }
      urls.push(parsed.href.replace(/\/$/, ""));
    } catch {
      dropped.push(entry);
    }
  }
  return { urls, dropped };
}

export function mapCsvRows(parse: CsvParseResult): MapRowsResult {
  const idx = new Map<string, number>();
  parse.header.forEach((h, i) => {
    const key = normalizeHeader(h);
    // First occurrence wins for duplicate headers.
    if (!idx.has(key)) idx.set(key, i);
  });

  const col = (name: string): number => idx.get(name) ?? -1;
  const titleCol = col("title");
  const keywordsCol = col("keywords");
  const focusCol = col("focuskeyword");
  const topicCol = col("topic");
  const typeCol = col("type");
  // "Destination" is an alias of Platforms: the destination(s) the post is
  // bound for. When both columns exist, Platforms wins (they're merged).
  const platformsCol = col("platforms");
  const destinationCol = col("destination");
  const externalLinksCol = col("externallinks");
  // Optional automation column: "wordpress" tells the pipeline to auto-
  // approve the row's gate-cleared draft and schedule it to the connected
  // WordPress sites for the row's publish date. Absent/other = manual.
  const autoPublishCol = col("autopublish");
  // Calendar exports name this column all sorts of ways — accept the
  // sensible aliases (first match wins, matching Platforms' behavior).
  const publishDateCol = [
    "publishdate",
    "date",
    "scheduleddate",
    "scheduledat",
    "publishat",
    "scheduledfor",
    "postdate",
  ].map(col).find((i) => i >= 0) ?? -1;

  const rows: MappedRow[] = [];
  const skipped: { rowNumber: number; reason: string }[] = [];
  const isPlaceholder = (title: string, keywords: string[]): boolean => {
    if (keywords.length > 0) return false; // real direction given — never a placeholder
    return isPlaceholderTitle(title);
  };

  parse.rows.forEach((cells, i) => {
    const rowNumber = i + 1; // 1-based data-row number (excluding header)
    const at = (c: number) => (c >= 0 ? (cells[c] ?? "").trim() : "");

    const title = at(titleCol);
    const topic = at(topicCol);
    if (!title && !topic) {
      skipped.push({ rowNumber, reason: "Row has neither a Title nor a Topic" });
      return;
    }

    const notes: string[] = [];

    // Keywords: optional Focus Keyword column first, then the Keywords list.
    let keywords = splitKeywords(at(keywordsCol));
    const focus = splitKeywords(at(focusCol))[0];
    if (focus) keywords = [focus, ...keywords.filter((k) => k !== focus)];

    // Placeholder guard BEFORE the no-keywords note (a skipped placeholder
    // doesn't need cosmetic notes — the skip reason says it all).
    const effectiveTitle = title || topic;
    if (isPlaceholder(effectiveTitle, keywords)) {
      skipped.push({
        rowNumber,
        reason: `Placeholder row ("${effectiveTitle}" with no keywords) — name the actual topic in the Title/Topic column to import it`,
      });
      return;
    }

    if (keywords.length === 0) {
      notes.push("no keywords — the topic's main phrase becomes the focus keyword");
    }

    // Type: blog (default) or social.
    const rawType = at(typeCol).toLowerCase();
    let contentType: MappedRow["contentType"] = CONTENT_TYPE_BLOG;
    if (rawType) {
      if (rawType.includes("social")) {
        contentType = CONTENT_TYPE_SOCIAL;
      } else if (!rawType.includes("blog") && !rawType.includes("article")) {
        notes.push(`unknown type "${rawType}" — treated as blog`);
      }
    }

    // Platforms/Destination (only meaningful for social rows). Both column
    // names are accepted and merged; duplicates are dropped.
    const rawPlatforms = `${at(platformsCol)},${at(destinationCol)}`
      .split(",")
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean);
    let platforms = [...new Set(rawPlatforms)];
    if (platforms.length > 0) {
      const known = new Set<string>(KNOWN_PLATFORMS);
      const valid = platforms.filter((p) => known.has(p));
      const dropped = platforms.filter((p) => !known.has(p));
      if (dropped.length > 0) {
        notes.push(`unknown platform(s) dropped: ${dropped.join(", ")}`);
      }
      platforms = valid;
    }
    if (contentType === CONTENT_TYPE_SOCIAL && platforms.length === 0) {
      platforms = ["instagram"];
      notes.push("no platforms for a social row — defaulted to instagram");
    }
    if (contentType === CONTENT_TYPE_BLOG && platforms.length > 0) {
      notes.push("platforms on a blog row also generate matching social captions");
    }

    // External sources: optional. Provided URLs are cited; junk entries are
    // dropped with a note; an empty cell is silently fine.
    const { urls: externalLinks, dropped: droppedLinks } = splitExternalLinks(
      at(externalLinksCol)
    );
    if (droppedLinks.length > 0) {
      notes.push(`invalid external link(s) dropped: ${droppedLinks.join(", ")}`);
    }
    const cappedLinks = externalLinks.slice(0, 5);
    if (externalLinks.length > cappedLinks.length) {
      notes.push(`more than 5 external links — using the first 5`);
    }

    // Suggested publish date: OPTIONAL. The CSV's suggested date/time for
    // this piece — it lands on the map row and, after generation, on the
    // draft as the suggested publish time (the draft still goes through the
    // normal approval flow before it actually publishes). Unparseable values
    // get a note and no schedule — never an error; the row still imports and
    // generates.
    let scheduledAt: string | null = null;
    const rawDate = at(publishDateCol);
    if (rawDate) {
      const parsed = parsePublishDate(rawDate);
      if (parsed) {
        scheduledAt = parsed;
        // Warn when the parsed date is already in the past — almost always
        // a column mix-up, and a silent past-date would publish "immediately"
        // once scheduled.
        if (new Date(parsed).getTime() < Date.now()) {
          notes.push(`publish date "${rawDate}" is in the past — kept, but check it's intentional`);
        }
      } else {
        notes.push(`could not read the publish date "${rawDate}" — imported without a schedule`);
      }
    }

    // Auto-publish: "wordpress" is the only target today. Anything else
    // non-empty gets a note so typos are visible, not silently manual.
    let autoPublish: MappedRow["autoPublish"] = null;
    const rawAuto = at(autoPublishCol).toLowerCase();
    if (rawAuto) {
      if (rawAuto === "wordpress") {
        autoPublish = "wordpress";
      } else {
        notes.push(`unknown auto-publish target "${rawAuto}" — imported as manual`);
      }
    }

    rows.push({
      rowNumber,
      title: title || topic,
      keywords,
      topic: topic || title,
      contentType,
      platforms,
      externalLinks: cappedLinks,
      scheduledAt,
      autoPublish,
      importNote: notes.length > 0 ? notes.join("; ") : null,
    });
  });

  return { rows, skipped };
}
