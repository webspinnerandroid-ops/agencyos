import { describe, it, expect } from "vitest";
import { parseCsv, mapCsvRows, splitExternalLinks, parsePublishDate } from "./content-map-import";

/** Shared helper: CSV text → mapped rows. */
const mapped = (csv: string) => mapCsvRows(parseCsv(csv));

describe("parseCsv", () => {
  it("parses simple rows and strips the header", () => {
    const out = parseCsv("Title,Topic\nA,about a\nB,about b\n");
    expect(out.header).toEqual(["Title", "Topic"]);
    expect(out.rows).toEqual([["A", "about a"], ["B", "about b"]]);
  });

  it("keeps quoted commas, escaped quotes, and embedded newlines", () => {
    const out = parseCsv('Title,Keywords\n"Said, simply","a ""quoted"" word"\n"Multi\nline","x"\n');
    expect(out.rows[0]).toEqual(["Said, simply", 'a "quoted" word']);
    expect(out.rows[1]).toEqual(["Multi\nline", "x"]);
  });

  it("handles CRLF and drops fully-blank lines", () => {
    const out = parseCsv("Title,Topic\r\n\r\nA,about a\r\n\r\n");
    expect(out.rows).toEqual([["A", "about a"]]);
  });

  it("strips a UTF-8 BOM so the first header matches", () => {
    const out = parseCsv("\uFEFFTitle,Topic\nA,b\n");
    expect(out.header).toEqual(["Title", "Topic"]);
  });
});

describe("mapCsvRows", () => {

  it("maps the core columns with first keyword as focus", () => {
    const { rows } = mapped(
      "Title,Keywords,Topic\nMy Post,\"coffee beans, brewing, roasting guide\",About coffee\n"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("My Post");
    expect(rows[0].keywords[0]).toBe("coffee beans");
    expect(rows[0].keywords).toContain("roasting guide");
    expect(rows[0].topic).toBe("About coffee");
    expect(rows[0].contentType).toBe("blog");
    expect(rows[0].importNote).toBeNull();
  });

  it("is header-format tolerant: case, spaces, underscores", () => {
    const { rows } = mapped(
      "TITLE, Focus_Keyword, Keywords, TOPIC\nT,coffee,\"beans, roasting\",About\n"
    );
    expect(rows[0].keywords[0]).toBe("coffee");
    expect(rows[0].keywords).toContain("roasting");
    expect(rows[0].topic).toBe("About");
  });

  it("a Focus Keyword column wins over the Keywords list", () => {
    const { rows } = mapped(
      "Title,Focus Keyword,Keywords\nT,espresso,\"espresso machines, gear\"\n"
    );
    expect(rows[0].keywords[0]).toBe("espresso");
    expect(rows[0].keywords).toContain("gear");
  });

  it("falls back Title↔Topic and skips rows with neither", () => {
    const { rows, skipped } = mapped(
      "Title,Topic,Keywords\nOnly Title,,k1\n,Only Topic,k2\n,,k3\n"
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].topic).toBe("Only Title");
    expect(rows[1].title).toBe("Only Topic");
    // A row with keywords but neither title nor topic can't be generated
    // from — skipped with the reason.
    expect(skipped).toEqual([
      { rowNumber: 3, reason: expect.stringContaining("neither") },
    ]);
  });

  it("warns on blog rows with no keywords and on unknown types", () => {
    const { rows } = mapped("Title,Keywords,Type\nT,,podcast\n");
    expect(rows[0].keywords).toHaveLength(0);
    expect(rows[0].importNote).toContain("no keywords");
    expect(rows[0].importNote).toContain('unknown type "podcast"');
    expect(rows[0].contentType).toBe("blog");
  });

  it("social rows keep known platforms, drop unknown ones, and default to instagram", () => {
    // Only-unknown platforms → dropped, then defaulted to instagram.
    const a = mapped("Title,Type,Platforms\nT,social,twitch\n").rows[0];
    expect(a.platforms).toEqual(["instagram"]);
    expect(a.importNote).toContain("unknown platform(s) dropped: twitch");
    expect(a.importNote).toContain("defaulted to instagram");

    const b = mapped("Title,Type,Platforms\nT,social,\"linkedin, facebook\"\n").rows[0];
    expect(b.platforms).toEqual(["linkedin", "facebook"]);
  });

  it("notes that platforms on a blog row become social captions", () => {
    const { rows } = mapped("Title,Type,Platforms\nT,blog,linkedin\n");
    expect(rows[0].importNote).toContain("matching social captions");
  });
});

describe("splitExternalLinks", () => {
  it("returns empty for an absent/empty cell — links are optional", () => {
    expect(splitExternalLinks("")).toEqual({ urls: [], dropped: [] });
    expect(splitExternalLinks("   ")).toEqual({ urls: [], dropped: [] });
  });

  it("keeps valid http(s) and bare-domain URLs, normalized", () => {
    const { urls, dropped } = splitExternalLinks(
      "https://parks-canada.example/trails, www.travel-guide.example/jasper"
    );
    expect(urls).toEqual([
      "https://parks-canada.example/trails",
      "https://www.travel-guide.example/jasper",
    ]);
    expect(dropped).toEqual([]);
  });

  it("accepts semicolon separators and drops junk entries with a note", () => {
    const { urls, dropped } = splitExternalLinks(
      "https://a.example/x; not a link at all; b.example/y"
    );
    expect(urls).toEqual(["https://a.example/x", "https://b.example/y"]);
    expect(dropped).toEqual(["not a link at all"]);
  });
});

describe("mapCsvRows — external links", () => {

  it("carries provided sources and stays silent when the column is absent", () => {
    const withLinks = mapped(
      'Title,Keywords,External Links\nT,"jasper trails","https://a.example, https://b.example"\n'
    ).rows[0];
    expect(withLinks.externalLinks).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
    expect(withLinks.importNote).toBeNull();

    const withoutColumn = mapped('Title,Keywords\nT,jasper trails\n').rows[0];
    expect(withoutColumn.externalLinks).toEqual([]);
    expect(withoutColumn.importNote).toBeNull();
  });

  it("drops invalid URLs with a note but keeps the row generatable", () => {
    const { rows } = mapped(
      'Title,Keywords,External Links\nT,kw,"https://good.example, junk text"\n'
    );
    expect(rows[0].externalLinks).toEqual(["https://good.example"]);
    expect(rows[0].importNote).toContain("invalid external link(s) dropped: junk text");
  });

  it("caps at 5 sources with a note when more are given", () => {
    const { rows } = mapped(
      "Title,Keywords,External Links\nT,kw,\"https://1.example, https://2.example, https://3.example, https://4.example, https://5.example, https://6.example\"\n"
    );
    expect(rows[0].externalLinks).toHaveLength(5);
    expect(rows[0].importNote).toContain("first 5");
  });
});

describe("Publish Date column (optional suggested schedule)", () => {
  // CSV times mean the user's LOCAL wall time — expected values are built
  // with local-time constructors so the suite passes in any timezone.
  it("parses ISO dates and datetimes", () => {
    expect(parsePublishDate("2026-06-01")).toBe(new Date(2026, 5, 1).toISOString());
    expect(parsePublishDate("2026-06-01T09:00")).toBe(
      new Date(2026, 5, 1, 9, 0).toISOString()
    );
  });

  it("parses US spreadsheet dates with optional AM/PM time", () => {
    expect(parsePublishDate("6/15/2026")).toBe(new Date(2026, 5, 15).toISOString());
    expect(parsePublishDate("6/15/2026 10:00 AM")).toBe(
      new Date(2026, 5, 15, 10, 0).toISOString()
    );
    expect(parsePublishDate("6/15/2026 2:30 PM")).toBe(
      new Date(2026, 5, 15, 14, 30).toISOString()
    );
  });

  it("parses long-form dates via the fallback", () => {
    expect(parsePublishDate("May 1, 2026")).toBe(new Date(2026, 4, 1).toISOString());
  });

  it("returns null for unparseable values (never throws)", () => {
    expect(parsePublishDate("")).toBeNull();
    expect(parsePublishDate("not a date")).toBeNull();
    expect(parsePublishDate("13/13/2026")).toBeNull();
  });

  it("stores a valid CSV Publish Date on the row as scheduledAt", () => {
    // A fixed far-future date so this never becomes a stale-past-date.
    const future = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    const isoLocal = `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}T09:00`;
    const { rows } = mapped(`Title,Keywords,Publish Date\nT,kw,"${isoLocal}"\n`);
    const expected = new Date(future.getFullYear(), future.getMonth(), future.getDate(), 9, 0);
    expect(rows[0].scheduledAt).toBe(expected.toISOString());
    expect(rows[0].importNote).toBeNull();
  });

  it("imports fine with a note when the date is unparseable (never an error)", () => {
    const { rows } = mapped(
      'Title,Keywords,Publish Date\nT,kw,"whenever"\n'
    );
    expect(rows[0].scheduledAt).toBeNull();
    expect(rows[0].importNote).toContain("could not read the publish date");
  });

  it("an absent Publish Date column is silent — no note, no schedule", () => {
    const { rows } = mapped("Title,Keywords\nT,kw\n");
    expect(rows[0].scheduledAt).toBeNull();
    expect(rows[0].importNote).toBeNull();
  });

  it("accepts Destination as an alias of Platforms", () => {
    const { rows } = mapped(
      'Title,Keywords,Type,Destination\nT,kw,social,"instagram, facebook"\n'
    );
    expect(rows[0].contentType).toBe("social");
    expect(rows[0].platforms).toEqual(["instagram", "facebook"]);
    expect(rows[0].importNote).toBeNull();
  });

  it("accepts Date / Scheduled Date / Post Date as aliases of Publish Date", () => {
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    const iso = `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}`;
    for (const header of ["Date", "Scheduled Date", "Post Date", "Publish At"]) {
      const { rows } = mapped(`Title,Keywords,${header}\nT,kw,${iso}\n`);
      expect(rows[0].scheduledAt, header).toBe(
        new Date(future.getFullYear(), future.getMonth(), future.getDate()).toISOString()
      );
    }
  });

  it("skips placeholder rows (generic title, no keywords) with an explicit reason", () => {
    const { rows, skipped } = mapped(
      "Title,Keywords\nBlog Promotion,\nLocal Attraction,\nGBP Post,\nReal Post About Jasper,whitewater rafting jasper\n"
    );
    expect(rows.map((r) => r.title)).toEqual(["Real Post About Jasper"]);
    expect(skipped.map((s) => s.reason)).toEqual([
      'Placeholder row ("Blog Promotion" with no keywords) — name the actual topic in the Title/Topic column to import it',
      'Placeholder row ("Local Attraction" with no keywords) — name the actual topic in the Title/Topic column to import it',
      'Placeholder row ("GBP Post" with no keywords) — name the actual topic in the Title/Topic column to import it',
    ]);
  });

  it("does not treat a generic title WITH keywords as a placeholder", () => {
    const { rows, skipped } = mapped(
      'Title,Keywords\nBlog Promotion,"email marketing, newsletters"\n'
    );
    expect(rows).toHaveLength(1);
    expect(skipped).toHaveLength(0);
  });

  it("does not treat a one-off real title as a placeholder even without keywords", () => {
    const { rows, skipped } = mapped(
      "Title\nGuest Experience: What Our Visitors Say\n"
    );
    expect(rows).toHaveLength(1);
    expect(skipped).toHaveLength(0);
  });
});

describe("Auto Publish column", () => {
  it("reads 'wordpress' and stores it as the row's automation target", () => {
    const { rows } = mapped(
      "Title,Auto Publish\nWinter Guide,wordpress\n"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].autoPublish).toBe("wordpress");
  });

  it("defaults to null (manual) when the column is absent or empty", () => {
    const { rows } = mapped("Title\nJust a title\n");
    expect(rows[0].autoPublish).toBeNull();
    const { rows: rows2 } = mapped("Title,Auto Publish\nA,\n");
    expect(rows2[0].autoPublish).toBeNull();
  });

  it("notes unknown targets instead of silently accepting them", () => {
    const { rows } = mapped(
      "Title,Auto Publish\nA,medium\n"
    );
    expect(rows[0].autoPublish).toBeNull();
    expect(rows[0].importNote).toContain("unknown auto-publish target");
  });
});

describe("Mode column (gate vs fiction)", () => {
  it("defaults every row to 'gate' when the column is absent — the scored pipeline is unchanged", () => {
    const { rows } = mapped("Title,Topic\nPlain SEO Post,a topic\n");
    expect(rows).toHaveLength(1);
    expect(rows[0].mode).toBe("gate");
    expect(rows[0].importNote ?? "").not.toContain("fiction");
  });

  it("maps empty and 'gate' values to 'gate'", () => {
    const { rows } = mapped("Title,Mode\nA,gate\nB,\n");
    expect(rows[0].mode).toBe("gate");
    expect(rows[1].mode).toBe("gate");
  });

  it("maps 'fiction'/'story'/'creative*' to 'fiction' with a visible note", () => {
    const { rows } = mapped(
      "Title,Mode\nGhost Story,fiction\nSea Tale,story\nFable,creative writing\n"
    );
    expect(rows.map((r) => r.mode)).toEqual(["fiction", "fiction", "fiction"]);
    for (const r of rows) {
      expect(r.importNote).toContain("fiction");
      expect(r.importNote).toContain("skips the SEO/AEO/GEO gate");
    }
  });

  it("notes unknown mode values instead of silently accepting them", () => {
    const { rows } = mapped("Title,Mode\nA,poem\n");
    expect(rows[0].mode).toBe("gate");
    expect(rows[0].importNote).toContain("unknown mode");
  });

  it("accepts 'Writing Mode' as a header alias", () => {
    const { rows } = mapped("Title,Writing Mode\nA,fiction\n");
    expect(rows[0].mode).toBe("fiction");
  });
});
