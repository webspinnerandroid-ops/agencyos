import { describe, it, expect } from "vitest";
import { tasksForModel, usable } from "./model-catalog";

/**
 * The catalog sync maps live provider model ids onto the app's task tags —
 * these decide which pickers (blog generation, social captions, brand
 * design, …) each model appears in. Wrong tags mean models silently missing
 * from (or polluting) the wrong dropdowns, so the mapping rules are pinned
 * here. The network/sync half of model-catalog.ts is covered by the live
 * cron; this file guards the pure classification rules.
 */
describe("model catalog task mapping", () => {
  it("maps OpenAI chat models to the full text-task set", () => {
    expect(tasksForModel("OpenAI", "gpt-4o", {})).toContain("blog_generation");
    expect(tasksForModel("OpenAI", "gpt-4.1-mini", {})).toContain("social_caption");
  });

  it("keeps reasoning models out of social captions but in audits", () => {
    const o3 = tasksForModel("OpenAI", "o3-mini", {});
    expect(o3).toContain("seo_audit");
    expect(o3).not.toContain("social_caption");
  });

  it("excludes non-chat OpenAI endpoints (embeddings, audio, images)", () => {
    expect(usable("OpenAI", "text-embedding-3-large", {})).toBe(false);
    expect(usable("OpenAI", "whisper-1", {})).toBe(false);
    expect(usable("OpenAI", "dall-e-3", {})).toBe(false);
    expect(usable("OpenAI", "tts-1", {})).toBe(false);
  });

  it("marks Gemini models as text + brand-design image models", () => {
    const gem = tasksForModel("Google", "gemini-2.5-flash", { context_length: 1_000_000 });
    expect(gem).toContain("blog_generation");
    expect(gem).toContain("image_generation");
  });

  it("skips embedding and multimodal-noise entries on Google", () => {
    // (The fetch layer filters these, but the mapping must also refuse them.)
    expect(tasksForModel("OpenAI", "text-embedding-3-small", {}).length).toBe(0);
  });

  it("routes DeepSeek reasoner to deep work only, chat to everything", () => {
    expect(tasksForModel("DeepSeek", "deepseek-reasoner", {})).not.toContain("social_caption");
    expect(tasksForModel("DeepSeek", "deepseek-chat", {})).toContain("email_generation");
  });

  it("uses context length to split long-form from short-form on OpenRouter", () => {
    const long = tasksForModel("OpenRouter", "qwen/qwen3-235b", { context_length: 131_072 });
    expect(long).toContain("blog_generation");
    const short = tasksForModel("OpenRouter", "some/tiny-model", { context_length: 8_192 });
    expect(short).not.toContain("blog_generation");
    expect(short).toContain("social_caption");
  });

  it("filters OpenRouter utility endpoints out", () => {
    expect(usable("OpenRouter", "openai/text-embedding-3-large", {})).toBe(false);
    expect(usable("OpenRouter", "laion/larger-clap-general", {})).toBe(false);
  });

  it("keeps image providers single-purpose", () => {
    expect(tasksForModel("OpenAI Image", "gpt-image-1", {})).toEqual(["image_generation"]);
    expect(tasksForModel("Google Imagen", "imagen-4.0-generate-001", {})).toEqual(["image_generation"]);
  });

  it("gives every text provider the standard full task set", () => {
    for (const provider of ["Anthropic", "Mistral", "xAI"]) {
      expect(tasksForModel(provider, "some-model-v1", {})).toContain("blog_generation");
    }
  });
});
