import { describe, it, expect } from "vitest";
import { socialTitle, type SocialCaptionContext } from "@/lib/ai/social-caption";

/**
 * socialTitle is the deterministic, no-model-call branch of a social post's
 * title. It is stamped into content.title, so migration 021's denorm trigger
 * sees a real title instead of prefixing the first 80 caption chars. Pinned
 * here because every branch is silent behavior the caption pipeline depends
 * on:
 *   - blog context → "Blog title — Platform"
 *   - social-only  → trimmed topic, else first non-blank keyword,
 *                    else "Social post"
 *   - everything   → hard 80-char cap (the same cap the fallback used to
 *                    bleed into)
 */
const base = (): SocialCaptionContext => ({ tenantId: "t1" });

describe("socialTitle", () => {
  describe("blog-promo captions", () => {
    it("titles after the blog post with a capitalized platform label", () => {
      expect(
        socialTitle(
          {
            ...base(),
            topic: "a topic that must lose to the blog",
            keywords: ["ignored"],
            blog: {
              title: "The Paid Search Slide Deck, Rebuilt",
              slug: "paid-search-deck",
              metaDescription: "meta",
              summary: "summary",
            },
          },
          "instagram"
        )
      ).toBe("The Paid Search Slide Deck, Rebuilt — Instagram");
    });

    it("capitalizes a lowercase platform id", () => {
      expect(
        socialTitle(
          {
            ...base(),
            blog: {
              title: "Five Local SEO Fixes",
              slug: "s",
              metaDescription: "m",
              summary: "s",
            },
          },
          "linkedin"
        )
      ).toBe("Five Local SEO Fixes — Linkedin");
    });

    it("ignores blank topics and blank keywords entirely when a blog exists", () => {
      expect(
        socialTitle(
          {
            ...base(),
            topic: "   ",
            keywords: ["", "   "],
            blog: {
              title: "Brand Voices That Hold Up",
              slug: "b",
              metaDescription: "m",
              summary: "s",
            },
          },
          "twitter"
        )
      ).toBe("Brand Voices That Hold Up — Twitter");
    });
  });

  describe("social-only captions (no blog)", () => {
    it("uses the trimmed topic when one is present", () => {
      expect(
        socialTitle({ ...base(), topic: "  Spring pricing refresh  " }, "facebook")
      ).toBe("Spring pricing refresh");
    });

    it("falls back to the first non-blank keyword when there is no topic", () => {
      expect(
        socialTitle({ ...base(), keywords: ["", "  ", "retainer packages"] }, "tiktok")
      ).toBe("retainer packages");
    });

    it("prefers the topic over keywords", () => {
      expect(
        socialTitle(
          { ...base(), topic: "Q4 launch teaser", keywords: ["first", "second"] },
          "threads"
        )
      ).toBe("Q4 launch teaser");
    });

    it("falls back to \"Social post\" when neither topic nor keywords say anything", () => {
      expect(
        socialTitle({ ...base(), topic: "   ", keywords: ["", "   "] }, "instagram")
      ).toBe("Social post");
      expect(
        socialTitle(
          { ...base(), topic: "", keywords: ["", "   ", "", "  "] },
          "instagram"
        )
      ).toBe("Social post");
    });
  });

  describe("truncation fallback", () => {
    it("caps a long topic at 80 chars", () => {
      const topic = "A".repeat(120);
      const out = socialTitle({ ...base(), topic }, "instagram");
      expect(out).toBe("A".repeat(80));
      expect(out.length).toBe(80);
    });

    it("caps a long fallback keyword at 80 chars", () => {
      const out = socialTitle(
        { ...base(), keywords: ["", "k".repeat(100)] },
        "linkedin"
      );
      expect(out).toBe("k".repeat(80));
    });

    it("does not truncate topics of exactly 80 chars", () => {
      const topic = "x".repeat(80);
      expect(socialTitle({ ...base(), topic }, "facebook")).toBe(topic);
    });

    it("blog-promo titles are NOT capped at 80 — they track the post title", () => {
      const blogTitle = "T".repeat(150);
      const out = socialTitle(
        {
          ...base(),
          blog: { title: blogTitle, slug: "s", metaDescription: "m", summary: "s" },
        },
        "twitter"
      );
      expect(out).toBe(`${blogTitle} — Twitter`);
      expect(out.length).toBe(blogTitle.length + " — Twitter".length);
    });
  });
});
