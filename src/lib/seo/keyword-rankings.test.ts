import { describe, it, expect } from "vitest";
import {
  matchRankings,
  targetKeywordsOf,
  type RankingRow,
} from "./keyword-rankings";

const rows: RankingRow[] = [
  { query: "buckland museum", position: 2.3, impressions: 954, clicks: 147 },
  { query: "witchcraft museum", position: 3.56, impressions: 1060, clicks: 79 },
  { query: "radionics", position: 9.21, impressions: 2912, clicks: 20 },
];

describe("matchRankings", () => {
  it("exact-matches a keyword to its position", () => {
    const r = matchRankings(["buckland museum"], rows);
    expect(r["buckland museum"]).toEqual({
      position: 2.3,
      impressions: 954,
      clicks: 147,
      query: "buckland museum",
    });
  });

  it("falls back to containment matching", () => {
    const r = matchRankings(["witchcraft museum ohio"], rows);
    expect(r["witchcraft museum ohio"]?.position).toBe(3.6);
    expect(r["witchcraft museum ohio"]?.query).toBe("witchcraft museum");
  });

  it("prefers the most-impressions match when several contain", () => {
    const r = matchRankings(["museum"], rows);
    // "witchcraft museum" (1060) beats "buckland museum" (954).
    expect(r["museum"]?.query).toBe("witchcraft museum");
  });

  it("leaves unmatched keywords absent", () => {
    const r = matchRankings(["definitely not here"], rows);
    expect(r).toEqual({});
  });

  it("rounds positions to one decimal", () => {
    const r = matchRankings(["radionics"], [
      { query: "radionics", position: 9.216, impressions: 10, clicks: 1 },
    ]);
    expect(r["radionics"]?.position).toBe(9.2);
  });
});

describe("targetKeywordsOf", () => {
  it("extracts and trims keyword strings", () => {
    expect(
      targetKeywordsOf({ targetKeywords: [{ keyword: " a " }, { keyword: "b" }] })
    ).toEqual(["a", "b"]);
  });

  it("handles missing campaign_json", () => {
    expect(targetKeywordsOf(null)).toEqual([]);
    expect(targetKeywordsOf({})).toEqual([]);
  });
});
