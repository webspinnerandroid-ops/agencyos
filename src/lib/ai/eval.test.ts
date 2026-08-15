import { describe, it, expect } from "vitest";
import {
  EVAL_SAMPLES,
  EVAL_ROLES,
  evalTeam,
  scoreEmployeeOutput,
} from "./eval";
import { scoreContent } from "@/lib/seo-scorer";
import { scoreAeoGeo } from "@/lib/aeo-geo";

describe("ai team eval loop", () => {
  it("has criteria for every employee in the persona catalog", () => {
    // Every persona key should have a criteria set so no employee is
    // unmeasured. (Some personas share pipelines, but each has rules.)
    const keys = [
      "penny",
      "eva",
      "sonny",
      "stan",
      "rachel",
      "scout",
      "dev",
      "gauge",
      "nina",
      "juno",
      "linda",
    ];
    for (const k of keys) {
      expect(EVAL_ROLES, `missing eval criteria for ${k}`).toContain(k);
    }
  });

  it("good samples pass every criterion", () => {
    for (const [role, sample] of Object.entries(EVAL_SAMPLES)) {
      const res = scoreEmployeeOutput(role, sample.good, {
        keyword: "friendship",
        platform: "instagram",
        today: "2026-08-12",
        internalUrls: ["/site/about"],
      });
      expect(
        res.verdict,
        `${role}: expected pass, got ${res.passed}/${res.total}: ` +
          res.criteria.filter((c) => !c.passed).map((c) => c.name).join(", ")
      ).toBe("pass");
    }
  });

  it("bad samples fail at least one criterion", () => {
    for (const [role, sample] of Object.entries(EVAL_SAMPLES)) {
      const res = scoreEmployeeOutput(role, sample.bad, {
        keyword: "friendship",
        platform: "instagram",
        today: "2026-08-12",
        internalUrls: ["/site/about"],
      });
      expect(
        res.verdict,
        `${role}: bad sample must not pass (got ${res.passed}/${res.total})`
      ).not.toBe("pass");
    }
  });

  it("evalTeam scores a whole crew at once", () => {
    const results = evalTeam({
      penny: EVAL_SAMPLES.penny.good,
      sonny: EVAL_SAMPLES.sonny.bad,
      nina: EVAL_SAMPLES.nina.good,
    });
    expect(results.penny.verdict).toBe("pass");
    expect(results.sonny.verdict).not.toBe("pass");
    expect(results.nina.verdict).toBe("pass");
  });

  it("Brett's chat-vs-phone regression is caught", () => {
    // The known bug: Brett opening a chat message with the phone greeting.
    const res = scoreEmployeeOutput("rachel", EVAL_SAMPLES.rachel.bad);
    const greeting = res.criteria.find((c) => c.name === "No phone script in chat");
    expect(greeting?.passed).toBe(false);
  });

  it("penny's blogs must maximize the real SEO + AEO/GEO engines", () => {
    // A max-scoring blog at the 1500-2000 word sweet spot (2500+ times out
    // generation), keyword in title/meta/slug/first-10%, internal + outbound
    // links, keyword-bearing image alts, H2/H3 structure, no 120+ word
    // paragraphs, Q&A + data for AEO/GEO.
    const keyword = "specialty coffee roasting";
    const body = buildMaxScoreBlog(keyword, 7); // ~1750 words
    const blogCtx = {
      title: "Specialty Coffee Roasting: The Complete Guide",
      metaDescription:
        "Specialty coffee roasting explained: how the specialty coffee roasting process works, what roasters get wrong, and how to buy better beans.",
      slug: "specialty-coffee-roasting-guide",
      keyword,
      body,
      internalUrls: ["/site/about", "/site/shop"],
      entities: ["Agency OS", "blissmedialab.com"],
    };

    // The blog itself must score green in both engines.
    const seo = scoreContent({
      title: blogCtx.title,
      metaDescription: blogCtx.metaDescription,
      slug: blogCtx.slug,
      body,
      keyword,
      internalUrls: blogCtx.internalUrls,
    });
    const aeo = scoreAeoGeo({ ...blogCtx } as Parameters<typeof scoreAeoGeo>[0]);
    expect(seo.total).toBeGreaterThanOrEqual(85);
    expect(seo.wordCount).toBeGreaterThanOrEqual(1500);
    expect(seo.wordCount).toBeLessThanOrEqual(2600);
    expect(aeo.total).toBeGreaterThanOrEqual(70);

    // And Cheryl's eval must pass it — including the engine-parity criterion.
    const res = scoreEmployeeOutput("penny", body, blogCtx);
    const parity = res.criteria.find((c) => c.name === "Max-scoring blog (real engine)");
    expect(parity?.passed).toBe(true);
    expect(res.verdict).toBe("pass");
  });

  it("penny's short blogs fail the max-scoring parity (600 words is not enough)", () => {
    const keyword = "specialty coffee roasting";
    const short = buildMaxScoreBlog(keyword, 2); // ~600 words — under the 2000-word floor
    const res = scoreEmployeeOutput("penny", short, {
      title: "Specialty Coffee Roasting: The Complete Guide",
      metaDescription: "Specialty coffee roasting explained.",
      slug: "specialty-coffee-roasting-guide",
      keyword,
      body: short,
      internalUrls: ["/site/about"],
    });
    const parity = res.criteria.find((c) => c.name === "Max-scoring blog (real engine)");
    expect(parity?.passed).toBe(false);
    expect(res.verdict).not.toBe("pass");
  });
});

/** Build a realistic 1500-2000 word markdown blog that passes every scorer check. */
function buildMaxScoreBlog(keyword: string, sections = 28): string {
  const kw = keyword; // "specialty coffee roasting"
  const head =
    `# ${kw}: The Complete Guide\n\n` +
    `Specialty coffee roasting is the process of transforming green coffee beans into the ` +
    `aromatic, flavorful beans you brew at home. In this guide we explain what specialty coffee ` +
    `roasting involves, the science behind the roast, the mistakes most roasters make, and how to ` +
    `choose beans that were roasted with care. Whether you are a home roaster or just a curious ` +
    `drinker, this is the definitive walkthrough of specialty coffee roasting.\n\n`;

  const topics = [
    "why the roast profile matters",
    "the chemistry of the first crack",
    "light vs dark roast myths",
    "how origin affects the roast",
    "the roasting equipment you need",
    "common roasting mistakes",
    "how to taste a roast you made",
    "storing roasted beans correctly",
    "the business side of roasting",
    "sustainability in coffee roasting",
    "how to buy green coffee",
    "roast development time explained",
    "cooling and degassing",
    "cupping your own roasts",
    "the future of coffee roasting",
  ];

  const sectionsArr: string[] = [];
  for (let i = 0; i < sections; i++) {
    const topic = topics[i % topics.length];
    const heading = i % 3 === 0 ? `## ${capitalize(topic)}` : `### ${capitalize(topic)}`;
    // ~90 words per section, never a paragraph over 120 words.
    const p1 =
      `${capitalize(topic)} is one of the most misunderstood parts of specialty coffee roasting. ` +
      `Most home roasters skip it entirely, and commercial roasters often rush it to save time. ` +
      `The evidence from every serious roastery we have studied says the same thing: the details ` +
      `here decide whether your beans taste flat or exceptional. A great roast is not an accident; ` +
      `it is a repeatable process, and this section explains exactly how the process works.`;
    const p2 =
      `In practice, the best approach is to measure, taste, and adjust. Keep a log of your roast ` +
      `times and temperatures, taste the result after two days of degassing, and change one variable ` +
      `at a time. This is how professional roasters build their signature profiles, and it is how ` +
      `you can too. The specialty coffee roasting community shares these techniques openly, so do ` +
      `not be afraid to borrow what works and make it your own.`;
    const p3 =
      `When you master ${topic}, the payoff is immediate: sweeter cups, clearer flavors, and beans ` +
      `that keep their character for weeks instead of days. Roast in small batches, keep notes, and ` +
      `compare against a reference roast from a roaster you trust. Over time you will develop the ` +
      `palate and the process to roast exactly the coffee you love.`;
    sectionsArr.push(`${heading}\n\n${p1}\n\n${p2}\n\n${p3}\n\n`);
  }

  // Images: one featured + two inline, all alts containing the keyword.
  const images =
    `![${kw} beans in a roaster drum](/media/roaster-drum.png)\n\n` +
    `![Fresh ${kw} batch cooling](/media/cooling-tray.png)\n\n` +
    `![${kw} cupping session](/media/cupping.png)\n\n`;

  const links =
    `You might also like: [our roasting guide](/site/about) and [the shop](/site/shop). ` +
    `For the science, see the [Specialty Coffee Association](https://sca.coffee/research) and ` +
    `[Perfect Daily Grind](https://perfectdailygrind.com).\n\n`;

  const faq =
    `## Frequently asked questions about ${kw}\n\n` +
    `### How long does it take to roast specialty coffee?\n` +
    `A typical specialty coffee roast takes 9 to 12 minutes from charge to drop, depending on the ` +
    `machine and the desired profile.\n\n` +
    `### What temperature do you roast specialty coffee at?\n` +
    `Most roasters charge beans between 180 and 200 degrees Celsius and let the bean temperature ` +
    `rise through first crack around 196 degrees.\n\n` +
    `### Is dark roast better for espresso?\n` +
    `Not necessarily — a well-developed medium roast often outperforms dark roasts in clarity and ` +
    `sweetness, which is why third-wave cafés favor it.\n\n`;

  return head + sectionsArr.join("") + images + links + faq;
}

function capitalize(s: string): string {
  return s
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
