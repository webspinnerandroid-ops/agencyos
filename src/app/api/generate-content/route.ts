import { NextRequest, NextResponse } from "next/server";
import { getTenantId, requireRole } from "@/lib/auth";
import { createClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import { generateStructuredOutput, generateText, generateImage } from "@/lib/ai/orchestrator";
import { getBlogPrompt, getSocialCaptionPrompt, getBlogPostSchema } from "@/lib/ai/seo-prompts";
import { generateContentSchema } from "@/lib/validations";
import { incrementUsage } from "@/lib/usage";
import type { AITask } from "@/lib/ai/orchestrator";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import { getDefaultBrandProfile } from "@/lib/brand-profile";
import { buildBrandSystemPrompt } from "@/lib/brand-profile-utils";
import {
  getWorkspaceKnowledgeContext,
  getWorkspaceLinkablePages,
} from "@/lib/knowledgebase";
import {
  resolveInternalLinks,
  buildInternalLinkContext,
  appendRelatedReading,
} from "@/lib/content-links";
import { rateLimitRequest } from "@/lib/rate-limit";
import { checkTrialContentLimit } from "@/lib/trial-limits";
import { checkUsageLimit } from "@/lib/plan-limits";
import { checkTokenBalance } from "@/lib/token-billing";
import { persistImageToStorage } from "@/lib/media/storage";
import {
  MAX_BLOG_IMAGES,
  selectBlogImageSpecs,
  injectImagesIntoBody,
  extractImagePlaceholders,
  type BlogImageSpec,
  type GeneratedBlogImage,
} from "@/lib/blog-images";
import { scoreContent, type SeoScoreResult } from "@/lib/seo-scorer";
import { scoreAeoGeo, type AeoGeoResult } from "@/lib/aeo-geo";
import { buildWpSeoMeta, schemaPreview, type SchemaSelection } from "@/lib/seo/wp-seo-meta";
import {
  getScoreGate,
  MAX_SCORE_ATTEMPTS,
  isBelowGate,
  buildGateFeedback,
  ScoreGateError,
  mapReusedImages,
} from "@/lib/score-gate";
import { researchTopic, type TopicResearch } from "@/lib/ai/research";

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
/**
 * True when a PostgREST error is a transient origin/gateway failure that's
 * worth recovering from (Cloudflare 520/502/503 and friends). A 4xx is a
 * real rejection — never retried.
 */
function isRetryableOriginError(error: unknown): boolean {
  const err = (error ?? {}) as {
    status?: number;
    code?: string | number;
    error_code?: number | string;
    retryable?: boolean;
  };
  if (err.retryable === true) return true;
  const status = err.status ?? Number(err.error_code ?? err.code);
  return status === 520 || status === 502 || status === 503 || status >= 500;
}

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
  images: BlogImageSpec[];
  suggestedImagePrompt?: string; // legacy fallback if model omits images
}

/**
 * Generates an image for each spec (capped), saves them to media_assets so
 * they appear in the images page history, and returns url + spec pairs.
 * Failures are isolated per image — a broken provider key or rate limit on
 * one image never fails the whole blog generation.
 */
async function generateBlogImages(
  tenantId: string,
  clientId: string | null | undefined,
  specs: BlogImageSpec[],
  postTitle: string,
  imageCount: number = MAX_BLOG_IMAGES
): Promise<GeneratedBlogImage[]> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const workspaceId = await getCurrentWorkspaceId().catch(() => null);

  // Cap + de-duplicate: at most `imageCount` total, never two images for
  // the same section (that is what caused stacked images).
  const capped = selectBlogImageSpecs(specs, imageCount);

  const results: GeneratedBlogImage[] = [];

  await Promise.all(
    capped.map(async (spec) => {
      try {
        // Featured image is the wide hero; inline images are square-ish.
        const size =
          spec.placement === "featured" ? "1792x1024" : "1024x1024";
        const images = await generateImage(tenantId, spec.prompt, {
          size: size as "1792x1024" | "1024x1024",
          n: 1,
          clientId: clientId ?? undefined,
        });

        const rawUrl = images[0]?.url;
        if (!rawUrl) {
          console.warn(
            `[generate-content] Image provider returned no image for "${spec.sectionTitle || "featured"}"`
          );
          return;
        }

        // Persist to storage: Google Imagen returns ~2-3 MB base64 data-URLs,
        // and embedding those raw in posts.content made every post megabytes
        // large (8 MB posts, 50 MB image lists, gateway 520s). The body and
        // media_assets now hold only the short public storage URL.
        const url = await persistImageToStorage(tenantId, rawUrl);

        // Persist to media_assets so it lands in the images page history.
        // The SEO payload (alt text + unique title) is what makes the asset
        // SEO-friendly when it ships inside a page.
        const altText =
          spec.description && spec.description.trim().length > 0
            ? spec.description.trim()
            : `${postTitle}: ${spec.sectionTitle || "featured image"}`;
        const { data: assetRow, error: assetErr } = await supabase
          .from("media_assets")
          .insert({
            tenant_id: tenantId,
            client_id: clientId ?? null,
            workspace_id: workspaceId,
            type: "image",
            prompt: spec.prompt,
            url,
            alt_text: altText,
            metadata: {
              placement: spec.placement,
              sectionTitle: spec.sectionTitle,
              seo: {
                altText,
                // Page-unique image title: post title + section context.
                title: `${postTitle}${spec.sectionTitle ? ` — ${spec.sectionTitle}` : " — featured"}`,
                description: spec.description || spec.sectionTitle || postTitle,
              },
            },
            status: "completed",
          })
          .select("id")
          .single();
        if (assetErr) {
          console.warn(
            "[generate-content] Failed to save generated image to media_assets:",
            assetErr.message
          );
        }

        // Keep the asset id so the post flow can stamp the final
        // SEO/AEO/GEO scores onto the card in the Asset Library.
        results.push({ spec, url, assetId: assetRow?.id ?? null });
        void incrementUsage(tenantId, "image_generations", 1);
        void incrementUsage(tenantId, "ai_tokens", 1000);
      } catch (err) {
        console.warn(
          `[generate-content] Image generation failed for "${spec.sectionTitle || "featured"}":`,
          err instanceof Error ? err.message : err
        );
      }
    })
  );

  return results.sort((a, b) =>
    (a.spec.placement === "featured" ? 0 : 1) - (b.spec.placement === "featured" ? 0 : 1)
  );
}

/**
 * Maps user-uploaded images onto the model's image specs so they land in the
 * same spots AI images would (featured hero first, then per-section inline).
 * When the model returned no specs (e.g. truncated JSON), placement is derived
 * from the upload order: first upload is featured, the rest inline.
 */
function attachUploadedImages(
  uploaded: { url: string; placement: "featured" | "inline"; description?: string }[],
  modelSpecs: BlogImageSpec[]
): GeneratedBlogImage[] {
  const specs = selectBlogImageSpecs(modelSpecs, uploaded.length);
  return uploaded.map((img, i) => {
    const fallback: BlogImageSpec = {
      prompt: "",
      placement: img.placement === "featured" || i === 0 ? "featured" : "inline",
      sectionTitle: "",
      description: img.description?.trim() || `Uploaded image ${i + 1}`,
    };
    const spec = specs[i] ?? fallback;
    return {
      spec: {
        ...spec,
        prompt: "",
        description: img.description?.trim() || spec.description,
      },
      url: img.url,
    };
  });
}

/**
 * Saves user-uploaded images to media_assets so they also appear in the
 * images page history, matching the generated-image path.
 */
async function persistUploadedImages(
  tenantId: string,
  clientId: string | null | undefined,
  images: GeneratedBlogImage[],
  postTitle: string
): Promise<void> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  const workspaceId = await getCurrentWorkspaceId().catch(() => null);

  for (const img of images) {
    const altText =
      img.spec.description && img.spec.description.trim().length > 0
        ? img.spec.description.trim()
        : `${postTitle}: ${img.spec.placement === "featured" ? "featured image" : "inline image"}`;
    const { data: assetRow, error } = await supabase
      .from("media_assets")
      .insert({
        tenant_id: tenantId,
        client_id: clientId ?? null,
        workspace_id: workspaceId,
        type: "image",
        prompt: "",
        url: img.url,
        alt_text: altText,
        metadata: {
          placement: img.spec.placement,
          sectionTitle: img.spec.sectionTitle,
          source: "upload",
        },
        status: "completed",
      })
      .select("id")
      .single();
    if (error) {
      console.warn(
        "[generate-content] Failed to save uploaded image to media_assets:",
        error.message
      );
    } else if (assetRow?.id) {
      // The caller holds the same array — stamp the id so scores can be
      // attached to uploaded images too.
      img.assetId = assetRow.id;
    }
  }
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
    // 1.5 Token-billing balance gate — when the monthly allowance + add-on
    // balance are exhausted, return a structured "buy more tokens" response
    // instead of silently failing mid-generation.
    // ------------------------------------------------------------------
    const bal = await checkTokenBalance(tenantId);
    if (!bal.allowed) {
      return NextResponse.json(
        {
          error: bal.reason,
          buyMoreTokens: true,
          balance: bal.balance,
        },
        { status: 402 }
      );
    }

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

    const {
      clientId,
      topic,
      brandVoice,
      platforms = [],
      title,
      keywords = [],
      imageCount = MAX_BLOG_IMAGES,
      uploadedImages,
      schemaTypes = "auto",
    } = parsed.data;

    // Schema author/publisher defaults to the CLIENT's company name (falls
    // back to the tenant name, then the brand profile name, then a default).
    let schemaSiteName: string | null = null;
    try {
      const siteClient = await (await createServiceClient())
        .from("clients")
        .select("name")
        .eq("id", clientId ?? "00000000-0000-0000-0000-000000000000")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (siteClient.data?.name) schemaSiteName = siteClient.data.name;
    } catch {
      // fall through — tenant name below
    }
    if (!schemaSiteName) {
      // Fall back to the default brand profile's name (the workspace/brand
      // the post is generated for) — tenant name lookup would need an extra
      // query and the brand name is the more relevant author anyway.
      try {
        const brandRes = await getDefaultBrandProfile();
        if (brandRes.success && brandRes.data?.name) {
          schemaSiteName = brandRes.data.name;
        }
      } catch {
        // fall through — default site name in the meta builder
      }
    }

    // The user may supply a title, keywords/topics, or both. "topic" is the
    // primary working keyword the model writes around; when only a title is
    // given, the title itself becomes the working topic.
    let primaryKeyword =
      (keywords ?? []).filter(Boolean)[0] ?? topic ?? title ?? "";
    let workingTopic =
      topic ??
      (keywords ?? []).filter(Boolean).join(", ") ??
      title ??
      "";
    let autoSelectedTopic: string | null = null;

    // No direction at all — pick the topic from what people are actually
    // asking. Research is seeded by the workspace/client name so the
    // suggested topic is relevant to the business, and the top real question
    // or trend becomes the working topic.
    if (!workingTopic.trim()) {
      const seed = schemaSiteName || "small business marketing";
      try {
        const suggest = await researchTopic(tenantId, { topic: seed });
        const candidate =
          (suggest?.questions ?? []).find((q) => q && q.trim()) ??
          (suggest?.trends ?? []).find((t) => t && t.trim()) ??
          "";
        if (candidate) {
          autoSelectedTopic = candidate.trim().slice(0, 160);
          workingTopic = autoSelectedTopic;
          primaryKeyword = primaryKeyword || autoSelectedTopic;
        }
      } catch (err) {
        console.warn("[generate-content] Topic suggestion failed:", err);
      }
      if (!autoSelectedTopic) {
        return NextResponse.json(
          { error: "Provide a title, keywords, or a topic to generate from." },
          { status: 400 }
        );
      }
    }

    // Research-first: search the web (Google-grounded when the platform key
    // exists, otherwise a model-generated question set) so the content
    // actually answers the questions people ask about the keywords/topic.
    let research: TopicResearch | null = null;
    try {
      research = await researchTopic(tenantId, {
        title: title ?? undefined,
        topic: workingTopic,
        keywords: keywords ?? [],
      });
    } catch (err) {
      console.warn("[generate-content] Research step failed:", err);
    }

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

    // Trial tenants: one blog per week. Paid plans: monthly per-tier caps.
    if (platforms.includes("blog")) {
      const trial = await checkTrialContentLimit(tenantId, "blog");
      if (!trial.allowed) {
        return NextResponse.json({ error: trial.reason }, { status: 429 });
      }
      const plan = await checkUsageLimit(tenantId, "blog_posts");
      if (!plan.allowed) {
        return NextResponse.json({ error: plan.reason ?? "Monthly blog limit reached" }, { status: 429 });
      }
    }
    const socialCount = platforms.filter((p: string) => p !== "blog").length;
    if (socialCount > 0) {
      const plan = await checkUsageLimit(tenantId, "social_posts");
      if (!plan.allowed) {
        return NextResponse.json({ error: plan.reason ?? "Monthly social-post limit reached" }, { status: 429 });
      }
    }

    // ------------------------------------------------------------------
    // 2.5. Enrich prompts with workspace context (brand profile + knowledgebase)
    // ------------------------------------------------------------------
    const workspaceId = await getCurrentWorkspaceId();
    let workspaceContext = "";
    // Real pages from the knowledge base — the source of truth for internal
    // links in the generated post (model markers are resolved against these).
    let linkablePages: { title: string; url: string; text: string }[] = [];

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

        linkablePages = await getWorkspaceLinkablePages(workspaceId, tenantId);
        // The tenant's own published CMS pages are prime internal-link
        // targets (the post will live on that site).
        const sitePagesRes = await (await createServiceClient())
          .from("site_pages")
          .select("title, slug")
          .eq("tenant_id", tenantId)
          .eq("kind", "blog_post")
          .eq("is_published", true)
          .order("created_at", { ascending: false })
          .limit(50);
        for (const p of sitePagesRes.data ?? []) {
          if (!p.title || !p.slug) continue;
          linkablePages.push({ title: p.title, url: `/site/${p.slug}`, text: "" });
        }
      } catch (err) {
        console.warn("[generate-content] Could not load workspace context:", err);
      }
    }

    // ------------------------------------------------------------------
    // 3. Generate the blog post (structured output)
    // ------------------------------------------------------------------
    const blogSystemPrompt =
      getBlogPrompt(brandVoice, {
        primaryKeyword: primaryKeyword,
        internalLinks: buildInternalLinkContext(linkablePages),
        research: research ?? undefined,
        titleHint: title,
      }) + workspaceContext;

    const blogUserPrompt = `Write a comprehensive blog post about: "${workingTopic}". ${
      title ? `The page title the post must satisfy is: "${title}". Use it as the focus of the content.` : ""
    }${keywords && keywords.length > 0 ? `Target keywords: ${keywords.join(", ")}.` : ""} ${
      brandVoice ? `Use this brand voice: ${brandVoice}.` : ""
    }`;

    // Helper to count words in a string (defensive: a truncated model
    // response can omit the body key entirely — treat it as empty rather
    // than crashing on .split of undefined).
    const countWords = (text: unknown) =>
      String(text ?? "").split(/\s+/).filter((w) => w.length > 0).length;

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

    // ------------------------------------------------------------------
    // 3-3.75. Generate the blog post + images + score, enforcing the quality
    // gate (SEO >= 80 AND AEO/GEO >= 80) BEFORE anything is saved. A draft
    // that misses the gate is regenerated — text only, since every scoring
    // check reads the text (the images from the first attempt are reused with
    // the retry draft's keyword-bearing descriptions as alt text) — with the
    // exact failing checks as rewrite feedback. After MAX_SCORE_ATTEMPTS the
    // request fails with a structured ScoreGateError instead of silently
    // saving sub-standard content; the publish gate is no longer the only
    // line of defense.
    // ------------------------------------------------------------------
    const gate = getScoreGate();
    let attempts = 0;
    let fixFeedback = "";
    let blogPost: BlogPostResult = {
      title: "",
      slug: "",
      metaDescription: "",
      headings: [],
      body: "",
      images: [],
      suggestedImagePrompt: undefined,
    };
    let generatedImages: GeneratedBlogImage[] = [];
    let bodyWithImages = "";
    let seoScore: SeoScoreResult;
    let aeoGeo: AeoGeoResult;

    while (true) {
      attempts += 1;

      blogPost = await generateStructuredOutput<BlogPostResult>(
        "blog_generation" as AITask,
        blogSystemPrompt,
        fixFeedback ? `${blogUserPrompt}\n\n${fixFeedback}` : blogUserPrompt,
        tenantId,
        getBlogPostSchema(),
        {
          clientId,
          functionName: "generate_blog_post",
        }
      );

      // Normalize a truncated/partial structured response: a missing body or
      // headings array must not crash downstream code (the word-count retry
      // below re-prompts the model when the body is empty).
      blogPost = {
        title: blogPost.title ?? "",
        slug: blogPost.slug ?? "",
        metaDescription: blogPost.metaDescription ?? "",
        headings: Array.isArray(blogPost.headings) ? blogPost.headings : [],
        body: typeof blogPost.body === "string" ? blogPost.body : "",
        images: Array.isArray(blogPost.images) ? blogPost.images : [],
        suggestedImagePrompt: blogPost.suggestedImagePrompt,
      };

      const blogWordCount = countWords(blogPost.body);
      console.log(`[generate-content] Blog word count: ${blogWordCount} (min: ${MIN_BLOG_WORDS})`);

      // If the generated post is too short, retry with explicit length
      // instruction and increased maxTokens to give the model room to expand.
      if (blogWordCount < MIN_BLOG_WORDS) {
        console.warn(
          `[generate-content] Blog too short (${blogWordCount} words). Retrying with 2500+ word requirement...`
        );
        const enrichedSystemPrompt =
          blogSystemPrompt +
          `\n\nCRITICAL: The blog post body MUST be at least 2500 words. Write thorough, detailed content with multiple H2 sections, examples, data points, and actionable insights. Do NOT write thin or shallow content. This will be published on a professional website and must demonstrate expertise.`;
        const enrichedUserPrompt =
          (fixFeedback ? `${blogUserPrompt}\n\n${fixFeedback}\n\n` : blogUserPrompt) +
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

      // Derive the image specs for THIS draft: the model's structured specs,
      // else derived from IMAGE_URL placeholders left in the body, else the
      // legacy suggested prompt.
      let imageSpecs: BlogImageSpec[] = Array.isArray(blogPost.images)
        ? blogPost.images
        : [];
      const bodyPlaceholders = extractImagePlaceholders(blogPost.body);
      if (imageSpecs.length === 0 && bodyPlaceholders.length > 0) {
        console.warn(
          `[generate-content] Model left ${bodyPlaceholders.length} IMAGE_URL placeholder(s) in the body but returned no image specs — deriving specs from the placeholders.`
        );
        imageSpecs = [
          {
            prompt: `Featured image for a blog post titled "${blogPost.title}" about: ${workingTopic}. High quality, editorial, on-brand.`,
            placement: "featured" as const,
            sectionTitle: "",
            description: `Featured image for ${blogPost.title}`,
          },
          ...bodyPlaceholders.map((ph) => ({
            prompt: `Blog illustration for a post about "${workingTopic}". ${ph.alt}. Detailed, on-brand, editorial quality.`,
            placement: "inline" as const,
            sectionTitle: "",
            description: ph.alt || `Inline image ${ph.index}`,
          })),
        ];
      }
      if (imageSpecs.length === 0 && blogPost.suggestedImagePrompt) {
        imageSpecs = [
          {
            prompt: blogPost.suggestedImagePrompt,
            placement: "featured" as const,
            sectionTitle: "",
            description: "Featured image for the post",
          },
        ];
      }

      if (attempts === 1) {
        // First attempt: generate every image fresh (AI or user uploads).
        generatedImages =
          uploadedImages && uploadedImages.length > 0
            ? await (async () => {
                // User supplied their own images — skip AI generation and use
                // the uploaded URLs, mapped onto the model's placements so
                // they sit in the same spots (featured hero + inline).
                const attached = attachUploadedImages(uploadedImages, imageSpecs);
                await persistUploadedImages(
                  tenantId,
                  clientId,
                  attached,
                  blogPost.title
                );
                return attached;
              })()
            : await generateBlogImages(
                tenantId,
                clientId,
                imageSpecs,
                blogPost.title,
                imageCount
              );
      } else {
        // Gate retry: text only — reuse the images from the first attempt
        // with the retry draft's (keyword-bearing) descriptions as alt text.
        generatedImages =
          uploadedImages && uploadedImages.length > 0
            ? attachUploadedImages(uploadedImages, imageSpecs)
            : mapReusedImages(imageSpecs, generatedImages);
      }

      // Resolve internal-link markers, then guarantee at least one internal
      // link (related-reading section) when the body has none — automatic
      // internal linking for posts that will live on the generated site.
      bodyWithImages = appendRelatedReading(
        resolveInternalLinks(
          injectImagesIntoBody(blogPost.body, generatedImages),
          linkablePages
        ),
        linkablePages
      );

      // On-page SEO score — stored with the post and
      // displayed in Recent Content. The keyword used is the primary keyword;
      // internal links are judged against the workspace knowledge base, so the
      // score reflects reality (not the model's opinion).
      seoScore = scoreContent({
        title: blogPost.title,
        metaDescription: blogPost.metaDescription,
        slug: blogPost.slug,
        body: bodyWithImages,
        keyword: primaryKeyword,
        internalUrls: linkablePages.map((p) => p.url),
      });

      // AEO/GEO readiness (free heuristic engine — no LLM cost on the
      // high-volume path). Persisted with the post so the SEO analytics tab
      // and post list can show it without recomputing.
      aeoGeo = scoreAeoGeo({
        title: blogPost.title,
        metaDescription: blogPost.metaDescription,
        body: bodyWithImages,
        keyword: primaryKeyword,
        entities: [],
      });

      if (!isBelowGate(seoScore.total, aeoGeo.total, gate)) break;
      if (attempts >= MAX_SCORE_ATTEMPTS) {
        throw new ScoreGateError(seoScore.total, aeoGeo.total, gate, seoScore, aeoGeo);
      }
      fixFeedback = buildGateFeedback(seoScore, aeoGeo, gate);
      console.warn(
        `[generate-content] Draft below score gate (SEO ${seoScore.total}/AEO-GEO ${aeoGeo.total}, gate ${gate}) — retrying (${attempts}/${MAX_SCORE_ATTEMPTS})`
      );
    }

    const seoPayload = {
      score: seoScore.total,
      grade: seoScore.grade,
      keyword: seoScore.keyword,
      wordCount: seoScore.wordCount,
      checks: seoScore.checks,
    };
    const aeoGeoPayload = {
      score: aeoGeo.total,
      aeoScore: aeoGeo.aeoScore,
      geoScore: aeoGeo.geoSscore,
      grade: aeoGeo.grade,
      checks: aeoGeo.checks,
      qaPairs: aeoGeo.qaPairs,
    };

    // WordPress SEO meta + JSON-LD schema for the connected WordPress
    // sites — deterministic (no extra model call), from data the scorers
    // already produced. Persisted with the post and sent on publish.
    const featuredImage =
      generatedImages.find((img) => img.spec.placement === "featured")?.url ??
      generatedImages[0]?.url ??
      null;
    const seoMeta = buildWpSeoMeta({
      title: blogPost.title,
      metaDescription: blogPost.metaDescription,
      focusKeyword: primaryKeyword,
      qaPairs: aeoGeo.qaPairs,
      featuredImageUrl: featuredImage,
      slug: blogPost.slug,
      siteName: schemaSiteName,
      schemaTypes: schemaTypes as SchemaSelection | undefined,
      body: bodyWithImages,
    });

    // Safety net: if the body still mentions IMAGE_URL tokens the image
    // pipeline didn't produce enough images — flag it loudly so it's never
    // silently shipped to a published post.
    if (/IMAGE_URL_?\d+/i.test(bodyWithImages)) {
      console.warn(
        `[generate-content] ${(bodyWithImages.match(/IMAGE_URL_?\d+/gi) || []).length} IMAGE_URL token(s) survived injection — they were stripped from the saved post.`
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

    // Insert the blog post. Never echo the row back (`.select("*")`) — the
    // body carries megabytes of base64 images, and echoing it through the
    // Supabase Cloudflare edge reliably triggers 520 origin errors. We only
    // need the id, so request that alone. If the insert still fails with a
    // retryable origin error, re-check by slug first: a 520 can mean the row
    // actually committed but the response was lost, and a blind retry would
    // create a duplicate post.
    const blogInsert = () =>
      supabase
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
            body: bodyWithImages,
            images: generatedImages.map((img) => ({
              url: img.url,
              prompt: img.spec.prompt,
              placement: img.spec.placement,
              sectionTitle: img.spec.sectionTitle,
              description: img.spec.description,
            })),
            suggestedImagePrompt: blogPost.suggestedImagePrompt ?? "",
            topic,
            brandVoice,
            research: research
              ? { questions: research.questions, trends: research.trends, source: research.source }
              : null,
            topicAutoSelected: autoSelectedTopic,
            seo: seoPayload,
            aeoGeo: aeoGeoPayload,
            seoMeta: seoMeta.meta,
            schemaTypes: Array.isArray(schemaTypes) ? schemaTypes : seoMeta.summary.schemaTypes,
            seoMetaPreview: schemaPreview({
              title: blogPost.title,
              metaDescription: blogPost.metaDescription,
              focusKeyword: primaryKeyword,
              qaPairs: aeoGeo.qaPairs,
              featuredImageUrl: featuredImage,
              slug: blogPost.slug,
              siteName: schemaSiteName,
              schemaTypes: schemaTypes as SchemaSelection | undefined,
              body: bodyWithImages,
            }),
          },
          status: "draft",
          created_by: userId,
          ai_generated: true,
          aeo_geo_score: aeoGeo.total,
        })
        .select("id")
        .single();

    let { data: blogPostRow, error: blogError } = await blogInsert();

    if (blogError && isRetryableOriginError(blogError)) {
      console.warn(
        "[generate-content] Blog insert hit retryable origin error — checking for a committed row before retrying:",
        (blogError as { status?: number; error_code?: string | number }).status ??
          (blogError as { status?: number; error_code?: string | number }).error_code
      );
      // 520s can be responses lost after a successful commit. Look the row up
      // by tenant+slug; if it exists, the insert actually went through.
      const { data: existing } = await supabase
        .from("posts")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("content->>slug", blogPost.slug)
        .maybeSingle();
      if (existing) {
        blogPostRow = existing;
        blogError = null;
      } else {
        const retried = await blogInsert();
        blogPostRow = retried.data;
        blogError = retried.error;
      }
    }

    if (blogError) {
      console.error("[generate-content] Error saving blog post:", blogError);
      return NextResponse.json(
        { error: "Failed to save blog post", details: blogError },
        { status: 500 }
      );
    }
    if (!blogPostRow) {
      console.error("[generate-content] Blog insert returned no row.");
      return NextResponse.json(
        { error: "Failed to save blog post" },
        { status: 500 }
      );
    }
    const blogPostId = blogPostRow.id;

    // Stamp the final SEO/AEO/GEO scores onto this post's media_assets so
    // the Asset Library card shows how the generated piece scored (chips on
    // the card render only when metadata.scores exists). Best-effort — a
    // failure here never fails the request.
    {
      const assetIds = [
        ...new Set(
          generatedImages
            .map((img) => img.assetId)
            .filter((id): id is string => Boolean(id))
        ),
      ];
      if (assetIds.length > 0) {
        try {
          const { data: assetRows } = await supabase
            .from("media_assets")
            .select("id, metadata")
            .eq("tenant_id", tenantId)
            .in("id", assetIds);
          for (const row of assetRows ?? []) {
            const meta = (row.metadata ?? {}) as Record<string, unknown>;
            await supabase
              .from("media_assets")
              .update({
                metadata: {
                  ...meta,
                  // Links the asset card back to its source post so the
                  // library can deep-link to the full factor breakdown.
                  postId: blogPostId,
                  scores: {
                    seo: seoScore.total,
                    aeo: aeoGeo.aeoScore,
                    geo: aeoGeo.geoSscore,
                    gate,
                  },
                },
              })
              .eq("tenant_id", tenantId)
              .eq("id", row.id);
          }
        } catch (err) {
          console.warn(
            "[generate-content] Failed to stamp scores on assets:",
            err
          );
        }
      }
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
            blogPostId,
          },
          status: "draft",
          created_by: userId,
          ai_generated: true,
        })
        .select("id")
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
    // Count the written text (not the injected markdown image syntax).
    const finalWordCount = countWords(blogPost.body);

    return NextResponse.json({
      success: true,
      blogPost: {
        id: blogPostId,
        title: blogPost.title,
        slug: blogPost.slug,
        metaDescription: blogPost.metaDescription,
        headings: blogPost.headings,
        body: bodyWithImages,
        wordCount: finalWordCount,
        images: generatedImages.map((img) => ({
          url: img.url,
          prompt: img.spec.prompt,
          placement: img.spec.placement,
          sectionTitle: img.spec.sectionTitle,
          description: img.spec.description,
        })),
        suggestedImagePrompt: blogPost.suggestedImagePrompt ?? "",
        status: "draft",
        seo: seoPayload,
        seoMeta: seoMeta.meta,
        seoMetaSummary: seoMeta.summary,
        schemaTypes: Array.isArray(schemaTypes) ? schemaTypes : seoMeta.summary.schemaTypes,
        schemaPreview: schemaPreview({
          title: blogPost.title,
          metaDescription: blogPost.metaDescription,
          focusKeyword: primaryKeyword,
          qaPairs: aeoGeo.qaPairs,
          featuredImageUrl: featuredImage,
          slug: blogPost.slug,
          siteName: schemaSiteName,
          schemaTypes: schemaTypes as SchemaSelection | undefined,
          body: bodyWithImages,
        }),
        research: research
          ? { questions: research.questions, trends: research.trends, source: research.source }
          : null,
        autoSelectedTopic,
      },
      socialPosts: socialResults.map(({ platform, caption }, index) => ({
        platform,
        id: socialPostRows[index] ? (socialPostRows[index] as { id: string }).id : undefined,
        ...caption,
      })),
    });
  } catch (error) {
    // The quality gate rejects drafts that can't clear 80/80 on SEO AND
    // AEO/GEO after MAX_SCORE_ATTEMPTS — return the scores and failing checks
    // so the UI can tell the user exactly what to fix (and nothing sub-standard
    // was saved).
    if (error instanceof ScoreGateError) {
      return NextResponse.json(
        {
          error: error.message,
          code: "score_gate",
          seo: error.seo,
          aeoGeo: error.aeoGeo,
          gate: error.gate,
          checks: error.checks,
        },
        { status: 422 }
      );
    }
    console.error("[generate-content] Unexpected error:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}