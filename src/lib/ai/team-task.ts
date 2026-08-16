"use server";

// ============================================================================
// AI Team — employee task pipeline (request-scope-free).
//
// The heavy part of a chat message (Malory dispatch → handoff → employee work
// → reply) runs HERE, with every ID passed explicitly. The Inngest background
// worker calls `processTeamTask` (no cookies/headers — it must not use
// getTenantId()/getCurrentWorkspaceId()/getDefaultBrandProfile()), and the
// synchronous fallback in ai-team-chat.ts calls the same function when the
// queue is unavailable. One code path, two execution contexts.
// ============================================================================

import { createServiceClient } from "@/lib/supabase/server";
import {
  tenantScopedClient,
  assertTenantOwner,
} from "@/lib/supabase/tenant-scope";
import { buildBrandSystemPrompt } from "@/lib/brand-profile-utils";
import {
  getWorkspaceKnowledgeContext,
  getWorkspaceLinkablePages,
} from "@/lib/knowledgebase";
import {
  buildEmployeeSystemPrompt,
  employeeKeyNameList,
  EMPLOYEE_PERSONAS,
} from "@/lib/ai/employee-personas";
import { scoreEmployeeOutput } from "@/lib/ai/eval";
import { EMPLOYEE_KEYS } from "@/lib/ai/employee-keys";
import {
  routeRequestDeterministically,
  type DispatchDecision,
} from "@/lib/ai/routing";
import {
  generateStructuredOutput,
  generateText,
  generateImage,
} from "@/lib/ai/orchestrator";
import { getBlogPrompt, getBlogPostSchema } from "@/lib/ai/seo-prompts";
import { pamGenerateSocial } from "@/lib/ai/social-pipeline";
import { persistImageToStorage } from "@/lib/media/storage";
import {
  selectBlogImageSpecs,
  injectImagesIntoBody,
  type BlogImageSpec,
  type GeneratedBlogImage,
} from "@/lib/blog-images";
import {
  resolveInternalLinks,
  buildInternalLinkContext,
  appendRelatedReading,
} from "@/lib/content-links";
import { scoreContent, type SeoScoreResult } from "@/lib/seo-scorer";
import { scoreAeoGeo, type AeoGeoResult } from "@/lib/aeo-geo";
import { buildWpSeoMeta, schemaPreview } from "@/lib/seo/wp-seo-meta";
import {
  getScoreGate,
  MAX_SCORE_ATTEMPTS,
  isBelowGate,
  buildGateFeedback,
  ScoreGateError,
  mapReusedImages,
} from "@/lib/score-gate";
import { incrementUsage } from "@/lib/usage";
import { checkTrialContentLimit } from "@/lib/trial-limits";
import { checkUsageLimit } from "@/lib/plan-limits";
import { extractClientFromMessage } from "@/lib/ai/client-extract";
import { createCampaignPlan } from "@/lib/campaign-plans";
import { createNotification } from "@/lib/in-app-notifications";

// ----------------------------------------------------------------------------
// Payload + result types
// ----------------------------------------------------------------------------

export interface TeamTaskPayload {
  chatId: string;
  tenantId: string;
  workspaceId: string | null;
  userMessage: string;
  taskId: string;
}

interface TaskChatRow {
  id: string;
  tenant_id: string;
  workspace_id: string | null;
  client_id: string | null;
  title: string;
  kind: "team" | "employee" | "room";
  employee_key: string | null;
  /** Group rooms: the employee keys currently in the chat. */
  participants?: string[] | null;
  created_at: string;
}

interface TaskMessageRow {
  id: string;
  chat_id: string;
  tenant_id: string;
  role: "user" | "employee" | "system";
  employee_key: string | null;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

// ----------------------------------------------------------------------------
// Workspace context (brand profile + knowledge base) — no request scope.
// ----------------------------------------------------------------------------

async function loadBrandContext(
  tenantId: string,
  workspaceId: string | null
): Promise<string> {
  if (!workspaceId) return "";
  try {
    const supabase = await createServiceClient();
    const { data } = await supabase
      .from("brand_profiles")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("workspace_id", workspaceId)
      .eq("is_default", true)
      .maybeSingle();
    if (data) return buildBrandSystemPrompt(data as never);
    return "";
  } catch (err) {
    console.warn("[team-task] Could not load brand profile:", err);
    return "";
  }
}

async function loadWorkspaceContext(
  tenantId: string,
  workspaceId: string | null
): Promise<string> {
  if (!workspaceId) return "";
  let context = await loadBrandContext(tenantId, workspaceId);
  try {
    const kbContext = await getWorkspaceKnowledgeContext(workspaceId, tenantId);
    if (kbContext) context += "\n\n" + kbContext;
  } catch (err) {
    console.warn("[team-task] Could not load knowledgebase context:", err);
  }
  return context;
}

async function loadLinkablePages(
  tenantId: string,
  workspaceId: string | null
): Promise<{ title: string; url: string; text: string }[]> {
  const pages: { title: string; url: string; text: string }[] = [];
  if (workspaceId) {
    try {
      pages.push(...(await getWorkspaceLinkablePages(workspaceId, tenantId)));
    } catch {
      // KB unavailable — fall through to CMS pages below.
    }
  }
  // The tenant's OWN published CMS pages are the most important internal
  // links (they live on the site the blog will be published to).
  try {
    const supabase = await createServiceClient();
    const { data: sitePages } = await supabase
      .from("site_pages")
      .select("title, slug, category")
      .eq("tenant_id", tenantId)
      .eq("kind", "blog_post")
      .eq("is_published", true)
      .order("created_at", { ascending: false })
      .limit(50);
    for (const p of sitePages ?? []) {
      if (!p.title || !p.slug) continue;
      pages.push({
        title: p.title,
        url: `/site/${p.slug}`,
        text: p.category ?? "",
      });
    }
  } catch {
    // ignore — internal links are a best-effort enhancement
  }
  return pages;
}

/** Load the tenant's per-employee config (custom instructions etc.). */
async function loadEmployeeConfig(
  employeeKey: string,
  tenantId: string
): Promise<{
  customInstructions: string;
  guidelines: string;
  assets: string;
}> {
  try {
    const supabase = tenantScopedClient(await createServiceClient(), tenantId);
    const catalogClient = await createServiceClient();
    const { data: emp } = await catalogClient
      .from("ai_employees")
      .select("id")
      .eq("key", employeeKey)
      .maybeSingle();
    if (!emp) return { customInstructions: "", guidelines: "", assets: "" };

    const { data } = await supabase
      .from("tenant_ai_employees")
      .select("metadata")
      .eq("employee_id", emp.id)
      .maybeSingle();
    const config = (data?.metadata as Record<string, unknown>)?.config as
      | Record<string, unknown>
      | undefined;
    return {
      customInstructions: (config?.customInstructions as string) ?? "",
      guidelines: (config?.guidelines as string) ?? "",
      assets: (config?.assets as string) ?? "",
    };
  } catch {
    return { customInstructions: "", guidelines: "", assets: "" };
  }
}

/**
 * Compact rolling memory of what's been said in this chat. No extra LLM
 * call — we just replay the last several exchanges (bounded and truncated)
 * into the dispatch + employee prompts, so agents remember decisions, tone,
 * and prior work and can jump straight back in after a break.
 */
async function buildChatContext(
  chatId: string,
  tenantId: string
): Promise<string> {
  try {
    const supabase = tenantScopedClient(await createServiceClient(), tenantId);
    const { data } = await supabase
      .from("team_messages")
      .select("role, employee_key, content")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: true })
      .limit(60);
    if (!data || data.length === 0) return "";
    const lines = data
      .filter((m) => m.role !== "system")
      .slice(-14)
      .map((m) => {
        const who =
          m.role === "user"
            ? "Owner"
            : EMPLOYEE_PERSONAS[
                (m.employee_key ?? "") as keyof typeof EMPLOYEE_PERSONAS
              ]?.name ?? m.employee_key ?? "Staff";
        const text = (m.content ?? "").replace(/\s+/g, " ").trim();
        return `${who}: ${text.length > 240 ? text.slice(0, 240) + "…" : text}`;
      });
    return lines.join("\n");
  } catch {
    return "";
  }
}

// ----------------------------------------------------------------------------
// Malory dispatch — classify the request and hand it to the right employee.
// The deterministic rules live in src/lib/ai/routing.ts (pure + unit-tested);
// this function adds the LLM classifier for genuinely ambiguous messages.
// ----------------------------------------------------------------------------


const DISPATCH_SCHEMA = {
  type: "object",
  properties: {
    employeeKey: {
      type: "string",
      // Display names only — never raw keys as names. The model returns the
      // key, but only sees it paired with the real name it must speak.
      description: "One of (key — name — role): " + employeeKeyNameList(),
    },
    action: {
      type: "string",
      enum: ["content", "campaign", "onboarding", "chat", "other"],
      description:
        "content = the user is asking to WRITE/CREATE blog posts or content (hand to Cheryl). campaign = the user is asking to PLAN a full campaign (dated blogs + socials — keep it with Malory). onboarding = the user is bringing on a NEW CLIENT / starting client onboarding (keep it with Malory, who runs it step by step). chat = answer a question or advise. other = anything else.",
    },
    topic: {
      type: "string",
      description: "The subject/topic to write about when action=content, else empty string.",
    },
    note: { type: "string", description: "One-line note explaining the routing decision." },
  },
  required: ["employeeKey", "action", "topic", "note"],
};

async function dispatchRequest(
  tenantId: string,
  request: string,
  fixedEmployeeKey: string | null,
  workspaceContext: string,
  chatContext: string
): Promise<DispatchDecision> {
  const forced =
    fixedEmployeeKey &&
    (EMPLOYEE_KEYS as readonly string[]).includes(fixedEmployeeKey)
      ? fixedEmployeeKey
      : null;

  // Deterministic rules first — no model call for the common cases.
  const deterministic = routeRequestDeterministically(request, fixedEmployeeKey);
  if (deterministic) return deterministic;

  const systemPrompt =
    buildEmployeeSystemPrompt("nina", { workspaceContext }) +
    "\n\nYou are dispatching work inside the AI agency. Read the owner's message and decide " +
    "which employee should handle it and whether it is a content-creation request.\n" +
    "Employees (key — name — role): " +
    employeeKeyNameList() +
    ". Content requests (write/create a blog post, article, or content) always go to penny (Cheryl). " +
    "You speak the employees' NAMES (Cheryl, Woodhouse, Pam, Barry, Brett, AK, Ray, Sterling, Malory, Lana, Cyril), never their keys.\n" +
    "Examples:\n" +
    '- "check our page speed and core web vitals" → {"employeeKey":"scout","action":"chat","topic":"","note":"technical SEO"}\n' +
    '- "schedule a meeting for tomorrow" → {"employeeKey":"eva","action":"chat","topic":"","note":"calendar"}\n' +
    '- "post about our new launch on instagram" → {"employeeKey":"sonny","action":"chat","topic":"","note":"social media"}\n' +
    '- "hello, what can you do?" → {"employeeKey":"nina","action":"chat","topic":"","note":"general question for Malory"}\n' +
    "Return ONLY valid JSON matching the schema.";

  const forcedName = forced
    ? EMPLOYEE_PERSONAS[forced as keyof typeof EMPLOYEE_PERSONAS]?.name ??
      forced
    : null;
  const prompt = forced
    ? `The owner sent this directly to ${forcedName}. Classify it for ${forcedName} — return the employeeKey that matches ${forcedName}.`
    : `Owner's message: "${request}". Decide who handles it.` +
      (chatContext
        ? `\n\nContext from earlier in this chat (use it to stay consistent):\n${chatContext}`
        : "");

  try {
    const decision = await generateStructuredOutput<DispatchDecision>(
      "team_chat",
      systemPrompt,
      prompt,
      tenantId,
      DISPATCH_SCHEMA,
      { functionName: "dispatch", maxTokens: 2048, temperature: 0.2 }
    );
    const suggested = decision.employeeKey;
    return {
      employeeKey: forced ?? (suggested ?? "nina"),
      action:
        decision.action === "content"
          ? "content"
          : decision.action === "campaign"
            ? "campaign"
            : decision.action === "onboarding"
              ? "onboarding"
              : "chat",
      topic: decision.topic ?? "",
      note: decision.note ?? "",
      // In a DM the classifier can still suggest another employee; keep the
      // selected employee but remember who it thought should help.
      referralKey:
        forced && suggested && suggested !== forced ? suggested : undefined,
    };
  } catch (err) {
    console.warn("[team-task] Dispatch failed:", err);
    return {
      employeeKey: forced ?? "nina",
      action: "chat",
      topic: "",
      note: "",
    };
  }
}

// ----------------------------------------------------------------------------
// Cheryl's content pipeline — the real blog generation (text + images + draft)
// ----------------------------------------------------------------------------

interface BlogDraft {
  postId: string;
  title: string;
  body: string;
}

/** Generates a full blog draft (featured + inline images) and saves it. */
async function cherylGenerateBlog(
  tenantId: string,
  topic: string,
  workspaceContext: string,
  workspaceId: string | null,
  chatContext: string,
  keywords: string[] = [],
  shouldCancel?: () => Promise<boolean>,
  revisionFeedback?: string
): Promise<BlogDraft> {
  const supabase = await createServiceClient();

  // Trial tenants: one blog per week — enforced here too so the AI team
  // can't bypass the API-route cap. Paid plans: monthly per-tier cap.
  const trial = await checkTrialContentLimit(tenantId, "blog");
  if (!trial.allowed) {
    throw new Error(trial.reason ?? "Weekly trial limit reached");
  }
  const plan = await checkUsageLimit(tenantId, "blog_posts");
  if (!plan.allowed) {
    throw new Error(plan.reason ?? "Monthly blog limit reached");
  }

  // Real pages from the KB — internal-link markers resolve against these.
  const linkablePages = await loadLinkablePages(tenantId, workspaceId);

  const primaryKeyword = keywords[0] ?? topic;
  const systemPrompt =
    buildEmployeeSystemPrompt("penny", { workspaceContext, chatContext }) +
    "\n\n" +
    getBlogPrompt("", {
      primaryKeyword,
      secondaryKeywords: keywords.length > 1 ? keywords.slice(1) : undefined,
      internalLinks: buildInternalLinkContext(linkablePages),
    });
  const userPrompt = `Write a comprehensive, publish-ready blog post about: "${topic}".` +
    (keywords.length > 0
      ? ` Target these keywords in the title, meta description, slug, and body: ${keywords.join(", ")}.`
      : "") +
    (revisionFeedback
      ? `\n\n## Revision guidance from the owner\nRewrite this post addressing the following feedback. Keep it on-topic and preserve the target keywords:\n${revisionFeedback}`
      : "");

  // ---- Score gate (must clear 80/80 on SEO AND AEO/GEO) --------------------
  // Every generated AND rewritten piece must clear the gate on both engines
  // before it is saved. If the first draft misses it, the draft is
  // regenerated — text only, since every scoring check reads the text (the
  // images from the first attempt are reused with the retry draft's
  // keyword-bearing descriptions as alt text) — with the exact failing
  // checks from the scorers as rewrite feedback. After MAX_SCORE_ATTEMPTS
  // the gate rejects the draft with a ScoreGateError (scores + failing
  // checks) instead of saving sub-standard content; the publish gate is no
  // longer the only line of defense.
  const gate = getScoreGate();
  let attempts = 0;
  let fixFeedback = "";
  let blogPost: {
    title: string;
    slug: string;
    metaDescription: string;
    headings: { level: number; text: string }[];
    body: string;
    images: BlogImageSpec[];
  };
  let generated: GeneratedBlogImage[] = [];
  let body = "";
  let seo: SeoScoreResult;
  let aeoGeo: AeoGeoResult;

  while (true) {
    attempts += 1;
    if (shouldCancel && (await shouldCancel())) {
      throw new Error("Blog generation cancelled");
    }

    blogPost = await generateStructuredOutput<{
      title: string;
      slug: string;
      metaDescription: string;
      headings: { level: number; text: string }[];
      body: string;
      images: BlogImageSpec[];
    }>(
      "blog_generation",
      systemPrompt,
      fixFeedback ? `${userPrompt}\n\n${fixFeedback}` : userPrompt,
      tenantId,
      getBlogPostSchema(),
      { functionName: "generate_blog_post" }
    );

    const specs = selectBlogImageSpecs(
      Array.isArray(blogPost.images) ? blogPost.images : []
    );
    if (attempts === 1) {
      // First attempt: generate every image fresh and record it in
      // media_assets (failures are isolated per image).
      generated = [];
      await Promise.all(
        specs.map(async (spec) => {
          try {
            const size = spec.placement === "featured" ? "1792x1024" : "1024x1024";
            const images = await generateImage(tenantId, spec.prompt, {
              size: size as "1792x1024" | "1024x1024",
              n: 1,
            });
            const rawUrl = images[0]?.url;
            if (!rawUrl) return;
            const url = await persistImageToStorage(tenantId, rawUrl);

            const { error: assetErr } = await supabase.from("media_assets").insert({
              tenant_id: tenantId,
              client_id: null,
              workspace_id: workspaceId,
              type: "image",
              prompt: spec.prompt,
              url,
              metadata: { placement: spec.placement, sectionTitle: spec.sectionTitle },
              status: "completed",
            });
            if (assetErr) {
              console.warn("[team-task] media_assets insert failed:", assetErr.message);
            }
            generated.push({ spec, url });
            void incrementUsage(tenantId, "image_generations", 1);
            void incrementUsage(tenantId, "ai_tokens", 1000);
          } catch (err) {
            console.warn(
              `[team-task] Image generation failed for "${spec.sectionTitle || "featured"}":`,
              err instanceof Error ? err.message : err
            );
          }
        })
      );
    } else {
      // Gate retry: text only — reuse the images from the first attempt with
      // the retry draft's (keyword-bearing) descriptions as alt text.
      generated = mapReusedImages(specs, generated);
    }

    // Resolve the model's [INTERNAL LINK: …] markers against real pages (KB +
    // the tenant's own CMS site), then guarantee at least one internal link by
    // appending a related-reading section when the body has none — automatic
    // internal linking for posts that will live on the generated site.
    body = appendRelatedReading(
      resolveInternalLinks(
        injectImagesIntoBody(blogPost.body, generated),
        linkablePages
      ),
      linkablePages
    );

    // On-page SEO score — every blog the team generates is
    // scored against its real keyword + the workspace's actual linkable pages,
    // exactly like the manual generator. Stored in content.seo; the DB trigger
    // (migration 025) syncs seo_score / seo_checks columns from it.
    seo = scoreContent({
      title: blogPost.title,
      metaDescription: blogPost.metaDescription,
      slug: blogPost.slug,
      body,
      keyword: primaryKeyword,
      internalUrls: linkablePages.map((p) => p.url),
    });

    // AEO/GEO readiness (free heuristic) — persisted with the post so the SEO
    // analytics tab and post list show it without recomputing.
    aeoGeo = scoreAeoGeo({
      title: blogPost.title,
      metaDescription: blogPost.metaDescription,
      body,
      keyword: primaryKeyword,
      entities: [],
    });

    if (!isBelowGate(seo.total, aeoGeo.total, gate)) break;
    if (attempts >= MAX_SCORE_ATTEMPTS) {
      throw new ScoreGateError(seo.total, aeoGeo.total, gate, seo, aeoGeo);
    }
    fixFeedback = buildGateFeedback(seo, aeoGeo, gate);
    console.warn(
      `[team-task] Draft below score gate (SEO ${seo.total}/AEO-GEO ${aeoGeo.total}, gate ${gate}) — retrying (${attempts}/${MAX_SCORE_ATTEMPTS})`
    );
  }

  // Eval loop: run the finished blog through Cheryl's full criteria including
  // the real-engine parity check (SEO + AEO/GEO, 2000+ word floor) so "did
  // Cheryl maximize the scores" is measurable on every generated post.
  const evalResult = scoreEmployeeOutput("penny", body, {
    title: blogPost.title,
    metaDescription: blogPost.metaDescription,
    slug: blogPost.slug,
    keyword: primaryKeyword,
    body,
    internalUrls: linkablePages.map((p) => p.url),
  });

  const featuredImage =
    generated.find((img) => img.spec.placement === "featured")?.url ??
    generated[0]?.url ??
    null;
  const brandName = workspaceContext.match(/BRAND VOICE: ([^\n]+)/)?.[1] ?? null;
  const seoMeta = buildWpSeoMeta({
    title: blogPost.title,
    metaDescription: blogPost.metaDescription,
    focusKeyword: primaryKeyword,
    qaPairs: aeoGeo.qaPairs,
    featuredImageUrl: featuredImage,
    slug: blogPost.slug,
    siteName: brandName,
  });

  const { data: post, error: postError } = await supabase
    .from("posts")
    .insert({
      tenant_id: tenantId,
      client_id: null,
      content: {
        type: "blog",
        title: blogPost.title,
        slug: blogPost.slug,
        metaDescription: blogPost.metaDescription,
        headings: blogPost.headings,
        body,
        images: generated.map((img) => ({
          url: img.url,
          prompt: img.spec.prompt,
          placement: img.spec.placement,
          sectionTitle: img.spec.sectionTitle,
          description: img.spec.description,
        })),
        topic,
        brandVoice: "",
        seo: {
          score: seo.total,
          grade: seo.grade,
          keyword: seo.keyword,
          wordCount: seo.wordCount,
          checks: seo.checks,
        },
        aeoGeo: {
          score: aeoGeo.total,
          aeoScore: aeoGeo.aeoScore,
          geoScore: aeoGeo.geoSscore,
          grade: aeoGeo.grade,
          checks: aeoGeo.checks,
          qaPairs: aeoGeo.qaPairs,
        },
        seoMeta: seoMeta.meta,
        seoMetaPreview: schemaPreview({
          title: blogPost.title,
          metaDescription: blogPost.metaDescription,
          focusKeyword: primaryKeyword,
          qaPairs: aeoGeo.qaPairs,
          featuredImageUrl: featuredImage,
          slug: blogPost.slug,
          siteName: brandName,
        }),
        eval: {
          verdict: evalResult.verdict,
          score: evalResult.score,
          passed: evalResult.passed,
          total: evalResult.total,
          failed: evalResult.criteria
            .filter((c) => !c.passed)
            .map((c) => c.name),
        },
      },
      status: "draft",
      created_by: null,
      ai_generated: true,
      aeo_geo_score: aeoGeo.total,
    })
    .select("id")
    .single();
  if (postError) throw new Error(`Failed to save blog post: ${postError.message}`);
  if (!post) throw new Error("Failed to save blog post");

  void incrementUsage(tenantId, "blog_posts", 1);
  void incrementUsage(tenantId, "ai_tokens", 5000);

  return { postId: post.id, title: blogPost.title, body };
}

// ----------------------------------------------------------------------------
// Approved-campaign-item generation — "approve the idea" → content is built
// in the background and lands as pending_approval (content approval gate:
// nothing gets scheduled/published until a human approves the generated
// content). Blog items go through Cheryl (text + images); social items go
// through Pam (caption; media attaches when video/images for social ship).
// ----------------------------------------------------------------------------

/**
 * Generate content for an approved (idea) campaign item, link the resulting
 * post, and set it to pending_approval. Fire-and-forget from the approve
 * endpoint; on failure the item flips back to "proposed" so it can be
 * approved again.
 */
export async function generateApprovedCampaignItem(
  tenantId: string,
  itemId: string,
  workspaceId: string | null,
  mediaKind: "image" | "video" = "image"
): Promise<void> {
  const supabase = tenantScopedClient(await createServiceClient(), tenantId);
  const { data: item } = await supabase
    .from("campaign_plan_items")
    .select("*")
    .eq("id", itemId)
    .maybeSingle();
  if (!item) return;

  try {
    let postId: string | null = null;
    const keywords = Array.isArray(item.keywords)
      ? item.keywords.filter(Boolean)
      : [];
    if (item.kind === "blog") {
      const workspaceContext = await loadWorkspaceContext(tenantId, workspaceId);
      const draft = await cherylGenerateBlog(
        tenantId,
        item.topic,
        workspaceContext,
        workspaceId,
        "",
        keywords
      );
      postId = draft.postId;
      // Cheryl saves drafts; the content-approval gate wants pending_approval.
      await supabase.from("posts").update({ status: "pending_approval" }).eq("id", postId);
    } else {
      const draft = await pamGenerateSocial(
        tenantId,
        item.topic,
        item.platform ?? "instagram",
        item.due_date,
        workspaceId,
        keywords,
        mediaKind
      );
      postId = draft.postId;
    }
    if (postId) {
      await supabase
        .from("campaign_plan_items")
        .update({ status: "draft", linked_post_id: postId })
        .eq("id", itemId);
      // Content approval gate: the generated piece waits on a human sign-off,
      // so ping the bell with a link straight to it.
      void createNotification({
        tenantId,
        kind: "approval",
        title: `Content ready for your approval: ${item.topic}`,
        body: `The team generated ${
          item.kind === "blog" ? "a blog draft" : "a social post"
        } for "${item.topic}". Review and approve it before it goes live.`,
        link: `/dashboard/posts?post=${postId}`,
        groupKey: `post:${postId}`,
      });
    }
  } catch (err) {
    console.error("[team-task] Campaign item generation failed:", err);
    // If the draft couldn't clear the quality bar (SEO AND AEO/GEO >= gate),
    // tell the owner why instead of silently flipping the idea back.
    if (err instanceof ScoreGateError) {
      void createNotification({
        tenantId,
        kind: "alert",
        title: `Content couldn't clear the quality gate: ${item.topic}`,
        body: `SEO ${err.seo}/100 and AEO/GEO ${err.aeoGeo}/100 — the item needs ${err.gate}/100 on both engines. The idea was set back to "proposed"; approve it again after adjusting the topic or keywords.`,
        link: "/dashboard/calendar",
        groupKey: `campaign:${itemId}`,
      });
    }
    // Put the idea back so the owner can retry.
    await supabase
      .from("campaign_plan_items")
      .update({ status: "proposed", linked_post_id: null })
      .eq("id", itemId);
  }
}

/**
 * Regenerate a broken/empty blog post: rebuild the content via Cheryl's real
 * pipeline (same path as fresh generation — images included) and overwrite
 * the existing post row so links/status stay intact. Used by the "Regenerate
 * content" button when a post's body came back empty (e.g. the legacy
 * placeholder drafts that predate the approve→generate pipeline).
 */
export async function regenerateBlogPost(
  tenantId: string,
  postId: string,
  workspaceId: string | null,
  revisionFeedback?: string
): Promise<{ postId: string; title: string }> {
  const supabase = tenantScopedClient(await createServiceClient(), tenantId);
  const { data: existing } = await supabase
    .from("posts")
    .select("*")
    .eq("id", postId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!existing) throw new Error("Post not found");

  const content =
    typeof existing.content === "string"
      ? (() => {
          try {
            return JSON.parse(existing.content);
          } catch {
            return {};
          }
        })()
      : (existing.content ?? {});
  const topic = content.topic || content.title;
  if (!topic) throw new Error("Post has no topic to regenerate from");

  const workspaceContext = await loadWorkspaceContext(tenantId, workspaceId);
  const draft = await cherylGenerateBlog(
    tenantId,
    topic,
    workspaceContext,
    workspaceId,
    "",
    Array.isArray(content.keywords) ? content.keywords : [],
    undefined,
    revisionFeedback
  );

  // Copy the fresh content into the existing row (status/links preserved),
  // then drop the duplicate post Cheryl's pipeline created.
  const { data: fresh } = await supabase
    .from("posts")
    .select("content, media_urls")
    .eq("id", draft.postId)
    .maybeSingle();
  if (fresh) {
    const patch: Record<string, unknown> = {
      content: fresh.content,
      media_urls: fresh.media_urls ?? [],
      ai_generated: true,
      status: "pending_approval",
    };
    const { error: updErr } = await supabase
      .from("posts")
      .update(patch)
      .eq("id", postId);
    if (updErr) throw new Error(`Failed to update post: ${updErr.message}`);
    await supabase.from("posts").delete().eq("id", draft.postId);
  }

  return { postId, title: draft.title };
}

// ----------------------------------------------------------------------------
// Setup checklist — real configuration state, not invented. Malory surfaces
// this before/with a campaign plan so nothing runs half-configured.
// ----------------------------------------------------------------------------

interface SetupChecklistItem {
  label: string;
  done: boolean;
  hint: string;
  url: string;
}

// ----------------------------------------------------------------------------
// Lana (reputation) + Cyril (legal) — dedicated drafting pipelines.
// Both produce structured, expert-grade outputs instead of free-form chat so
// the work is consistently usable (copy-paste ready, flagged for humans).
// ----------------------------------------------------------------------------

/**
 * Lana's reputation-response pipeline: drafts a brand-safe public response to
 * a review / complaint / crisis mention. Structured: summary of the issue,
 * the recommended response, tone rules, and red flags a human must check.
 */
async function lanaDraftResponse(
  tenantId: string,
  userMessage: string,
  workspaceContext: string,
  chatContext: string
): Promise<string> {
  const draft = await generateStructuredOutput<{
    issueSummary: string;
    response: string;
    tone: string;
    redFlags: string[];
    escalate: boolean;
  }>(
    "team_chat",
    `You are Lana, the agency's reputation manager — a senior crisis-communications
professional. You draft public responses to reviews, complaints, and brand
mentions. Rules: never admit liability in a public post, never argue with the
customer, always offer a private follow-up path, keep it concise (under 200
words), and keep the brand's voice. Return JSON:
{
  "issueSummary": "2-3 sentence neutral summary of what happened",
  "response": "the ready-to-post public response (plain text, under 200 words)",
  "tone": "one line describing the tone used and why",
  "redFlags": ["legal/security/PR risks a human must review before posting"],
  "escalate": true|false
}`,
    `The situation: ${userMessage}\n\n${workspaceContext ? `Brand context:\n${workspaceContext}` : ""}\n\n${chatContext ? `Chat history:\n${chatContext}` : ""}`,
    tenantId,
    {
      type: "object",
      properties: {
        issueSummary: { type: "string" },
        response: { type: "string" },
        tone: { type: "string" },
        redFlags: { type: "array", items: { type: "string" } },
        escalate: { type: "boolean" },
      },
      required: ["issueSummary", "response", "tone", "redFlags", "escalate"],
    },
    { functionName: "lana_reputation_response", temperature: 0.5, maxTokens: 1200 }
  );

  const flags = Array.isArray(draft.redFlags) ? draft.redFlags : [];
  return [
    `**Issue:** ${draft.issueSummary}`,
    "",
    `**Draft response (ready to post):**`,
    `> ${draft.response}`,
    "",
    `**Tone:** ${draft.tone}`,
    flags.length > 0
      ? `**⚠️ Red flags a human must review:**\n${flags.map((f) => `- ${f}`).join("\n")}`
      : "",
    draft.escalate
      ? "**Escalate:** yes — recommend a human sign-off before anything goes live, and loop in Cyril if it touches legal."
      : "**Escalate:** no — safe to post after a quick human read.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Cyril's legal-document pipeline: drafts contracts, terms, policies, and
 * disclaimers conservatively, always flagging what a qualified lawyer must
 * review. Never final legal advice.
 */
async function cyrilDraftDocument(
  tenantId: string,
  userMessage: string,
  workspaceContext: string,
  chatContext: string
): Promise<string> {
  const draft = await generateStructuredOutput<{
    documentTitle: string;
    purpose: string;
    document: string;
    openQuestions: string[];
    lawyerReview: string[];
  }>(
    "team_chat",
    `You are Cyril, the agency's legal assistant — a meticulous, conservative
legal document drafter. Draft contracts, terms of service, privacy policies,
NDAs, and disclaimers. Rules: write clearly, use standard clause structure,
never invent party names (use placeholders like [Client] / [Agency]), include a
jurisdiction/governing-law line, and ALWAYS flag every clause a licensed lawyer
must review. Return JSON:
{
  "documentTitle": "title of the document",
  "purpose": "one line on what this document does",
  "document": "the full draft in markdown",
  "openQuestions": ["facts needed from the user before finalizing"],
  "lawyerReview": ["clauses/sections a qualified lawyer must review"]
}`,
    `The request: ${userMessage}\n\n${workspaceContext ? `Client/brand context:\n${workspaceContext}` : ""}\n\n${chatContext ? `Chat history:\n${chatContext}` : ""}\n\nInclude a 60-day cancellation clause and governing-law line when relevant.`,
    tenantId,
    {
      type: "object",
      properties: {
        documentTitle: { type: "string" },
        purpose: { type: "string" },
        document: { type: "string" },
        openQuestions: { type: "array", items: { type: "string" } },
        lawyerReview: { type: "array", items: { type: "string" } },
      },
      required: ["documentTitle", "purpose", "document", "openQuestions", "lawyerReview"],
    },
    { functionName: "cyril_legal_document", temperature: 0.4, maxTokens: 3000 }
  );

  const questions = Array.isArray(draft.openQuestions) ? draft.openQuestions : [];
  const review = Array.isArray(draft.lawyerReview) ? draft.lawyerReview : [];
  return [
    `**${draft.documentTitle}**`,
    `*${draft.purpose}*`,
    "",
    draft.document,
    questions.length > 0
      ? `**I need from you before this is final:**\n${questions.map((q) => `- ${q}`).join("\n")}`
      : "",
    "",
    `**⚠️ Lawyer review required:**\n${review.map((r) => `- ${r}`).join("\n")}`,
    "",
    "_This is a drafting aid, not legal advice. A qualified lawyer must review before signature._",
  ]
    .filter(Boolean)
    .join("\n");
}

async function buildSetupChecklist(
  tenantId: string,
  workspaceId: string | null
): Promise<SetupChecklistItem[]> {
  const supabase = await createServiceClient();

  // Workspace-scoped tables filter by workspace when one is active; email
  // accounts are tenant-wide. The dummy workspace id never matches, so a null
  // workspace intentionally returns "not configured".
  const ws = workspaceId ?? "00000000-0000-0000-0000-000000000000";

  const exists = async (
    q: PromiseLike<{ data: unknown }>
  ): Promise<boolean> => {
    try {
      return (await q).data != null;
    } catch {
      return false;
    }
  };

  const [brand, kb, socials, blogs, emails] = await Promise.all([
    exists(
      supabase
        .from("brand_profiles")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("workspace_id", ws)
        .limit(1)
        .maybeSingle()
    ),
    exists(
      supabase
        .from("knowledgebase_items")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("workspace_id", ws)
        .eq("status", "ready")
        .limit(1)
        .maybeSingle()
    ),
    exists(
      supabase
        .from("social_accounts")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("workspace_id", ws)
        .limit(1)
        .maybeSingle()
    ),
    exists(
      supabase
        .from("blog_platforms")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("workspace_id", ws)
        .limit(1)
        .maybeSingle()
    ),
    exists(
      supabase
        .from("email_accounts")
        .select("id")
        .eq("tenant_id", tenantId)
        .limit(1)
        .maybeSingle()
    ),
  ]);

  const items: SetupChecklistItem[] = [
    {
      label: "Workspace customized (brand profile)",
      done: brand,
      hint: "Add your brand voice, colors, and tone so every piece sounds like you.",
      url: "/dashboard/settings",
    },
    {
      label: "Website content in the Knowledge Base",
      done: kb,
      hint: "Import or scrape your site so internal links, topics, and facts are real, not guessed.",
      url: "/dashboard/knowledgebase",
    },
    {
      label: "Social accounts connected",
      done: socials,
      hint: "Connect Instagram, TikTok, Facebook, LinkedIn or X so social posts can be scheduled and published.",
      url: "/dashboard/settings?tab=social",
    },
    {
      label: "Blog / CMS connected",
      done: blogs,
      hint: "Connect WordPress (or your CMS) so blogs can be published to your site with the right category.",
      url: "/dashboard/settings?tab=blog",
    },
    {
      label: "Email inbox connected",
      done: emails,
      hint: "Connect Gmail/Outlook so the team can handle inbox and calendar work for you.",
      url: "/dashboard/settings?tab=email",
    },
  ];
  return items;
}

function formatSetupChecklist(items: SetupChecklistItem[]): string {
  const missing = items.filter((i) => !i.done);
  const lines = items.map(
    (i) => `${i.done ? "[x]" : "[ ]"} ${i.label}${i.done ? "" : ` — ${i.hint}`}`
  );
  if (missing.length === 0) {
    return `\n\nSetup status: all systems go. ${items.length}/${items.length} configuration steps done — we can run at full power.`;
  }
  return (
    `\n\nBefore the campaign runs at full power, finish the setup (${items.length - missing.length}/${items.length} done):\n` +
    lines.join("\n")
  );
}

// ----------------------------------------------------------------------------
// Malory's campaign planning — the 0→100 campaign as a dated calendar plan.
// ----------------------------------------------------------------------------

const CAMPAIGN_PLAN_SCHEMA = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description: "Short campaign name, e.g. 'Coal Creek fall launch'.",
    },
    summary: {
      type: "string",
      description: "2-3 sentence overview of the campaign: goal, audience, arc.",
    },
    items: {
      type: "array",
      description:
        "The dated content pieces. Spread blogs 3-5 days apart, social posts between them, covering roughly 2-3 weeks. 4-8 items total.",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["blog", "social"] },
          topic: { type: "string", description: "The post topic/title." },
          dueDate: { type: "string", description: "YYYY-MM-DD" },
          platform: {
            type: "string",
            description: "Social platform (instagram/tiktok/facebook/linkedin/x) for social items, omit for blogs.",
          },
          owner: {
            type: "string",
            description: "Employee key who executes this piece: penny (Cheryl) for blogs, sonny (Pam) for socials unless another specialist fits better (e.g. gauge for paid promos, scout for a technical piece).",
          },
          keywords: {
            type: "array",
            items: { type: "string" },
            description: "1-3 target keywords for this piece (optional; the focus keyword should be first).",
          },
          internalLink: {
            type: "string",
            description: "Existing page on the client's site this piece should link to internally (optional).",
          },
          externalLinks: {
            type: "array",
            items: { type: "string" },
            description: "Reputable external URLs this piece should cite (optional, 0-3).",
          },
        },
        required: ["kind", "topic", "dueDate"],
      },
    },
  },
  required: ["title", "summary", "items"],
};

/** Malory maps the campaign → structured plan saved to campaign_plans. */
async function maloryPlanCampaign(
  tenantId: string,
  topic: string,
  workspaceContext: string,
  workspaceId: string | null,
  chatContext: string
): Promise<{ planId: string; title: string; summary: string; itemCount: number }> {
  const maloryPrompt =
    buildEmployeeSystemPrompt("nina", { workspaceContext, chatContext }) +
    `\n\nMap out the campaign as a concrete, dated plan: a mix of blog posts and social posts spread over 2-3 weeks. ` +
    `Blogs anchor the topic; socials promote, tease, and recap each blog. Use realistic dates STARTING NEXT WEEK. ` +
    `Today's actual date is ${new Date().toISOString().slice(0, 10)} — your dueDate values MUST be on or after that date, in the future, never in the past. ` +
    `Assign every piece an owner from the team — penny (Cheryl) writes blogs, sonny (Pam) runs socials, and bring ` +
    `in the right specialist where it fits (Sterling for paid promotions, AK for technical pieces, Cyril for anything ` +
    `legal, Barry for lead-gen offers).` +
    "\n\n## CRITICAL OUTPUT INSTRUCTION\n" +
    "Return ONLY valid JSON matching the exact structure below. Do NOT include any markdown formatting, code fences, or explanatory text outside the JSON object. Use EXACTLY these field names — do not rename them, do not add your own fields." +
    "\n\n{\n" +
    '  "title": "string (short campaign name)",\n' +
    '  "summary": "string (2-3 sentence overview: goal, audience, arc)",\n' +
    '  "items": [\n' +
    '    {\n' +
    '      "kind": "blog" | "social",\n' +
    '      "topic": "string (the post topic/title)",\n' +
    '      "dueDate": "string (YYYY-MM-DD)",\n' +
    '      "platform": "string (only for social items: instagram | tiktok | facebook | linkedin | x; omit for blogs)",\n' +
    '      "owner": "string (employee key: penny for blogs, sonny for socials, gauge for paid, scout for technical, linda for legal, stan (Barry) for lead-gen)",\n' +
    '      "keywords": ["string (1-3 target keywords; focus keyword first — optional)"],\n' +
    '      "internalLink": "string (existing client page to link to internally — optional)",\n' +
    '      "externalLinks": ["string (reputable external URLs to cite — optional, 0-3)"]\n' +
    "    }\n" +
    "  ]\n" +
    "}";

  const plan = await generateStructuredOutput<{
    title: string;
    summary: string;
    items: {
      kind: "blog" | "social";
      topic: string;
      dueDate: string;
      platform?: string;
      owner?: string;
      keywords?: string[];
      internalLink?: string;
      externalLinks?: string[];
    }[];
  }>(
    "team_chat",
    maloryPrompt,
    `Plan the campaign: "${topic}"`,
    tenantId,
    CAMPAIGN_PLAN_SCHEMA,
    { functionName: "plan_campaign", maxTokens: 16384, temperature: 0.5 }
  );

  const items = Array.isArray(plan.items)
    ? plan.items.filter((i) => i && i.topic && i.dueDate)
    : [];
  if (!plan.title || items.length === 0) {
    throw new Error("Campaign plan came back empty");
  }

  const saved = await createCampaignPlan(tenantId, {
    title: plan.title,
    summary: plan.summary ?? "",
    workspaceId,
    createdBy: "nina",
    items: items.map((i) => ({
      kind: i.kind === "social" ? "social" : "blog",
      topic: i.topic,
      dueDate: i.dueDate,
      platform: i.kind === "social" ? (i.platform ?? "instagram") : null,
      owner:
        i.owner ?? (i.kind === "social" ? "sonny" : "penny"),
      keywords: Array.isArray(i.keywords) ? i.keywords.filter(Boolean).slice(0, 3) : null,
      internalLink: i.internalLink ?? null,
      externalLinks: Array.isArray(i.externalLinks) ? i.externalLinks.filter(Boolean).slice(0, 3) : null,
    })),
  });

  void incrementUsage(tenantId, "ai_tokens", 2000);

  // Surface the plan in Recent SEO Audits: Malory-created campaigns live in
  // campaign_plans, but the dashboard's Recent Audits reads seo_campaigns —
  // so mirror the plan as an audit row (status approved) that links back to
  // the calendar plan. The row's url field carries the campaign title for
  // display in the audits lists.
  try {
    const sb = await createServiceClient();
    await sb.from("seo_campaigns").insert({
      tenant_id: tenantId,
      workspace_id: workspaceId,
      client_id: null,
      url: saved.title,
      tier_name: "AI Team Plan",
      tier_price: null,
      status: "approved",
      campaign_json: {
        title: saved.title,
        summary: saved.summary,
        source: "malory_team_chat",
        planId: saved.id,
      },
      created_by: null,
    });
  } catch (mirrorError: any) {
    console.warn(
      "[team-task] Could not mirror campaign plan into seo_campaigns:",
      mirrorError?.message ?? mirrorError
    );
  }

  return {
    planId: saved.id,
    title: saved.title,
    summary: saved.summary,
    itemCount: items.length,
  };
}

// ----------------------------------------------------------------------------
// Client onboarding — Malory runs it step by step, employee by employee.
// ----------------------------------------------------------------------------

/**
 * Malory's onboarding kickoff: introduce the client, hand the connection
 * checklist to Woodhouse to gather/sync, and lay out the step-by-step
 * sequence. Nothing jumps ahead — each step waits for the previous one.
 */
async function maloryOnboardClient(params: {
  tenantId: string;
  userMessage: string;
  workspaceContext: string;
  workspaceId: string | null;
  chatContext: string;
}): Promise<{
  replyContent: string;
  replyMeta: Record<string, unknown>;
  woodhouseContent: string | null;
}> {
  const { tenantId, userMessage, workspaceId } = params;

  const { name: parsedName, website } = extractClientFromMessage(userMessage);
  const clientName = parsedName ?? "your new client";
  const clientLabel = website ? `${clientName} (${website})` : clientName;

  const setup = await buildSetupChecklist(tenantId, workspaceId);
  const missing = setup.filter((i) => !i.done);
  const checklistLines = setup.map((i) =>
    `${i.done ? "[x]" : "[ ]"} ${i.label}${i.done ? "" : ` — ${i.hint}`}`
  );

  const woodhouseContent =
    `On it. I'm gathering the connections needed to run ${clientName}'s campaign. Here's where we stand:\n\n` +
    checklistLines.join("\n") +
    (missing.length > 0
      ? `\n\nI'll sync each missing connection — I'll update this thread as they come in.`
      : `\n\nEverything's already connected — nothing to sync.`);

  const replyContent =
    `Onboarding started for **${clientLabel}**. I'll run this one step at a time, employee by employee — nothing jumps ahead.\n\n` +
    `**Step 1 — Woodhouse gathers the connections.** Woodhouse is collecting everything the campaign needs to run:` +
    `\n` +
    checklistLines.join("\n") +
    (missing.length > 0
      ? `\n\nOnce those are synced, say \"connections ready\" and I'll move to **Step 2 — Cheryl builds the content foundation** (blog pillars, keywords, first drafts), then **Step 3 — Pam sets up social**, and finally **Step 4 — I map the campaign plan on the calendar**.`
      : `\n\nAll connections are already in place — say \"next step\" and I'll move to **Step 2 — Cheryl builds the content foundation**.`);

  return {
    replyContent,
    replyMeta: { action: "onboarding_started", clientName, website },
    woodhouseContent,
  };
}

class TaskCancelledError extends Error {
  constructor() {
    super("Task cancelled by user");
    this.name = "TaskCancelledError";
  }
}

/**
 * Severity for the sidebar indicator light on an employee reply:
 *   urgent (red)    — failures / alerts
 *   important (orange) — a draft, plan, or other deliverable is ready
 *   normal (green)  — a routine chat reply
 */
function actionPriority(
  action: string
): "urgent" | "important" | "normal" {
  if (/^(content|campaign|chat|reputation|legal|onboarding)_failed$/.test(action)) {
    return "urgent";
  }
  if (action === "content_generated" || action === "campaign_planned") {
    return "important";
  }
  return "normal";
}

/**
 * Copy a conversation (the owner's message + the employee's reply) into that
 * employee's DM chat, so any chat held with them anywhere (Team Room, group
 * room) is also found under Direct Messages.
 */
async function mirrorToEmployeeDm(params: {
  tenantId: string;
  workspaceId: string | null;
  employeeKey: string;
  sourceChatId: string;
  userMessage: string;
  replyContent: string;
  replyMeta: Record<string, unknown>;
}): Promise<void> {
  try {
    const sb = tenantScopedClient(await createServiceClient(), params.tenantId);

    let dmId: string | null = null;
    const { data: existing } = await sb
      .from("team_chats")
      .select("id")
      .eq("workspace_id", params.workspaceId)
      .eq("kind", "employee")
      .eq("employee_key", params.employeeKey)
      .maybeSingle();
    if (existing) {
      dmId = existing.id;
    } else {
      const { data: created, error } = await sb
        .from("team_chats")
        .insert({
          workspace_id: params.workspaceId,
          client_id: null,
          title: params.employeeKey,
          kind: "employee",
          employee_key: params.employeeKey,
        })
        .select("id")
        .single();
      if (!error && created) dmId = created.id;
    }
    if (!dmId || dmId === params.sourceChatId) return;

    await sb.from("team_messages").insert([
      {
        chat_id: dmId,
        role: "user",
        employee_key: null,
        content: params.userMessage,
        metadata: { mirror: true, sourceChatId: params.sourceChatId },
      },
      {
        chat_id: dmId,
        role: "employee",
        employee_key: params.employeeKey,
        content: params.replyContent,
        metadata: {
          ...params.replyMeta,
          mirror: true,
          sourceChatId: params.sourceChatId,
        },
      },
    ]);
  } catch (err) {
    console.warn("[team-task] DM mirror failed:", err);
  }
}

/** True when the user posted a stop signal for this task. */
async function isTaskCancelled(
  supabase: any,
  chatId: string,
  taskId: string
): Promise<boolean> {
  try {
    const { data } = await supabase
      .from("team_messages")
      .select("id")
      .eq("chat_id", chatId)
      .contains("metadata", { taskId, cancel: true })
      .limit(1);
    return (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

// ----------------------------------------------------------------------------
// processTeamTask — the full post-send pipeline.
//
// Inserted messages (handoff → status → reply) are appended in real time and
// picked up by the chat UI's polling; the reply carries metadata.taskId so the
// client knows this task is done.
// ----------------------------------------------------------------------------

/**
 * Post a bell notification for a finished task, keyed off the reply's action.
 * Approvals (draft ready / content pending review) get the "approval" kind;
 * failures get "alert"; everything else is an informational update linking
 * back to the chat or the produced work.
 */
async function notifyTaskResult(params: {
  tenantId: string;
  chatId: string;
  employeeName: string;
  replyContent: string;
  replyMeta: Record<string, unknown>;
}): Promise<void> {
  const { tenantId, chatId, employeeName, replyContent, replyMeta } = params;
  const action = typeof replyMeta.action === "string" ? replyMeta.action : "";
  const chatUrl = "/dashboard/ai-team/chat";
  const excerpt = (replyContent || "").replace(/\s+/g, " ").trim();
  const shortExcerpt =
    excerpt.length > 140 ? excerpt.slice(0, 140) + "…" : excerpt;

  if (action === "content_generated") {
    const title =
      typeof replyMeta.postTitle === "string"
        ? replyMeta.postTitle
        : "new draft";
    const link =
      typeof replyMeta.postUrl === "string" ? replyMeta.postUrl : chatUrl;
    const postId =
      typeof replyMeta.postId === "string" ? replyMeta.postId : undefined;
    await createNotification({
      tenantId,
      kind: "approval",
      title: `Draft ready for review: ${title}`,
      body: `${employeeName} finished the post and it's waiting for your approval before it can be published.`,
      link,
      groupKey: postId ? `post:${postId}` : `chat:${chatId}`,
    });
    return;
  }

  if (action === "campaign_planned") {
    const title =
      typeof replyMeta.planTitle === "string"
        ? replyMeta.planTitle
        : "new campaign";
    const link =
      typeof replyMeta.planUrl === "string"
        ? replyMeta.planUrl
        : "/dashboard/calendar";
    const planId =
      typeof replyMeta.planId === "string" ? replyMeta.planId : undefined;
    await createNotification({
      tenantId,
      kind: "info",
      title: `Campaign planned: ${title}`,
      body: `${employeeName} mapped the campaign. Review the calendar and approve items to start generating content.`,
      link,
      groupKey: planId ? `plan:${planId}` : `chat:${chatId}`,
    });
    return;
  }

  if (
    action === "content_failed" ||
    action === "campaign_failed" ||
    action === "chat_failed"
  ) {
    const err =
      typeof replyMeta.error === "string" ? replyMeta.error : "unknown error";
    await createNotification({
      tenantId,
      kind: "alert",
      title: "AI team hit a snag",
      body: `${employeeName}: ${err}`,
      link: chatUrl,
      groupKey: `chat:${chatId}`,
    });
    return;
  }

  // Plain chat replies, reputation drafts, and legal drafts.
  await createNotification({
    tenantId,
    kind: "info",
    title: `${employeeName} replied`,
    body: shortExcerpt || "See the chat for the full reply.",
    link: chatUrl,
    groupKey: `chat:${chatId}`,
  });
}

export async function processTeamTask(payload: TeamTaskPayload): Promise<void> {
  const { chatId, tenantId, workspaceId, userMessage, taskId } = payload;
  const supabase = tenantScopedClient(await createServiceClient(), tenantId);

  // Load + verify the chat belongs to this tenant.
  const { data: chat } = await supabase
    .from("team_chats")
    .select("*")
    .eq("id", chatId)
    .maybeSingle();
  assertTenantOwner(chat as TaskChatRow | null, tenantId, "chat");
  const room = chat as TaskChatRow;

  try {
    const workspaceContext = await loadWorkspaceContext(tenantId, workspaceId);
    // Rolling memory of this chat — agents pick up where the work left off.
    const chatContext = await buildChatContext(chatId, tenantId);

    if (await isTaskCancelled(supabase, chatId, taskId)) {
      throw new TaskCancelledError();
    }

    const fixedEmployee =
      room.kind === "employee" ? room.employee_key : null;
    // Group rooms carry the invited participants; clamp answers to them.
    const participants =
      room.kind === "employee"
        ? room.employee_key
          ? [room.employee_key]
          : []
        : Array.isArray(room.participants)
          ? (room.participants as string[])
          : null;

    let decision = await dispatchRequest(
      tenantId,
      userMessage,
      fixedEmployee,
      workspaceContext,
      chatContext
    );

    // Keep a group chat's answers among the invited employees. A request for
    // someone not in the room is answered by the first participant, who
    // suggests inviting the missing specialist.
    if (
      room.kind === "room" &&
      participants &&
      participants.length > 0 &&
      !participants.includes(decision.employeeKey)
    ) {
      decision = {
        ...decision,
        referralKey: decision.referralKey ?? decision.employeeKey,
        employeeKey: participants[0],
        action: "chat",
        topic: "",
      };
    }

    const targetKey = decision.employeeKey;

    // Team Room + named rooms: Malory posts a visible handoff — but only when
    // she's actually handing off to someone else.
    if (room.kind !== "employee" && targetKey !== "nina") {
      const handoffText =
        decision.action === "content"
          ? `On it. ${decision.note || "Content request."} — Cheryl, this one's yours.`
          : `On it. ${decision.note || `Handing this to ${targetKey}.`}`;
      await supabase.from("team_messages").insert({
        chat_id: chatId,
        role: "employee",
        employee_key: "nina",
        content: handoffText,
        metadata: { dispatch: true, dispatchTo: targetKey },
      });
    }

    // Progress status so the user sees what's happening while the employee
    // works (minutes for blog generation).
    const employeeDisplayName =
      EMPLOYEE_PERSONAS[targetKey as keyof typeof EMPLOYEE_PERSONAS]?.name ??
      targetKey;
    // Only Cheryl's content branch and Malory's campaign branch actually run
    // their pipelines; everything else is a chat reply. (The classifier can
    // label a DM message "content" even when the selected employee isn't the
    // writer — don't claim they're generating images.)
    const isContentPipeline =
      targetKey === "penny" && decision.action === "content";
    const isCampaignPipeline = decision.action === "campaign";
    const isOnboardingPipeline = decision.action === "onboarding";
    const statusText = isContentPipeline
      ? `${employeeDisplayName} is writing the post and generating the images — this takes a couple of minutes. I'll post the draft here when it's ready.`
      : isCampaignPipeline
        ? `Malory is mapping out the campaign plan — this takes a minute or two. I'll post the calendar link when it's ready.`
        : isOnboardingPipeline
          ? `Malory is kicking off the onboarding — introducing the client to the team and getting the connection checklist together…`
          : `${employeeDisplayName} is putting together a reply…`;
    await supabase.from("team_messages").insert({
      chat_id: chatId,
      role: "system",
      employee_key: null,
      content: statusText,
      metadata: {
        status: true,
        stage: isContentPipeline
          ? "working"
          : isCampaignPipeline
            ? "planning"
            : isOnboardingPipeline
              ? "onboarding"
              : "replying",
        taskId,
      },
    });

    if (await isTaskCancelled(supabase, chatId, taskId)) {
      throw new TaskCancelledError();
    }

    // Run the employee: content generation for Cheryl, persona chat otherwise.
    let replyContent = "";
    let replyMeta: Record<string, unknown> = {};

    if (decision.action === "onboarding") {
      try {
        const result = await maloryOnboardClient({
          tenantId,
          userMessage,
          workspaceContext,
          workspaceId,
          chatContext,
        });
        // Woodhouse posts her connection checklist (visible handoff) before
        // Malory's step-by-step plan lands.
        if (result.woodhouseContent) {
          await supabase.from("team_messages").insert({
            chat_id: chatId,
            role: "employee",
            employee_key: "eva",
            content: result.woodhouseContent,
            metadata: {
              action: "connections_checklist",
              priority: "normal",
              taskId,
            },
          });
          // And it's mirrored into Woodhouse's own DM too.
          void mirrorToEmployeeDm({
            tenantId,
            workspaceId,
            employeeKey: "eva",
            sourceChatId: chatId,
            userMessage,
            replyContent: result.woodhouseContent,
            replyMeta: { action: "connections_checklist", priority: "normal" },
          });
        }
        replyContent = result.replyContent;
        replyMeta = result.replyMeta;
      } catch (err) {
        replyContent = `I hit a snag kicking off the onboarding: ${
          err instanceof Error ? err.message : "unknown error"
        }. Ask me again or check the AI settings — the models need a configured API key.`;
        replyMeta = {
          action: "onboarding_failed",
          error: err instanceof Error ? err.message : "unknown",
        };
      }
    } else if (decision.action === "campaign") {
      const topic = decision.topic?.trim() || userMessage;
      try {
        const plan = await maloryPlanCampaign(
          tenantId,
          topic,
          workspaceContext,
          workspaceId,
          chatContext
        );
        const setup = await buildSetupChecklist(tenantId, workspaceId);
        const setupText = formatSetupChecklist(setup);
        const missingCount = setup.filter((i) => !i.done).length;
        replyContent =
          `Done — campaign plan saved: ${plan.title}\n\n` +
          `${plan.summary}\n\n` +
          `${plan.itemCount} pieces mapped out (blogs + socials) across the next few weeks. ` +
          `Open it on the Content Calendar to see everything laid out — proposed items are the dashed entries, and they'll flip to draft/scheduled/published as the work happens.` +
          setupText;
        replyMeta = {
          action: "campaign_planned",
          planId: plan.planId,
          planTitle: plan.title,
          planUrl: `/dashboard/calendar?plan=${plan.planId}`,
          setupMissing: missingCount,
        };
      } catch (err) {
        replyContent = `I hit a snag mapping that campaign: ${
          err instanceof Error ? err.message : "unknown error"
        }. Ask me again or check the AI settings — the models need a configured API key.`;
        replyMeta = {
          action: "campaign_failed",
          error: err instanceof Error ? err.message : "unknown",
        };
      }
    } else if (targetKey === "penny" && decision.action === "content") {
      const topic = decision.topic?.trim() || userMessage;
      try {
        const draft = await cherylGenerateBlog(
          tenantId,
          topic,
          workspaceContext,
          workspaceId,
          chatContext,
          [],
          () => isTaskCancelled(supabase, chatId, taskId)
        );
        replyContent =
          `Done — draft is ready: **${draft.title}**\n\n` +
          `I wrote a full post (${(draft.body || "").split(/\s+/).filter(Boolean).length} words) ` +
          `with a featured image and inline images. It's saved as a draft — open it from the link to review and publish.`;
        replyMeta = {
          postId: draft.postId,
          postTitle: draft.title,
          postUrl: `/dashboard/posts?post=${draft.postId}`,
          action: "content_generated",
        };
      } catch (err) {
        replyContent = `I hit a snag generating that draft: ${
          err instanceof Error ? err.message : "unknown error"
        }. Ask me again or check the AI settings — the models need a configured API key.`;
        replyMeta = {
          action: "content_failed",
          error: err instanceof Error ? err.message : "unknown",
        };
      }
    } else if (targetKey === "juno" && /\b(write|draft|respond|reply|answer|handle|fix)\b/i.test(userMessage)) {
      // Lana's build: structured reputation-response drafts.
      try {
        replyContent = await lanaDraftResponse(
          tenantId,
          userMessage,
          workspaceContext,
          chatContext
        );
        replyMeta = { action: "reputation_draft" };
      } catch (err) {
        replyContent = `I hit a snag drafting that response: ${
          err instanceof Error ? err.message : "unknown error"
        }. Ask me again or check the AI settings.`;
        replyMeta = { action: "reputation_failed", error: err instanceof Error ? err.message : "unknown" };
      }
    } else if (
      targetKey === "linda" &&
      /\b(draft|write|contract|agreement|terms? of service|privacy policy|nda|disclaimer|policy)\b/i.test(userMessage)
    ) {
      // Cyril's build: structured legal-document drafting.
      try {
        replyContent = await cyrilDraftDocument(
          tenantId,
          userMessage,
          workspaceContext,
          chatContext
        );
        replyMeta = { action: "legal_draft" };
      } catch (err) {
        replyContent = `I hit a snag drafting that document: ${
          err instanceof Error ? err.message : "unknown error"
        }. Ask me again or check the AI settings.`;
        replyMeta = { action: "legal_failed", error: err instanceof Error ? err.message : "unknown" };
      }
    } else {
      const config = await loadEmployeeConfig(targetKey, tenantId);
      let personaPrompt = buildEmployeeSystemPrompt(targetKey, {
        ...config,
        workspaceContext,
        chatContext,
      });
      // Out-of-lane request in a DM: the selected employee answers, but
      // honestly points at the specialist who should really handle it.
      const referralKey = decision.referralKey;
      if (
        referralKey &&
        referralKey !== targetKey &&
        EMPLOYEE_PERSONAS[referralKey as keyof typeof EMPLOYEE_PERSONAS]
      ) {
        const referral =
          EMPLOYEE_PERSONAS[referralKey as keyof typeof EMPLOYEE_PERSONAS];
        personaPrompt +=
          `\n\n## Out of your lane — point the owner to the specialist\n` +
          `The owner just asked for something that is ${referral.name}'s job (${referral.role}), not yours. ` +
          `Respond as yourself: briefly acknowledge the request, say it is ${referral.name}'s specialty, and offer two paths — ` +
          `(1) message ${referral.name} directly, or (2) bring ${referral.name} into this chat for a group discussion. ` +
          `If you can still help in a way that fits YOUR role, offer that too — but do not pretend to do ${referral.name}'s work.`;
      }
      try {
        replyContent = await generateText(
          "team_chat",
          userMessage,
          tenantId,
          { systemPrompt: personaPrompt, temperature: 0.7, maxTokens: 2048 }
        );
        // Eval loop: score the reply against the role's quality criteria so
        // "better" is measurable — the score rides along in the message
        // metadata (pure string checks, no extra LLM cost).
        const evalResult = scoreEmployeeOutput(targetKey, replyContent);
        replyMeta = {
          action: "chat",
          eval: {
            score: evalResult.score,
            passed: evalResult.passed,
            total: evalResult.total,
            verdict: evalResult.verdict,
            failed: evalResult.criteria
              .filter((c) => !c.passed)
              .map((c) => c.name),
          },
        };
      } catch (err) {
        replyContent =
          `I couldn't reach my models right now: ${
            err instanceof Error ? err.message : "unknown error"
          }.`;
        replyMeta = { action: "chat_failed" };
      }
    }

    if (await isTaskCancelled(supabase, chatId, taskId)) {
      throw new TaskCancelledError();
    }

    // Severity for the sidebar indicator light (green/orange/red).
    const priority = actionPriority(
      typeof replyMeta.action === "string" ? replyMeta.action : ""
    );
    await supabase.from("team_messages").insert({
      chat_id: chatId,
      role: "employee",
      employee_key: targetKey,
      content: replyContent,
      metadata: { ...replyMeta, taskId, priority },
    });

    // Surface the finished work in the top-nav bell (approval / update / alert).
    void notifyTaskResult({
      tenantId,
      chatId,
      employeeName: employeeDisplayName,
      replyContent,
      replyMeta,
    });

    // Any conversation held with an employee in a room/team chat is also
    // mirrored into their DM chat so it can be found under Direct Messages.
    if (room.kind !== "employee") {
      void mirrorToEmployeeDm({
        tenantId,
        workspaceId,
        employeeKey: targetKey,
        sourceChatId: chatId,
        userMessage,
        replyContent,
        replyMeta: { ...replyMeta, priority },
      });
    }
  } catch (err) {
    if (err instanceof TaskCancelledError) {
      // The cancel action already posted the "Stopped by you." status — just
      // stop without writing a reply or an error.
      return;
    }
    console.error("[team-task] Task failed:", err);
    // Never leave the user hanging — post an error reply so the client's
    // pending task resolves.
    void createNotification({
      tenantId,
      kind: "alert",
      title: "AI team task failed",
      body: err instanceof Error ? err.message : "Unknown error",
      link: "/dashboard/ai-team/chat",
      groupKey: `chat:${chatId}`,
    });
    try {
      await supabase.from("team_messages").insert({
        chat_id: chatId,
        role: "system",
        employee_key: null,
        content: `Something went wrong processing that request: ${
          err instanceof Error ? err.message : "unknown error"
        }`,
        metadata: { status: true, stage: "failed", taskId },
      });
    } catch (insertErr) {
      console.error("[team-task] Could not post failure message:", insertErr);
    }
  }
}

// ----------------------------------------------------------------------------
// sendMessageAndQueue — used by the API route (and the Inngest worker's
// sibling in ai-team-chat.ts). Kept here so the request path shares the exact
// same payload shape as the worker.
// ----------------------------------------------------------------------------

export interface SendMessageResult {
  success: boolean;
  error?: string;
  taskId?: string;
  messages?: TaskMessageRow[];
}

/**
 * Inserts the user's message + a "reviewing" status, then hands off to the
 * background queue (or runs inline when the queue is unavailable — the caller
 * decides via `queue`). Returns the messages inserted here so the UI can
 * render them instantly; everything after comes through polling.
 */
export async function enqueueOrRun(
  input: {
    chatId: string;
    tenantId: string;
    workspaceId: string | null;
    content: string;
    queue?: (payload: TeamTaskPayload) => Promise<void>;
  }
): Promise<SendMessageResult> {
  const supabase = tenantScopedClient(await createServiceClient(), input.tenantId);

  const { data: chat } = await supabase
    .from("team_chats")
    .select("*")
    .eq("id", input.chatId)
    .maybeSingle();
  assertTenantOwner(chat as TaskChatRow | null, input.tenantId, "chat");

  // Insert the user's message — returned so the UI can render it immediately.
  const { data: userMsg, error: userErr } = await supabase
    .from("team_messages")
    .insert({
      chat_id: input.chatId,
      role: "user",
      employee_key: null,
      content: input.content,
      metadata: {},
    })
    .select("*")
    .single();
  if (userErr) return { success: false, error: userErr.message };

  // The task id is generated up-front so every status message (reviewing →
  // working → final reply) carries it; the chat UI uses it to stop spinning
  // a status line once the task's final message lands.
  const taskId = crypto.randomUUID();

  // The "reviewing" status is DM-aware: a direct message is answered by that
  // employee, not dispatched by Malory.
  const chatRow = chat as TaskChatRow;
  const isEmployeeChat = chatRow?.kind === "employee";
  const reviewingName = isEmployeeChat
    ? EMPLOYEE_PERSONAS[
        chatRow.employee_key as keyof typeof EMPLOYEE_PERSONAS
      ]?.name ?? "your employee"
    : null;
  const reviewingContent = isEmployeeChat
    ? `${reviewingName} is on it — one moment…`
    : "Malory is reviewing your request and assigning it to the team…";
  const reviewing: TaskMessageRow = {
    id: crypto.randomUUID(),
    chat_id: input.chatId,
    tenant_id: input.tenantId,
    role: "system",
    employee_key: null,
    content: reviewingContent,
    metadata: { status: true, stage: "reviewing", taskId },
    created_at: new Date().toISOString(),
  };
  const { data: reviewRow } = await supabase
    .from("team_messages")
    .insert({
      chat_id: input.chatId,
      role: "system",
      employee_key: null,
      content: reviewing.content,
      metadata: reviewing.metadata,
    })
    .select("*")
    .single();
  const inserted: TaskMessageRow[] = [];
  if (userMsg) inserted.push(userMsg as TaskMessageRow);
  if (reviewRow) inserted.push(reviewRow as TaskMessageRow);

  const payload: TeamTaskPayload = {
    chatId: input.chatId,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    userMessage: input.content,
    taskId,
  };

  if (input.queue) {
    await input.queue(payload);
  }
  return { success: true, taskId: payload.taskId, messages: inserted };
}

