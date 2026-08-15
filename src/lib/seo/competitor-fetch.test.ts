import { describe, it, expect, vi, afterEach } from "vitest";
import {
  fetchCompetitorHtml,
  fetchCompetitorHtmlDetailed,
} from "./competitor-fetch";

function textResponse(body: string, status = 200) {
  return new Response(body, { status });
}

describe("fetchCompetitorHtml", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns HTML from the plain-fetch stage when it succeeds", async () => {
    const fetchMock = vi.fn().mockResolvedValue(textResponse("<html>hi</html>"));
    vi.stubGlobal("fetch", fetchMock);
    const html = await fetchCompetitorHtml("https://a.com");
    expect(html).toBe("<html>hi</html>");
    // First attempt uses the bot UA.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({
      "User-Agent": expect.stringContaining("AgencyOS-SeoAuditor"),
    });
  });

  it("falls back to browser-like headers when the plain fetch fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("blocked", { status: 403 }))
      .mockResolvedValueOnce(textResponse("<html>ok</html>"));
    vi.stubGlobal("fetch", fetchMock);
    const html = await fetchCompetitorHtml("https://a.com");
    expect(html).toBe("<html>ok</html>");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, init] = fetchMock.mock.calls[1];
    expect((init as RequestInit).headers).toMatchObject({
      "sec-fetch-dest": "document",
      "User-Agent": expect.stringContaining("Chrome/"),
    });
  });

  it("returns null when every stage fails and headless is disabled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("no", { status: 403 }))
    );
    // Headless is opt-in via env; unset in this test, so the ladder stops at
    // the browser-like stage and yields null without launching a browser.
    delete process.env.HEADLESS_BROWSER_EXECUTABLE;
    delete process.env.HEADLESS_BROWSER_ENABLED;
    const html = await fetchCompetitorHtml("https://a.com");
    expect(html).toBeNull();
  });

  it("reports a homepage redirect instead of silently scoring the wrong page", async () => {
    // A subdirectory-install trap: /blog/post bounces to the bare homepage.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(null, {
          status: 301,
          headers: { location: "https://a.com/" },
        })
      )
    );
    delete process.env.HEADLESS_BROWSER_EXECUTABLE;
    delete process.env.HEADLESS_BROWSER_ENABLED;
    const out = await fetchCompetitorHtmlDetailed("https://a.com/blog/post");
    expect(out.html).toBeNull();
    expect(out.redirectedHome).toBe(true);
    expect(out.finalUrl).toBe("https://a.com/");
  });

  it("follows a same-host redirect to another real page", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 301,
          headers: { location: "/blog/post/" },
        })
      )
      .mockResolvedValueOnce(textResponse("<html>article</html>"));
    vi.stubGlobal("fetch", fetchMock);
    delete process.env.HEADLESS_BROWSER_EXECUTABLE;
    delete process.env.HEADLESS_BROWSER_ENABLED;
    const out = await fetchCompetitorHtmlDetailed("https://a.com/blog/post");
    expect(out.html).toBe("<html>article</html>");
    expect(out.redirectedHome).toBeUndefined();
  });
});
