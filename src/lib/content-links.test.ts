import { describe, expect, it } from "vitest";
import {
  resolveInternalLinks,
  findBestPage,
  buildInternalLinkContext,
  type LinkablePage,
} from "./content-links";

const pages: LinkablePage[] = [
  {
    title: "Local SEO for Coffee Shops",
    url: "https://example.com/blog/local-seo-coffee-shops",
    text: "How coffee shops rank on Google Maps with Google Business Profile and reviews.",
  },
  {
    title: "Best Espresso Machines 2026",
    url: "https://example.com/blog/best-espresso-machines",
    text: "Home espresso machine buying guide covering grinders, tampers, and budget.",
  },
  {
    title: "About Us",
    url: "https://example.com/about",
    text: "Our story and the team behind the roastery.",
  },
];

describe("findBestPage", () => {
  it("matches a page by title keywords", () => {
    const page = findBestPage(pages, "how espresso machines compare");
    expect(page?.url).toBe("https://example.com/blog/best-espresso-machines");
  });

  it("matches by body text when title has no overlap", () => {
    const page = findBestPage(pages, "rankings on google maps listings");
    expect(page?.url).toBe("https://example.com/blog/local-seo-coffee-shops");
  });

  it("returns null for an unrelated phrase", () => {
    expect(findBestPage(pages, "recipes for sourdough bread")).toBeNull();
  });
});

describe("resolveInternalLinks", () => {
  it("replaces a marker with a real markdown link when a page matches", () => {
    const body =
      "Great grinders matter, as we covered in [INTERNAL LINK: espresso machines → best home espresso machines].";
    const out = resolveInternalLinks(body, pages);
    expect(out).toContain(
      "[espresso machines](https://example.com/blog/best-espresso-machines)"
    );
    expect(out).not.toContain("INTERNAL LINK");
  });

  it("handles the arrow-only separator form", () => {
    const body = "See [INTERNAL LINK: local SEO -> ranking on Google Maps].";
    const out = resolveInternalLinks(body, pages);
    expect(out).toContain(
      "[local SEO](https://example.com/blog/local-seo-coffee-shops)"
    );
  });

  it("degrades to plain anchor text when nothing matches", () => {
    const body = "Read [INTERNAL LINK: sourdough tips → baking bread at home].";
    const out = resolveInternalLinks(body, pages);
    expect(out).toBe("Read sourdough tips.");
    expect(out).not.toContain("INTERNAL LINK");
    expect(out).not.toMatch(/\[sourdough[^\]]*\]\(/);
  });

  it("leaves bare markers without an anchor untouched", () => {
    const body = "More on this [INTERNAL LINK] later.";
    expect(resolveInternalLinks(body, pages)).toBe("More on this [INTERNAL LINK] later.");
  });

  it("does nothing when there are no pages", () => {
    const body = "See [INTERNAL LINK: espresso → machines].";
    expect(resolveInternalLinks(body, [])).toBe(body);
  });
});

describe("buildInternalLinkContext", () => {
  it("derives url + anchor pairs and respects the limit", () => {
    const links = buildInternalLinkContext(pages, 2);
    expect(links).toHaveLength(2);
    expect(links[0]).toEqual({
      url: "https://example.com/blog/local-seo-coffee-shops",
      anchorText: "Local SEO for Coffee Shops",
    });
  });
});
