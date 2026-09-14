/**
 * Social caption generation — shared by both generation paths.
 *
 * Extracted from the generate-content route so the same platform-specific
 * prompt enrichment, parsing, and sanitization serve (a) blog+social
 * generations and (b) social-only generations (Content Map social rows),
 * where there is no blog post to summarize and the caption is written
 * directly from the row's topic, keywords, and brand voice.
 */

import { getSocialCaptionPrompt, PLATFORM_SPECS } from "@/lib/ai/seo-prompts";
import { getDefaultBrandProfile } from "@/lib/brand-profile";
import { buildBrandSystemPrompt } from "@/lib/brand-profile-utils";
import { generateText, type AITask } from "@/lib/ai/orchestrator";
import {
  enforceCaptionSpec,
  enforceCharLimit,
  parseSpecOverrides,
  type SpecOverrides,
} from "@/lib/ai/social-specs";

/**
 * The connected account's spec overrides for this platform (char limit,
 * hashtag cap, image size) — Settings → Social accounts. Best-effort: a
 * missing table, column (pre-migration-104), or credentials failure simply
 * means platform defaults apply. Returns null when nothing is stored.
 */
async function getAccountSpecOverrides(
  tenantId: string,
  platform: string,
  clientId?: string | null
): Promise<SpecOverrides | null> {
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    let query = supabase
      .from("social_accounts")
      .select("spec_overrides")
      .eq("tenant_id", tenantId)
      .eq("platform", platform)
      .not("spec_overrides", "is", null)
      .limit(1);
    if (clientId) query = query.eq("client_id", clientId);
    const { data, error } = await query.maybeSingle();
    if (error) return null;
    const raw = data?.spec_overrides;
    return raw ? parseSpecOverrides(raw) : null;
  } catch {
    return null;
  }
}

export interface SocialCaptionResult {
  caption: string;
  hashtags: string[];
  firstComment: string;
  contentWarnings: string[];
  suggestedImageDescription: string;
}

/**
 * Sanitize a raw caption string into presentable plain text.
 * Handles:
 *  - Leading/trailing whitespace and wrapping quotes
 *  - Double-encoded JSON (a JSON.stringify'd string inside the caption)
 *  - A full JSON object dump landing in the caption field
 */
function toPlainCaption(raw: string | null | undefined): string {
  if (!raw) return "";
  let out = raw.trim();
  // Strip symmetric wrapping quotes.
  if (
    (out.startsWith('"') && out.endsWith('"')) ||
    (out.startsWith("'") && out.endsWith("'"))
  ) {
    out = out.slice(1, -1).trim();
  }
  // A JSON-stringified string inside the caption — unwrap one level.
  if (out.startsWith('"') && out.includes('\\"')) {
    try {
      out = JSON.parse(out) as string;
    } catch {
      // keep the raw text
    }
  }
  // A raw JSON object/array dump is never a usable caption.
  if (/^[[{]/.test(out)) {
    try {
      const parsed = JSON.parse(out) as { caption?: unknown };
      if (typeof parsed?.caption === "string" && parsed.caption.trim()) {
        return toPlainCaption(parsed.caption);
      }
    } catch {
      // not JSON after all — treat as plain text below
    }
    return ""; // it's raw JSON — not a usable caption
  }
  return out;
}

export interface SocialCaptionContext {
  tenantId: string;
  clientId?: string | null;
  workspaceId?: string | null;
  brandVoice?: string | null;
  /** The subject when there is no blog to summarize (social-only rows). */
  topic?: string;
  /** Keywords for a social-only generation; the first is the focus keyword. */
  keywords?: string[];
  /** The blog being promoted. Present for blog+social generations. */
  blog?: {
    title: string;
    slug: string;
    metaDescription: string;
    summary: string;
  };
}

/**
 * One platform's caption: platform-specific system prompt + brand rules,
 * model call, and defensive parsing. Never throws — a malformed caption
 * degrades to sanitized plain text, it doesn't fail the whole generation.
 */
export async function generateSocialCaptionFor(
  platform: string,
  ctx: SocialCaptionContext
): Promise<{ platform: string; caption: SocialCaptionResult }> {
  // Account-level spec overrides (migration 104) tighten the platform
  // defaults — reflected in the prompt AND enforced on the result below.
  const accountOverrides = await getAccountSpecOverrides(
    ctx.tenantId,
    platform,
    ctx.clientId
  );
  const effectiveCharLimit =
    accountOverrides?.charLimit ??
    PLATFORM_SPECS[platform.toLowerCase()]?.charLimit ??
    PLATFORM_SPECS.instagram.charLimit;

  // Enrich the social prompt with platform-specific brand rules.
  let enrichedSocialPrompt = getSocialCaptionPrompt(platform, ctx.brandVoice ?? undefined);
  if (ctx.workspaceId) {
    try {
      const brandRes = await getDefaultBrandProfile();
      if (brandRes.success && brandRes.data) {
        enrichedSocialPrompt += buildBrandSystemPrompt(brandRes.data, platform);
      }
    } catch {
      // brand profile is optional garnish — the base prompt still applies
    }
  }
  const socialSystemPrompt = enrichedSocialPrompt;

  const socialUserPrompt = ctx.blog
    ? `Create a social media caption for ${platform.toUpperCase()} promoting this blog post:

BLOG TITLE: ${ctx.blog.title}
BLOG SLUG: ${ctx.blog.slug}
META DESCRIPTION: ${ctx.blog.metaDescription}
BLOG SUMMARY: ${ctx.blog.summary}...

Use the above context to craft a compelling, platform-optimized caption that drives engagement and clicks.`
    : `Create a standalone social media post for ${platform.toUpperCase()} (there is no blog post — this caption IS the content):

TOPIC: ${ctx.topic ?? ""}
${ctx.keywords && ctx.keywords.length > 0 ? `KEYWORDS TO WEAVE IN: ${ctx.keywords.join(", ")}` : ""}

Write the post itself for ${platform.toUpperCase()}: native to the platform's format, tone, and length conventions, with a hook in the first line and a clear takeaway or call to action. Do not reference "the blog post" or "the article" — nothing is being linked.`;

  const rawCaption = await generateText(
    "social_caption" as AITask,
    socialUserPrompt,
    ctx.tenantId,
    {
      systemPrompt: socialSystemPrompt,
      clientId: ctx.clientId ?? undefined,
      temperature: 0.8,
      // A hard hint so the model sizes the caption before writing it.
      maxTokens: Math.min(2048, Math.max(256, Math.ceil(effectiveCharLimit / 2)) + 128),
    }
  );

  // Parse the JSON string returned by generateText. If the model
  // double-encoded the JSON (caption field containing a JSON string) or
  // returned something malformed, fall through to the plain-text sanitizer
  // so we never store raw JSON as a caption.
  let caption: SocialCaptionResult;
  try {
    const parsedCaption = JSON.parse(rawCaption) as Partial<SocialCaptionResult>;
    const parsedCaptionText = toPlainCaption(parsedCaption?.caption);
    if (parsedCaptionText) {
      const enforced = enforceCaptionSpec(
        parsedCaptionText,
        Array.isArray(parsedCaption.hashtags) ? parsedCaption.hashtags : [],
        platform,
        accountOverrides
      );
      caption = {
        caption: enforced.caption,
        hashtags: enforced.hashtags,
        firstComment: toPlainCaption(parsedCaption.firstComment) || "",
        contentWarnings: Array.isArray(parsedCaption.contentWarnings)
          ? parsedCaption.contentWarnings
          : enforced.truncated
            ? [
                `Caption exceeded the ${platform} limit (${enforced.spec.charLimit} characters) and was truncated.`,
              ]
            : [],
        suggestedImageDescription: toPlainCaption(parsedCaption.suggestedImageDescription) || "",
      };
    } else {
      caption = {
        caption: toPlainCaption(rawCaption) || "Untitled caption",
        hashtags: [],
        firstComment: "",
        contentWarnings: [],
        suggestedImageDescription: "",
      };
    }
  } catch {
    caption = {
      caption: enforceCharLimit(
        toPlainCaption(rawCaption) || "Untitled caption",
        effectiveCharLimit
      ),
      hashtags: [],
      firstComment: "",
      contentWarnings: [],
      suggestedImageDescription: "",
    };
  }

  return { platform, caption };
}
