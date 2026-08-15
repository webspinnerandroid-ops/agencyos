import { describe, it, expect, vi, afterEach } from "vitest";
import { toCompetitorData } from "./competitors";

function goodHtml(title = "Rival Hotel | Book Rooms") {
  return `<!doctype html><html><head><title>${title}</title>
    <meta name="description" content="Book rooms at our hotel. ${title} offers luxury stays, suites and conference facilities.">
    </head><body><h1>${title}</h1>
    <p>Welcome to our hotel. We offer rooms, suites and conference facilities in the city center. Book your stay today and enjoy great rates and friendly service.</p>
    <a href="https://rival.com/about">About us</a></body></html>`;
}

function shellHtml() {
  return "<!doctype html><html><head></head><body><div id='app'></div></body></html>";
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Stub global fetch per-URL; an Error means the fetch itself throws. */
function stubFetch(map: Record<string, Response | Error>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const u = typeof input === "string" ? input : String((input as Request).url);
      const hit = map[u];
      if (!hit) return new Response("not found", { status: 404 });
      if (hit instanceof Error) throw hit;
      return hit;
    })
  );
}

describe("toCompetitorData replacement policy", () => {
  it("keeps every anchor scored when all sites crawl", async () => {
    const urls = ["https://a.com", "https://b.com", "https://c.com"];
    stubFetch(
      Object.fromEntries(
        urls.map((u, i) => [u, new Response(goodHtml(`Site ${i}`), { status: 200 })])
      )
    );
    const out = await toCompetitorData(urls);
    expect(out).toHaveLength(3);
    expect(
      out.every((c) => c.crawled === true && typeof c.seoScore === "number")
    ).toBe(true);
    expect(out.some((c) => c.crawlNote)).toBe(false);
  });

  it("notes uncrawlable anchors by domain and fills their slots with crawlable backups", async () => {
    const map: Record<string, Response | Error> = {
      "https://dead1.com": new Error("ECONNREFUSED"),
      "https://good1.com": new Response(goodHtml("Good 1"), { status: 200 }),
      "https://dead2.com": new Response("forbidden", { status: 403 }),
      "https://good2.com": new Response(goodHtml("Good 2"), { status: 200 }),
      "https://good3.com": new Response(goodHtml("Good 3"), { status: 200 }),
      "https://good4.com": new Response(goodHtml("Good 4"), { status: 200 }),
      "https://good5.com": new Response(goodHtml("Good 5"), { status: 200 }),
    };
    stubFetch(map);
    const out = await toCompetitorData(
      [
        "https://dead1.com",
        "https://good1.com",
        "https://dead2.com",
        "https://good2.com",
        "https://good3.com",
        "https://good4.com",
        "https://good5.com",
      ],
      undefined,
      { maxScored: 5 }
    );
    const scored = out.filter((c) => c.crawled !== false);
    const notes = out.filter((c) => c.crawled === false);
    expect(scored).toHaveLength(5);
    expect(notes).toHaveLength(2);
    expect(notes.map((n) => n.competitorUrl)).toEqual([
      "https://dead1.com",
      "https://dead2.com",
    ]);
    expect(notes.every((n) => n.crawlNote && n.seoScore == null)).toBe(true);
  });

  it("drops failed candidates entirely when keepNotes=false", async () => {
    const map: Record<string, Response | Error> = {
      "https://dead1.com": new Error("ECONNREFUSED"),
      "https://good1.com": new Response(goodHtml("Good 1"), { status: 200 }),
    };
    stubFetch(map);
    const out = await toCompetitorData(
      ["https://dead1.com", "https://good1.com"],
      undefined,
      { maxScored: 5, keepNotes: false }
    );
    expect(out).toHaveLength(1);
    expect(out[0].competitorUrl).toBe("https://good1.com");
    expect(out[0].crawled).toBe(true);
  });

  it("notes a JS-rendered shell (no readable content) as not fully crawled", async () => {
    stubFetch({ "https://spa.com": new Response(shellHtml(), { status: 200 }) });
    const out = await toCompetitorData(["https://spa.com"]);
    expect(out[0].crawled).toBe(false);
    expect(out[0].crawlNote).toContain("no readable content");
  });
});
