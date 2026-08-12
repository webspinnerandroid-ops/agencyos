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
  EMPLOYEE_PERSONAS,
} from "@/lib/ai/employee-personas";
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
import { scoreContent } from "@/lib/rankmath";
import { incrementUsage } from "@/lib/usage";
import { checkTrialContentLimit } from "@/lib/trial-limits";
import { checkUsageLimit } from "@/lib/plan-limits";
import { createCampaignPlan } from "@/lib/campaign-plans";

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
    employeeKey: { type: "string", description: "One of: " + EMPLOYEE_KEYS.join(", ") },
    action: {
      type: "string",
      enum: ["content", "campaign", "chat", "other"],
      description:
        "content = the user is asking to WRITE/CREATE blog posts or content (hand to Cheryl). campaign = the user is asking to PLAN a full campaign (dated blogs + socials — keep it with Malory). chat = answer a question or advise. other = anything else.",
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
    "Employee keys: " +
    EMPLOYEE_KEYS.join(", ") +
    ". Content requests (write/create a blog post, article, or content) always go to penny (Cheryl). " +
    "Examples:\n" +
    '- "check our page speed and core web vitals" → {"employeeKey":"scout","action":"chat","topic":"","note":"technical SEO"}\n' +
    '- "schedule a meeting for tomorrow" → {"employeeKey":"eva","action":"chat","topic":"","note":"calendar"}\n' +
    '- "post about our new launch on instagram" → {"employeeKey":"sonny","action":"chat","topic":"","note":"social media"}\n' +
    '- "hello, what can you do?" → {"employeeKey":"nina","action":"chat","topic":"","note":"general question for Malory"}\n' +
    "Return ONLY valid JSON matching the schema.";

  const prompt = forced
    ? `The owner sent this to ${forced} directly: "${request}". Classify it for ${forced}.`
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
    return {
      employeeKey: forced ?? (decision.employeeKey ?? "nina"),
      action: decision.action === "content" ? "content" : "chat",
      topic: decision.topic ?? "",
      note: decision.note ?? "",
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
  keywords: string[] = []
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
      : "");

  const blogPost = await generateStructuredOutput<{
    title: string;
    slug: string;
    metaDescription: string;
    headings: { level: number; text: string }[];
    body: string;
    images: BlogImageSpec[];
  }>(
    "blog_generation",
    systemPrompt,
    userPrompt,
    tenantId,
    getBlogPostSchema(),
    { functionName: "generate_blog_post" }
  );

  const specs = selectBlogImageSpecs(
    Array.isArray(blogPost.images) ? blogPost.images : []
  );
  const generated: GeneratedBlogImage[] = [];

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

  // Resolve the model's [INTERNAL LINK: …] markers against real pages (KB +
  // the tenant's own CMS site), then guarantee at least one internal link by
  // appending a related-reading section when the body has none — automatic
  // internal linking for posts that will live on the generated site.
  const body = appendRelatedReading(
    resolveInternalLinks(
      injectImagesIntoBody(blogPost.body, generated),
      linkablePages
    ),
    linkablePages
  );

  // On-page SEO score (Rank Math-style) — every blog the team generates is
  // scored against its real keyword + the workspace's actual linkable pages,
  // exactly like the manual generator. Stored in content.seo; the DB trigger
  // (migration 025) syncs seo_score / seo_checks columns from it.
  const seo = scoreContent({
    title: blogPost.title,
    metaDescription: blogPost.metaDescription,
    slug: blogPost.slug,
    body,
    keyword: primaryKeyword,
    internalUrls: linkablePages.map((p) => p.url),
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
      },
      status: "draft",
      created_by: null,
      ai_generated: true,
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
    }
  } catch (err) {
    console.error("[team-task] Campaign item generation failed:", err);
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
  workspaceId: string | null
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
    Array.isArray(content.keywords) ? content.keywords : []
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
    `in the right specialist where it fits (gauge for paid promotions, scout for technical pieces, linda for anything ` +
    `legal, stan for lead-gen offers).` +
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
    '      "owner": "string (employee key: penny for blogs, sonny for socials, gauge for paid, scout for technical, linda for legal, stan for lead-gen)",\n' +
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
// processTeamTask — the full post-send pipeline.
//
// Inserted messages (handoff → status → reply) are appended in real time and
// picked up by the chat UI's polling; the reply carries metadata.taskId so the
// client knows this task is done.
// ----------------------------------------------------------------------------

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
    const fixedEmployee =
      room.kind === "employee" ? room.employee_key : null;

    const decision = await dispatchRequest(
      tenantId,
      userMessage,
      fixedEmployee,
      workspaceContext,
      chatContext
    );
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
    const statusText =
      decision.action === "content"
        ? `${employeeDisplayName} is writing the post and generating the images — this takes a couple of minutes. I'll post the draft here when it's ready.`
        : decision.action === "campaign"
          ? `Malory is mapping out the campaign plan — this takes a minute or two. I'll post the calendar link when it's ready.`
          : `${employeeDisplayName} is putting together a reply…`;
    await supabase.from("team_messages").insert({
      chat_id: chatId,
      role: "system",
      employee_key: null,
      content: statusText,
      metadata: {
        status: true,
        stage:
          decision.action === "content"
            ? "working"
            : decision.action === "campaign"
              ? "planning"
              : "replying",
        taskId,
      },
    });

    // Run the employee: content generation for Cheryl, persona chat otherwise.
    let replyContent = "";
    let replyMeta: Record<string, unknown> = {};

    if (decision.action === "campaign") {
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
          chatContext
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
      const personaPrompt = buildEmployeeSystemPrompt(targetKey, {
        ...config,
        workspaceContext,
        chatContext,
      });
      try {
        replyContent = await generateText(
          "team_chat",
          userMessage,
          tenantId,
          { systemPrompt: personaPrompt, temperature: 0.7, maxTokens: 2048 }
        );
        replyMeta = { action: "chat" };
      } catch (err) {
        replyContent =
          `I couldn't reach my models right now: ${
            err instanceof Error ? err.message : "unknown error"
          }.`;
        replyMeta = { action: "chat_failed" };
      }
    }

    await supabase.from("team_messages").insert({
      chat_id: chatId,
      role: "employee",
      employee_key: targetKey,
      content: replyContent,
      metadata: { ...replyMeta, taskId },
    });
  } catch (err) {
    console.error("[team-task] Task failed:", err);
    // Never leave the user hanging — post an error reply so the client's
    // pending task resolves.
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

  const reviewing: TaskMessageRow = {
    id: crypto.randomUUID(),
    chat_id: input.chatId,
    tenant_id: input.tenantId,
    role: "system",
    employee_key: null,
    content:
      "Malory is reviewing your request and assigning it to the team…",
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

