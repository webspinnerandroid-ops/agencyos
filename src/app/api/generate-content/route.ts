import { NextRequest, NextResponse } from "next/server";
import { getTenantId, requireRole } from "@/lib/auth";
import { createClient } from "@supabase/supabase-js";
import { generateStructuredOutput, generateText } from "@/lib/ai/orchestrator";
import { getBlogPrompt, getSocialCaptionPrompt, getBlogPostSchema } from "@/lib/ai/seo-prompts";
import { generateContentSchema } from "@/lib/validations";
import { incrementUsage } from "@/lib/usage";
import type { AITask } from "@/lib/ai/orchestrator";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import { getDefaultBrandProfile } from "@/lib/brand-profile";
import { buildBrandSystemPrompt } from "@/lib/brand-profile-utils";
import { getWorkspaceKnowledgeContext } from "@/lib/knowledgebase";
import { rateLimitRequest } from "@/lib/rate-limit";

// Known social platforms
const VALID_PLATFORMS = [
  "instagram",
  "twitter",
  "linkedin",
  "facebook",
  "tiktok",
  "threads",
] as const;

/**
 * Sanitize a raw caption string into presentable plain text.
 * Problems handled:
 *  - Markdown/code fences (```json ... ```) wrapping the output
 *  - Double-encoded JSON (a JSON.stringify'd string inside the caption)
 *  - A full JSON object dump landing in the caption field
 * Returns a safe plain-text string, or "" if nothing usable remains.
 */
function toPlainCaption(raw: unknown): string {
  if (typeof raw !== "string") return "";
  let text = raw.trim();
  // Strip markdown code fences (```json ... ``` or ``` ... ```)
  const fenceMatch = text.match(/^```(?:json)?\s*([\s\S]*?)```$/);
  if (fenceMatch) text = fenceMatch[1].trim();
  // If the text is itself a JSON-encoded string ("..."), decode once
  if (text.startsWith('"')) {
    try {
      const decoded = JSON.parse(text);
      if (typeof decoded === "string") text = decoded.trim();
    } catch {
      // not actually JSON — keep as-is
    }
  }
  // Reject if it's still a JSON object/array dump — never store raw JSON as a caption
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      JSON.parse(text);
      return ""; // it's raw JSON — not a usable caption
    } catch {
      // starts with { or [ but isn't valid JSON — treat as plain text
    }
  }
  return text;
}

interface BlogPostResult {
  title: string;
  slug: string;
  metaDescription: string;
  headings: { level: number; text: string }[];
  body: string;
  suggestedImagePrompt: string;
}

interface SocialCaptionResult {
  caption: string;
  hashtags: string[];
  firstComment: string;
  contentWarnings: string[];
  suggestedImageDescription: string;
}

export async function POST(request: NextRequest) {
  try {
    // ------------------------------------------------------------------
    // 0. Rate limit (abuse protection — each generation burns LLM tokens)
    // ------------------------------------------------------------------
    const rl = rateLimitRequest(request, "generate-content", 10);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Rate limit exceeded. Try again in ${rl.retryAfterSeconds}s.` },
        {
          status: 429,
          headers: { "Retry-After": String(rl.retryAfterSeconds) },
        }
      );
    }

    // ------------------------------------------------------------------
    // 1. Authenticate & authorize
    // ------------------------------------------------------------------
    const tenantId = await getTenantId();
    await requireRole("agency_editor");

    // ------------------------------------------------------------------
    // 2. Parse & validate body
    // ------------------------------------------------------------------
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const parsed = generateContentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const { clientId, topic, brandVoice, platforms } = parsed.data;

    // Validate that all requested platforms are known
    const invalidPlatforms = platforms.filter(
      (p) => !(VALID_PLATFORMS as readonly string[]).includes(p)
    );
    if (invalidPlatforms.length > 0) {
      return NextResponse.json(
        {
          error: `Invalid platform(s): ${invalidPlatforms.join(", ")}`,
          validPlatforms: VALID_PLATFORMS,
        },
        { status: 400 }
      );
    }

    // ------------------------------------------------------------------
    // 2.5. Enrich prompts with workspace context (brand profile + knowledgebase)
    // ------------------------------------------------------------------
    const workspaceId = await getCurrentWorkspaceId();
    let workspaceContext = "";

    if (workspaceId) {
      try {
        // Load brand profile
        const brandRes = await getDefaultBrandProfile();
        if (brandRes.success && brandRes.data) {
          workspaceContext += buildBrandSystemPrompt(brandRes.data);
        }

        // Load knowledgebase
        const kbContext = await getWorkspaceKnowledgeContext(workspaceId, tenantId);
        if (kbContext) {
          workspaceContext += "\n\n" + kbContext;
        }
      } catch (err) {
        console.warn("[generate-content] Could not load workspace context:", err);
      }
    }

    // ------------------------------------------------------------------
    // 3. Generate the blog post (structured output)
    // ------------------------------------------------------------------
    const blogSystemPrompt = getBlogPrompt(brandVoice, {
      primaryKeyword: topic,
    }) + workspaceContext;

    const blogUserPrompt = `Write a comprehensive blog post about: "${topic}". ${
      brandVoice ? `Use this brand voice: ${brandVoice}.` : ""
    }`;

    // Helper to count words in a string
    const countWords = (text: string) =>
      text.split(/\s+/).filter((w) => w.length > 0).length;

    // Brand-aware word target: respect the profile's max_word_count
    // (presets cap at 200-800 for e.g. ecommerce) and never demand more
    // than the model can emit as valid JSON (~2000 words). The old
    // hard-coded 2500+ caused truncated JSON responses and repeated
    // retries ("Failed to parse JSON response").
    const MAX_MODEL_BLOG_WORDS = 2000;
    let brandMaxWords = 0;
    const brandMaxMatch = workspaceContext.match(/max_word_count(?::|\s*=)\s*(\d+)/);
    if (brandMaxMatch) brandMaxWords = parseInt(brandMaxMatch[1], 10);
    const MIN_BLOG_WORDS = brandMaxWords > 0
      ? Math.min(brandMaxWords, MAX_MODEL_BLOG_WORDS)
      : 1200;

    let blogPost = await generateStructuredOutput<BlogPostResult>(
      "blog_generation" as AITask,
      blogSystemPrompt,
      blogUserPrompt,
      tenantId,
      getBlogPostSchema(),
      {
        clientId,
        functionName: "generate_blog_post",
      }
    );

    const blogWordCount = countWords(blogPost.body);
    console.log(`[generate-content] Blog word count: ${blogWordCount} (min: ${MIN_BLOG_WORDS})`);

    // If the generated post is too short, retry with explicit length instruction
    // and increased maxTokens to give the model room to expand
    if (blogWordCount < MIN_BLOG_WORDS) {
      console.warn(
        `[generate-content] Blog too short (${blogWordCount} words). Retrying with 2500+ word requirement...`
      );
      const enrichedSystemPrompt =
        blogSystemPrompt +
        `\n\nCRITICAL: The blog post body MUST be at least 2500 words. Write thorough, detailed content with multiple H2 sections, examples, data points, and actionable insights. Do NOT write thin or shallow content. This will be published on a professional website and must demonstrate expertise.`;
      const enrichedUserPrompt =
        blogUserPrompt +
        `\n\nIMPORTANT: Write at least 2500 words of substantive content.`;

      blogPost = await generateStructuredOutput<BlogPostResult>(
        "blog_generation" as AITask,
        enrichedSystemPrompt,
        enrichedUserPrompt,
        tenantId,
        getBlogPostSchema(),
        {
          clientId,
          functionName: "generate_blog_post",
          maxTokens: 32768,
        }
      );
    }

    // ------------------------------------------------------------------
    // 4. Generate social captions in parallel for each platform
    // ------------------------------------------------------------------
    const socialCaptionPromises = platforms.map(
      async (platform): Promise<{ platform: string; caption: SocialCaptionResult }> => {
        // Enrich social prompt with platform-specific brand rules
        let enrichedSocialPrompt = getSocialCaptionPrompt(platform, brandVoice);
        if (workspaceId) {
          try {
            const brandRes = await getDefaultBrandProfile();
            if (brandRes.success && brandRes.data) {
              enrichedSocialPrompt += buildBrandSystemPrompt(brandRes.data, platform);
            }
          } catch {}
        }
        const socialSystemPrompt = enrichedSocialPrompt;

        // Build a contextual prompt that references the blog content
        const socialUserPrompt = `Create a social media caption for ${platform.toUpperCase()} promoting this blog post:

BLOG TITLE: ${blogPost.title}
BLOG SLUG: ${blogPost.slug}
META DESCRIPTION: ${blogPost.metaDescription}
BLOG SUMMARY: ${blogPost.body.substring(0, 800)}...

Use the above context to craft a compelling, platform-optimized caption that drives engagement and clicks.`;

        const rawCaption = await generateText(
          "social_caption" as AITask,
          socialUserPrompt,
          tenantId,
          {
            systemPrompt: socialSystemPrompt,
            clientId,
            temperature: 0.8,
          }
        );

        // Parse the JSON string returned by generateText
        let caption: SocialCaptionResult;
        try {
          const parsedCaption = JSON.parse(rawCaption) as Partial<SocialCaptionResult>;
          // Validate the shape: caption must be a non-empty string. If the
          // model double-encoded the JSON (caption field containing a JSON
          // string) or returned something malformed, fall through to the
          // plain-text sanitizer so we never store raw JSON as a caption.
          const parsedCaptionText = toPlainCaption(parsedCaption?.caption);
          if (parsedCaptionText) {
            caption = {
              caption: parsedCaptionText,
              hashtags: Array.isArray(parsedCaption.hashtags) ? parsedCaption.hashtags : [],
              firstComment: toPlainCaption(parsedCaption.firstComment) || "",
              contentWarnings: Array.isArray(parsedCaption.contentWarnings) ? parsedCaption.contentWarnings : [],
              suggestedImageDescription: toPlainCaption(parsedCaption.suggestedImageDescription) || "",
            };
          } else {
            // The parsed result had no usable caption text — extract plain text
            caption = {
              caption: toPlainCaption(rawCaption) || "Untitled caption",
              hashtags: [],
              firstComment: "",
              contentWarnings: [],
              suggestedImageDescription: "",
            };
          }
        } catch {
          // If parsing fails, wrap the raw (sanitized) text as the caption
          caption = {
            caption: toPlainCaption(rawCaption) || "Untitled caption",
            hashtags: [],
            firstComment: "",
            contentWarnings: [],
            suggestedImageDescription: "",
          };
        }

        return { platform, caption };
      }
    );

    const socialResults = await Promise.all(socialCaptionPromises);

    // ------------------------------------------------------------------
    // 5. Save to the database
    // ------------------------------------------------------------------

    // Get user ID from the authenticated client (cookie-aware)
    const { createServerClient } = await import("@supabase/ssr");
    const { cookies: nextCookies } = await import("next/headers");
    const cookieStore = await nextCookies();
    const userClient = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll(); },
          setAll() {},
        },
      }
    );
    const { data: { user } } = await userClient.auth.getUser();
    const userId = user?.id ?? null;

    // Use admin client for DB writes (bypasses RLS)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Insert the blog post
    const { data: blogPostRow, error: blogError } = await supabase
      .from("posts")
      .insert({
        tenant_id: tenantId,
        client_id: clientId ?? null,
        content: {
          type: "blog",
          title: blogPost.title,
          slug: blogPost.slug,
          metaDescription: blogPost.metaDescription,
          headings: blogPost.headings,
          body: blogPost.body,
          suggestedImagePrompt: blogPost.suggestedImagePrompt,
          topic,
          brandVoice,
        },
        status: "draft",
        created_by: userId,
        ai_generated: true,
      })
      .select("*")
      .single();

    if (blogError) {
      console.error("[generate-content] Error saving blog post:", blogError);
      return NextResponse.json(
        { error: "Failed to save blog post", details: blogError },
        { status: 500 }
      );
    }

    // Insert social posts
    const socialPostRows: unknown[] = [];
    for (const { platform, caption } of socialResults) {
      const { data: socialPost, error: socialError } = await supabase
        .from("posts")
        .insert({
          tenant_id: tenantId,
          client_id: clientId ?? null,
          content: {
            type: "social",
            platform,
            caption: caption.caption,
            hashtags: caption.hashtags,
            firstComment: caption.firstComment,
            contentWarnings: caption.contentWarnings,
            suggestedImageDescription: caption.suggestedImageDescription,
            blogPostId: blogPostRow.id,
          },
          status: "draft",
          created_by: userId,
          ai_generated: true,
        })
        .select("*")
        .single();

      if (socialError) {
        console.error(
          `[generate-content] Error saving social post for ${platform}:`,
          socialError
        );
        // Continue saving other social posts even if one fails
      } else if (socialPost) {
        socialPostRows.push(socialPost);

        // Insert post_platforms row if social_accounts exist for this tenant+platform
        const { data: socialAccount } = await supabase
          .from("social_accounts")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("platform", platform)
          .limit(1)
          .single();

        if (socialAccount) {
          await supabase.from("post_platforms").insert({
            post_id: socialPost.id,
            social_account_id: socialAccount.id,
            status: "queued",
          });
        }
      }
    }

    // ------------------------------------------------------------------
    // 6. Increment usage counters for billing
    // ------------------------------------------------------------------
    // Fire-and-forget: don't block the response on usage tracking
    void incrementUsage(tenantId, "blog_posts", 1);
    void incrementUsage(tenantId, "social_posts", platforms.length);
    // Rough estimate: ~5000 tokens per blog + ~1000 per social caption
    void incrementUsage(tenantId, "ai_tokens", 5000 + platforms.length * 1000);

    // ------------------------------------------------------------------
    // 7. Build the response
    // ------------------------------------------------------------------
    const finalWordCount = countWords(blogPost.body);

    return NextResponse.json({
      success: true,
      blogPost: {
        id: blogPostRow.id,
        title: blogPost.title,
        slug: blogPost.slug,
        metaDescription: blogPost.metaDescription,
        headings: blogPost.headings,
        body: blogPost.body,
        wordCount: finalWordCount,
        suggestedImagePrompt: blogPost.suggestedImagePrompt,
        status: blogPostRow.status,
      },
      socialPosts: socialResults.map(({ platform, caption }, index) => ({
        platform,
        id: socialPostRows[index] ? (socialPostRows[index] as { id: string }).id : undefined,
        ...caption,
      })),
    });
  } catch (error) {
    console.error("[generate-content] Unexpected error:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}