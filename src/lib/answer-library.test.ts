import { describe, it, expect } from "vitest";
import { dedupeEntries, buildAnswerFaqSchema } from "./answer-library";

describe("dedupeEntries", () => {
  const entries = [
    { q: "What is cold brew?", a: "Steeped coffee.", postId: "p1" },
    { q: "what is Cold Brew?", a: "Better answer from the newer post.", postId: "p2" },
    { q: "How long does it keep?", a: "Two weeks.", postId: "p1" },
    { q: "", a: "Orphan answer.", postId: "p3" },
    { q: "No answer?", a: "", postId: "p3" },
  ];

  it("keeps the highest-scored post's answer per question", () => {
    const out = dedupeEntries(entries, (postId) => (postId === "p2" ? 91 : 74));
    expect(out).toHaveLength(2);
    const dupe = out.find((e) => e.q.toLowerCase() === "what is cold brew?");
    expect(dupe?.a).toBe("Better answer from the newer post.");
    expect(dupe?.postId).toBe("p2");
  });

  it("is deterministic: score desc, then question asc", () => {
    const out = dedupeEntries(entries, () => 80);
    const scores = out.map(() => 80);
    expect(scores).toEqual([80, 80]);
    expect(out.map((e) => e.q)).toEqual([...out.map((e) => e.q)].sort((a, b) => a.localeCompare(b)));
  });

  it("drops empty questions and answers", () => {
    const out = dedupeEntries(entries, () => 0);
    expect(out.every((e) => e.q.trim() && e.a.trim())).toBe(true);
  });
});

describe("buildAnswerFaqSchema", () => {
  it("emits valid FAQPage JSON-LD with mainEntity questions", () => {
    const json = buildAnswerFaqSchema([
      { q: "What is AEO?", a: "Answer engine optimization." },
      { q: "What is GEO?", a: "Generative engine optimization." },
    ]);
    const parsed = JSON.parse(json);
    expect(parsed["@context"]).toBe("https://schema.org");
    expect(parsed["@type"]).toBe("FAQPage");
    expect(parsed.mainEntity).toHaveLength(2);
    expect(parsed.mainEntity[0]["@type"]).toBe("Question");
    expect(parsed.mainEntity[0].acceptedAnswer["@type"]).toBe("Answer");
    expect(parsed.mainEntity[0].acceptedAnswer.text).toBe("Answer engine optimization.");
  });

  it("escapes angle brackets so answers can't break out of a script tag", () => {
    const json = buildAnswerFaqSchema([
      { q: "Safe?", a: "</script><script>alert(1)</script>" },
    ]);
    expect(json).not.toContain("</script>");
    expect(JSON.parse(json).mainEntity[0].acceptedAnswer.text).toContain("<script>");
  });

  it("caps the emitted questions at 50 and skips blank pairs", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ q: `Q${i}`, a: `A${i}` }));
    many.push({ q: "   ", a: "blank" });
    const parsed = JSON.parse(buildAnswerFaqSchema(many));
    expect(parsed.mainEntity).toHaveLength(50);
  });
});
