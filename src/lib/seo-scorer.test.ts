import { describe, it, expect } from "vitest";
import {
  scoreContent,
  contentLengthMultiplier,
  keywordDensityRatio,
  extractLinks,
  extractImages,
  plainText,
  stripMarkdownImage,
} from "./seo-scorer";

const BASE = {
  title: "Coal Creek Coffee Roasters: A Seasonal Menu Guide",
  metaDescription:
    "Coal Creek Coffee seasonal menu guide — what to order, why the blends change, and how the roasting works.",
  slug: "coal-creek-coffee-seasonal-menu-guide",
  body: "",
  keyword: "coal creek coffee",
  internalUrls: ["https://decorehotels.com/", "https://coalcreek.example.com/about"],
};

function makeBody(overrides: Partial<Record<string, unknown>> = {}): string {
  const sections = [
    "## Why the Coal Creek Coffee Menu Changes with the Seasons",
    "Coffee is a seasonal crop, and Coal Creek Coffee roasts to match. In summer the menu leans on light, fruity pours; in winter it shifts to deep chocolatey blends. If you are wondering what to order, the baristas at Coal Creek Coffee are happy to walk you through the current lineup.",
    "## How Seasonal Blends Are Roasted",
    "The roastmaster sources beans from a rotating set of farms. Each lot is cupped, profiled, and tasted before it lands on the menu at Coal Creek Coffee. This section explains the full process in a way that is easy to follow for any coffee lover who wants to understand the craft.",
    "## What to Order in Each Season",
    "Summer favorites include the citrus pour-over and the iced cascara tonic. Winter brings the molasses latte and the campfire cold brew. No matter the season, Coal Creek Coffee keeps a rotating single origin that pairs with the weather.",
    "## Frequently Asked Questions About Coal Creek Coffee",
    "People ask us daily about seasonal menus, roast dates, and whether the milk alternatives cost extra. Here are the answers, with a few recommendations from the bar team.",
  ];
  return sections.join("\n\n");
}

describe("contentLengthMultiplier", () => {
  it("returns 0 below 600 words", () => {
    expect(contentLengthMultiplier(300)).toBe(0);
  });
  it("scales through the documented thresholds", () => {
    expect(contentLengthMultiplier(800)).toBe(0.2);
    expect(contentLengthMultiplier(1200)).toBe(0.4);
    expect(contentLengthMultiplier(1700)).toBe(0.6);
    expect(contentLengthMultiplier(2200)).toBe(0.7);
    expect(contentLengthMultiplier(3000)).toBe(1);
  });
});

describe("keywordDensityRatio", () => {
  it("computes a sane density for a repeated phrase", () => {
    // 3 mentions of a 3-word phrase in ~440 words ≈ 2%.
    const text =
      "coal creek coffee ".repeat(3) + "other generic words ".repeat(140);
    const d = keywordDensityRatio(text, "coal creek coffee");
    expect(d).toBeGreaterThan(1);
    expect(d).toBeLessThan(3);
  });

  it("flags overstuffing", () => {
    const text = "coal creek coffee ".repeat(60) + "other words ".repeat(120);
    expect(keywordDensityRatio(text, "coal creek coffee")).toBeGreaterThan(3);
  });
});

describe("extractLinks / extractImages / plainText", () => {
  it("parses markdown links and skips image syntax", () => {
    const body =
      "See [our about page](https://coalcreek.example.com/about) and ![alt](https://img.example.com/a.png).";
    const links = extractLinks(body);
    expect(links.length).toBe(1);
    expect(links[0].url).toBe("https://coalcreek.example.com/about");
    expect(extractImages(body).length).toBe(1);
  });

  it("plainText strips markdown but keeps words", () => {
    const t = plainText("**Bold** and [linked text](https://x.com) here.");
    expect(t).toContain("Bold");
    expect(t).toContain("linked text");
    expect(t).not.toContain("](");
  });

  it("stripMarkdownImage removes image syntax only", () => {
    const out = stripMarkdownImage("before ![img](u) after");
    expect(out).toBe("before  after");
  });
});

describe("scoreContent", () => {
  it("a fully optimized post scores 100", () => {
    const body = makeBody();
    // Make the body long enough to max the length test without repeating the
    // keyword into overstuffed territory.
    const filler =
      "\n\nThe roastery remains a favourite for anyone seeking a locally roasted cup. " +
      "The seasonal approach means the menu changes, the origin rotates, and the recommendations shift with the weather. " +
      "Visitors often ask how to pick a roast; the answer is to start with the tasting notes and work outward.";
    const longBody =
      body +
      "\n\nRead more on [our about page](https://coalcreek.example.com/about)." +
      "\n\nAccording to [a specialty-coffee industry study](https://specialtycoffee.com/study), seasonal menus build loyalty." +
      "\n\n![Coal Creek Coffee seasonal pour](https://img.example.com/pour.png)" +
      filler.repeat(60);
    const res = scoreContent({ ...BASE, body: longBody });
    expect(res.total).toBe(100);
    expect(res.grade).toBe("green");
  });

  it("drops points when the keyword is missing from the title", () => {
    const res = scoreContent({
      ...BASE,
      title: "A Totally Different Seasonal Guide",
      body: makeBody(),
    });
    const titleCheck = res.checks.find((c) => c.id === "title");
    expect(titleCheck?.passed).toBe(false);
    expect(titleCheck?.earned).toBe(0);
    expect(res.total).toBeLessThan(100);
  });

  it("awards partial credit when the title has only part of the keyword", () => {
    // Title contains one of the keyword words ("coffee") but not the full
    // phrase — should earn half of the title check's 6 points, not 0.
    const res = scoreContent({
      ...BASE,
      title: "A Seasonal Coffee Guide",
      body: makeBody(),
    });
    const titleCheck = res.checks.find((c) => c.id === "title");
    expect(titleCheck?.passed).toBe(false);
    expect(titleCheck?.earned).toBe(3); // 6 * 0.5
  });

  it("gives partial credit for a single keyword mention in the body", () => {
    const body =
      "A short body with no subheadings. " +
      `Only one mention of the keyword: ${BASE.keyword}. ` +
      "Nothing else here.";
    const res = scoreContent({ ...BASE, body });
    const bodyCheck = res.checks.find((c) => c.id === "body");
    expect(bodyCheck?.passed).toBe(false);
    expect(bodyCheck?.earned).toBeGreaterThan(0);
    expect(bodyCheck?.earned).toBeLessThan(6);
  });

  it("gives partial credit when a paragraph is over the word limit", () => {
    const longPara = "word ".repeat(150);
    const res = scoreContent({
      ...BASE,
      body: makeBody() + "\n\n" + longPara,
    });
    const paraCheck = res.checks.find((c) => c.id === "paragraphs");
    expect(paraCheck?.passed).toBe(false);
    expect(paraCheck?.earned).toBeGreaterThan(0);
    expect(paraCheck?.earned).toBeLessThan(13);
  });

  it("flags missing alt text / keyword-less alts", () => {
    const body =
      makeBody() + "\n\n![some random scene](https://img.example.com/1.png)";
    const res = scoreContent({ ...BASE, body });
    const imgCheck = res.checks.find((c) => c.id === "images");
    expect(imgCheck?.passed).toBe(false);
  });

  it("passes the image check when an alt carries the keyword", () => {
    const body =
      makeBody() +
      "\n\n![Coal Creek Coffee seasonal pour](https://img.example.com/1.png)";
    const res = scoreContent({ ...BASE, body });
    const imgCheck = res.checks.find((c) => c.id === "images");
    expect(imgCheck?.passed).toBe(true);
  });

  it("fails the internal-links test when no KB page is linked", () => {
    const res = scoreContent({ ...BASE, body: makeBody() });
    const internal = res.checks.find((c) => c.id === "internal");
    expect(internal?.passed).toBe(false);
  });

  it("passes the internal-links test when a KB page is linked", () => {
    const body =
      makeBody() + "\n\nRead more on [our about page](https://coalcreek.example.com/about).";
    const res = scoreContent({ ...BASE, body });
    const internal = res.checks.find((c) => c.id === "internal");
    expect(internal?.passed).toBe(true);
  });

  it("fails on a paragraph longer than 120 words", () => {
    const longPara =
      "word ".repeat(150);
    const res = scoreContent({ ...BASE, body: makeBody() + "\n\n" + longPara });
    const paraCheck = res.checks.find((c) => c.id === "paragraphs");
    expect(paraCheck?.passed).toBe(false);
  });

  it("fails the subheading test with fewer than 2 H2/H3", () => {
    const res = scoreContent({
      ...BASE,
      body: "One short paragraph without any subheadings at all.",
    });
    const sub = res.checks.find((c) => c.id === "subheadings");
    expect(sub?.passed).toBe(false);
  });

  it("always produces a 0-100 total with 12 checks", () => {
    const res = scoreContent({ ...BASE, body: makeBody() });
    expect(res.checks.length).toBe(12);
    expect(res.total).toBeGreaterThanOrEqual(0);
    expect(res.total).toBeLessThanOrEqual(100);
  });

  it("grades red / yellow / green by threshold", () => {
    const bad = scoreContent({
      ...BASE,
      title: "x",
      metaDescription: "y",
      slug: "z",
      body: "short body",
      keyword: "totally different keyword",
    });
    expect(bad.grade).toBe("red");

    const perfect = scoreContent({
      ...BASE,
      body:
        makeBody() +
        "\n\nRead more on [our about page](https://coalcreek.example.com/about)." +
        "\n\n[industry study](https://specialtycoffee.com/study)" +
        "\n\n![Coal Creek Coffee pour](https://img.example.com/pour.png)" +
        "\n\n" +
        "word ".repeat(2500),
    });
    expect(perfect.grade).toBe("green");
  });
});
