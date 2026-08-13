import { describe, it, expect, vi, afterEach } from "vitest";
import { rescoreCompetitorEntries } from "./competitor-backfill";

function html(text = "<title>X</title><h1>Hello</h1><p>body text here</p>") {
  return text;
}

describe("rescoreCompetitorEntries", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("re-scores every entry with a competitorUrl and merges scores", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(new Response(html(), { status: 200 }))
        )
    );
    const { entries, scored } = await rescoreCompetitorEntries([
      { competitorUrl: "https://examplehotels.com", seoScore: 12 },
      { competitorUrl: "https://rivalresorts.com", seoScore: null, crawled: false },
    ]);
    expect(scored).toBe(2);
    expect(entries[0].seoScore).toBeTypeOf("number");
    expect(entries[1].crawled).toBe(true);
  });

  it("marks unreachable entries crawled=false with null scores", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("no", { status: 403 }))
    );
    const { entries, unreachable } = await rescoreCompetitorEntries([
      { competitorUrl: "https://dead.com", seoScore: 99 },
    ]);
    expect(unreachable).toBe(1);
    expect(entries[0].crawled).toBe(false);
    expect(entries[0].seoScore).toBeNull();
  });

  it("leaves entries without a competitorUrl untouched", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const { entries } = await rescoreCompetitorEntries([
      { competitorUrl: "" },
      { somethingElse: true },
    ]);
    expect(entries).toHaveLength(2);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});
