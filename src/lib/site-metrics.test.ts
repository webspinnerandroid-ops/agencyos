import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchGADailyMetrics, fetchSCDailyMetrics } from "./site-metrics";

afterEach(() => {
  vi.restoreAllMocks();
});

const jsonRes = (body: unknown, ok = true) => ({
  ok,
  text: async () => JSON.stringify(body),
});

describe("fetchGADailyMetrics", () => {
  it("parses runReport rows and normalizes YYYYMMDD dates", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonRes({
        rows: [
          {
            dimensionValues: [{ value: "20260812" }],
            metricValues: [
              { value: "10" },
              { value: "8" },
              { value: "25" },
              { value: "0.64" },
            ],
          },
        ],
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const rows = await fetchGADailyMetrics("token", "123456789");
    expect(rows).toEqual([
      { date: "2026-08-12", sessions: 10, users: 8, pageviews: 25, engagementRate: 0.64 },
    ]);
    const [, init] = fetchMock.mock.calls[0];
    expect(String(init.url ?? "")).toContain(""); // body only
    expect((init as any).method).toBe("POST");
    const body = JSON.parse((init as any).body);
    expect(body.metrics.map((m: { name: string }) => m.name)).toEqual([
      "sessions",
      "totalUsers",
      "screenPageViews",
      "engagementRate",
    ]);
  });

  it("surfaces the API error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonRes(
          { error: { message: "User does not have permission" } },
          false
        )
      )
    );
    await expect(fetchGADailyMetrics("t", "1")).rejects.toThrow(
      "User does not have permission"
    );
  });
});

describe("fetchSCDailyMetrics", () => {
  it("parses searchAnalytics rows", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonRes({
        rows: [
          {
            keys: ["2026-08-12"],
            clicks: 42,
            impressions: 5000,
            ctr: 0.0084,
            position: 12.4,
          },
        ],
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const rows = await fetchSCDailyMetrics("token", "https://giantbyte.com/");
    expect(rows).toEqual([
      { date: "2026-08-12", clicks: 42, impressions: 5000, ctr: 0.0084, position: 12.4 },
    ]);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain(
      "/webmasters/v3/sites/" + encodeURIComponent("https://giantbyte.com/")
    );
    expect(url).toContain("/searchAnalytics/query");
  });

  it("returns an empty array for no rows", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRes({})));
    const rows = await fetchSCDailyMetrics("token", "sc-domain:acme.com");
    expect(rows).toEqual([]);
  });
});
