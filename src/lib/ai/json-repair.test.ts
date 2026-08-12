import { describe, it, expect } from "vitest";
import { repairTruncatedJson } from "./json-repair";

describe("repairTruncatedJson", () => {
  it("parses complete JSON unchanged", () => {
    const raw = JSON.stringify({ title: "Hi", headings: [{ level: 1, text: "x" }] });
    expect(repairTruncatedJson(raw)).toEqual({
      title: "Hi",
      headings: [{ level: 1, text: "x" }],
    });
  });

  it("salvages the user-reported case: cut mid-array inside a string, no closing brace anywhere", () => {
    // The exact shape from the bug report — the model ran out of output
    // tokens in the middle of the headings array.
    const raw = `{ "title": "Why Can't We Be Friends? (The Answer Will Make You Laugh)", "slug": "why-cant-we-be-friends-laugh-answer", "metaDescription": "Ever wondered why can't we be friends?", "headings": [ { "level": 1, "text": "Why Can't We Be Friends? The Hilarious, Pointed Truth" }, { "level": 2, "text": "The Song That Started It All (And Why It's Still Annoying)" }, { "level": 2, "text": "The second heading's text is cut mid-str`;
    const result = repairTruncatedJson(raw) as {
      title: string;
      headings: { level: number; text: string }[];
    };
    expect(result).not.toBeNull();
    expect(result.title).toBe("Why Can't We Be Friends? (The Answer Will Make You Laugh)");
    expect(result.headings).toHaveLength(2);
    expect(result.headings[1].text).toBe("The Song That Started It All (And Why It's Still Annoying)");
    // The partial third heading is dropped, not garbage.
    expect(result.headings.every((h) => typeof h.text === "string")).toBe(true);
  });

  it("closes unclosed root object when cut after a complete value", () => {
    const raw = `{"title": "Hello", "metaDescription": "World"`;
    expect(repairTruncatedJson(raw)).toEqual({ title: "Hello", metaDescription: "World" });
  });

  it("closes nested containers when cut inside them", () => {
    const raw = `{"a": {"b": [1, 2, 3], "c": {"d": 4`;
    expect(repairTruncatedJson(raw)).toEqual({ a: { b: [1, 2, 3], c: { d: 4 } } });
  });

  it("drops a trailing comma before closing", () => {
    const raw = `{"a": 1, "b": 2,`;
    expect(repairTruncatedJson(raw)).toEqual({ a: 1, b: 2 });
  });

  it("returns null when cut inside a string with no completed container before it", () => {
    // Nothing complete to salvage — caller must retry with more tokens.
    const raw = `{"body": "This is a long paragraph that gets trunc`;
    expect(repairTruncatedJson(raw)).toBeNull();
  });

  it("keeps complete values before a cut-in-string tail", () => {
    // The first key/value pair is complete; the trailing broken string is
    // dropped and the root object is closed.
    const raw = `{"a": 1, "b": "partial str`;
    expect(repairTruncatedJson(raw)).toEqual({ a: 1 });
  });

  it("returns null for hopeless input", () => {
    expect(repairTruncatedJson("")).toBeNull();
    expect(repairTruncatedJson("not json at all")).toBeNull();
    expect(repairTruncatedJson("{")).toBeNull();
  });

  it("handles arrays of objects cut mid-way", () => {
    const raw = `[{"id": 1, "name": "one"}, {"id": 2, "name": "tw`;
    expect(repairTruncatedJson(raw)).toEqual([{ id: 1, name: "one" }]);
  });

  it("handles strings containing colons and braces (not confused with structure)", () => {
    const raw = `{"url": "https://example.com:8080/path?x={1}", "note": "ok`;
    const result = repairTruncatedJson(raw) as { url?: string; note?: string };
    expect(result).not.toBeNull();
    expect(result.url).toBe("https://example.com:8080/path?x={1}");
  });
});
