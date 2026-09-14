/**
 * Social platform specs — resolution + enforcement.
 *
 * PLATFORM_SPECS (src/lib/ai/seo-prompts.ts) defines per-PLATFORM defaults.
 * A connected account (social_accounts.spec_overrides) can override parts of
 * its platform's spec — e.g. a client whose brand guide caps hashtags at 3,
 * or a longer-form LinkedIn presence. This module resolves the effective spec
 * for a platform/account pair and ENFORCES the hard char limit on generated
 * captions: prompts help the model aim right, but the validator guarantees
 * the number — a caption that exceeds the limit is truncated at a sentence
 * boundary (never mid-word) before anything is saved.
 */

import { PLATFORM_SPECS } from "@/lib/ai/seo-prompts";

/** What one account may override, on top of its platform's defaults. */
export interface SpecOverrides {
  /** Hard caption character limit (replaces the platform default). */
  charLimit?: number;
  /** Max hashtags in the caption + first comment (advisory — enforced softly). */
  hashtagCount?: number;
  /** Preferred image size string, e.g. "1080×1350" (advisory). */
  imageSize?: string;
}

export interface ResolvedSpec {
  charLimit: number;
  sweetSpot: string;
  imageSize: string;
  hashtagCount?: number;
  /** Where each field came from — the settings UI shows this. */
  source: "platform" | "account";
  overrides: SpecOverrides;
}

/**
 * Normalize an account's spec_overrides JSONB column. Accepts a subset of
 * known keys; garbage types and non-positive numbers are ignored (fall back
 * to the platform default) rather than trusted.
 */
export function parseSpecOverrides(raw: unknown): SpecOverrides {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const obj = raw as Record<string, unknown>;
  const out: SpecOverrides = {};
  if (typeof obj.charLimit === "number" && Number.isFinite(obj.charLimit) && obj.charLimit >= 40) {
    out.charLimit = Math.floor(obj.charLimit);
  }
  if (
    typeof obj.hashtagCount === "number" &&
    Number.isFinite(obj.hashtagCount) &&
    obj.hashtagCount >= 0
  ) {
    out.hashtagCount = Math.floor(obj.hashtagCount);
  }
  if (typeof obj.imageSize === "string" && obj.imageSize.trim()) {
    out.imageSize = obj.imageSize.trim().slice(0, 60);
  }
  return out;
}

/**
 * The effective spec for one platform/account pair: the platform default with
 * any account overrides applied. Unknown platforms fall back to Instagram's
 * shape (the platformGuides fallback in getSocialCaptionPrompt does the same).
 */
export function resolveSpec(
  platform: string,
  overrides?: SpecOverrides | null
): ResolvedSpec {
  const platformDefault =
    PLATFORM_SPECS[platform.toLowerCase()] ?? PLATFORM_SPECS.instagram;
  const o = overrides ?? {};
  const applied: SpecOverrides = {};
  if (typeof o.charLimit === "number") {
    applied.charLimit = o.charLimit;
  }
  if (typeof o.hashtagCount === "number") {
    applied.hashtagCount = o.hashtagCount;
  }
  if (typeof o.imageSize === "string") {
    applied.imageSize = o.imageSize;
  }
  const anyApplied = Object.keys(applied).length > 0;
  return {
    charLimit: applied.charLimit ?? platformDefault.charLimit,
    sweetSpot: platformDefault.sweetSpot,
    imageSize: applied.imageSize ?? platformDefault.imageSize,
    hashtagCount: applied.hashtagCount,
    source: anyApplied ? "account" : "platform",
    overrides: applied,
  };
}

/**
 * Hard-enforce the caption character limit post-parse.
 *
 * Truncation strategy (in order): cut at the last sentence boundary before
 * the limit; if no sentence end fits, cut at the last word boundary; only
 * then hard-cut. Appends "…" when anything was removed. Trailing whitespace
 * and dangling punctuation are cleaned up. Never throws — a caption always
 * comes back.
 */
export function enforceCharLimit(caption: string, charLimit: number): string {
  const limit = Math.max(20, Math.floor(charLimit));
  if (caption.length <= limit) return caption;

  const slice = caption.slice(0, limit);
  // Prefer the last complete sentence that fits (., !, ?, or closing pair).
  const sentenceEnd = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("! "),
    slice.lastIndexOf("? "),
    slice.lastIndexOf(".\n"),
    slice.lastIndexOf("!\n"),
    slice.lastIndexOf("?\n")
  );
  if (sentenceEnd > limit * 0.4) {
    return slice.slice(0, sentenceEnd + 1).trimEnd() + " …";
  }
  // Fall back to the last word boundary.
  const wordEnd = Math.max(slice.lastIndexOf(" "), slice.lastIndexOf("\n"));
  if (wordEnd > limit * 0.4) {
    return slice.slice(0, wordEnd).trimEnd().replace(/[,;:–—-]+$/, "") + " …";
  }
  return slice.trimEnd() + " …";
}

/**
 * Full enforcement for a generated caption: resolve the spec, truncate the
 * caption to the hard limit, and trim the hashtag list to an account cap
 * when one is set (platform guidance stays prompt-level; a per-account cap
 * is explicit and gets enforced). Returns the caption untouched when it fits.
 */
export function enforceCaptionSpec(
  caption: string,
  hashtags: string[],
  platform: string,
  overrides?: SpecOverrides | null
): { caption: string; hashtags: string[]; spec: ResolvedSpec; truncated: boolean; hashtagsTrimmed: boolean } {
  const spec = resolveSpec(platform, overrides);
  const truncated = caption.length > spec.charLimit;
  const safeCaption = truncated ? enforceCharLimit(caption, spec.charLimit) : caption;
  const cap = spec.hashtagCount;
  const safeHashtags =
    typeof cap === "number" && hashtags.length > cap ? hashtags.slice(0, cap) : hashtags;
  return {
    caption: safeCaption,
    hashtags: safeHashtags,
    spec,
    truncated,
    hashtagsTrimmed: safeHashtags.length !== hashtags.length,
  };
}
