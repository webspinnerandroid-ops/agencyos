import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { crawlWebsite, toAuditData } from "@/lib/seo/auditor";
import {
  discoverCompetitors,
  toCompetitorData,
} from "@/lib/seo/competitors";
import { generateStructuredOutput } from "@/lib/ai/orchestrator";
import { getSeoCampaignPrompt, type CampaignTier } from "@/lib/ai/seo-prompts";
import type { AITask } from "@/lib/ai/orchestrator";

// ============================================================================
// Types
// ============================================================================

interface GenerateCampaignRequest {
  clientId: string;
  url: string;
}

interface CampaignObject {
  tierName: string;
  tierPrice: number;
  executiveSummary: string;
  targetKeywords: {
    keyword: string;
    searchVolume: number;
    difficulty: "low" | "medium" | "high";
    currentRanking: number | null;
    targetRanking: number;
    intent: "informational" | "commercial" | "transactional" | "navigational";
  }[];
  contentCalendar: {
    month: number;
    focusArea: string;
    contentPieces: {
      type:
        | "blog_post"
        | "landing_page"
        | "case_study"
        | "whitepaper"
        | "video"
        | "infographic";
      title: string;
      targetKeyword: string;
      description: string;
      estimatedWordCount: number;
      priority: "high" | "medium" | "low";
    }[];
    technicalTasks: string[];
    linkBuildingTasks: string[];
    expectedOutcomes: string;
  }[];
  technicalRecommendations: {
    category: string;
    issue: string;
    solution: string;
    priority: "critical" | "high" | "medium" | "low";
    estimatedImpact: string;
  }[];
  onPageOptimizations: {
    page: string;
    currentState: string;
    recommendedChanges: string;
    targetKeyword: string;
  }[];
  offPageStrategy: {
    summary: string;
    linkBuildingApproach: string;
    targetDomains: string[];
    contentMarketingChannels: string[];
    socialMediaStrategy: string;
  };
  kpisAndMetrics: {
    targetOrganicTrafficIncrease: string;
    targetKeywordImprovements: string;
    targetConversionRate: string;
    targetDomainAuthority: string;
    additionalMetrics: string[];
  };
  timeline: {
    totalDuration: string;
    phases: {
      phase: string;
      duration: string;
      focus: string;
      deliverables: string[];
    }[];
  };
  estimatedROI: string;
  differentiators: string[];
}

// ============================================================================
// Correct pricing tiers — Bronze, Silver, Gold + Custom
// ============================================================================

const DEFAULT_TIERS: CampaignTier[] = [
  {
    name: "Bronze – Essentials",
    price: 1000,
    deliverables: [
      "2 long-form SEO blog posts per month (website)",
      "Basic on-page SEO (meta tags, internal links, keyword optimization)",
      "Google Business Profile monthly update",
      "Basic backlink outreach (1–2 directory/relevant listings per month)",
      "Monthly performance report (traffic, rankings, engagement)",
      "6-month commitment: $6,000 total ($1,000/mo)",
    ],
    description:
      "For local visibility, brand maintenance, and budget-conscious growth. Maintains consistent online presence, supports local SEO and Google Maps visibility, and keeps pace with local competitors. Ideal for steady, budget-friendly growth.",
  },
  {
    name: "Silver – Growth",
    price: 2500,
    deliverables: [
      "4 long-form SEO blog posts per month (3 website, 1 authority/guest post)",
      "On-page and technical SEO audit & fixes",
      "Google Business Profile optimization + review strategy",
      "Backlink outreach (3–5 quality links per month: guest posts, directories, niche listings)",
      "Social media content calendar (2–3 posts/week, copy only)",
      "Monthly analytics, keyword tracking, and recommendations",
      "6-month commitment: $15,000 total ($2,500/mo)",
    ],
    description:
      "For regional reach, competitive SEO, and audience growth. Matches/exceeds most regional competitors with authority-building guest posts and backlinks. Drives steady growth in bookings and brand reputation.",
  },
  {
    name: "Gold – Market Leader",
    price: 5000,
    deliverables: [
      "8 long-form posts per month (4 website, 4 authority/guest posts)",
      "Advanced on-page, technical, and local SEO (site speed, schema, mobile UX)",
      "Aggressive backlink outreach (6–10 high-DA links per month)",
      "Social media management (calendar, copy, basic graphics, 4–5 posts/week)",
      "Quarterly press releases or influencer/blogger outreach",
      "Google Business Profile management & review generation",
      "Monthly analytics, DA/PA tracking, and strategy sessions",
      "6-month commitment: $30,000 total ($5,000/mo)",
    ],
    description:
      "For regional dominance, aggressive growth, and brand leadership. Outpaces all competitors in content and SEO. Rapidly increases authority, search rankings, and referral traffic. Drives engagement and reviews across platforms.",
  },
  {
    name: "Custom / Enterprise",
    price: null,
    deliverables: [
      "Tailored strategy for large corporations, multi-location chains, or unique business models",
      "Custom pricing based on scope, number of locations, and competitive landscape",
      "Contact us via the inquiry form or email for a personalized assessment and proposal",
      "Dedicated enterprise strategist assigned to your account",
    ],
    description:
      "Bespoke enterprise SEO solutions for organizations requiring customized strategies. Pricing is determined after a comprehensive business assessment. Contact us directly to begin.",
  },
];

// ============================================================================
// POST handler
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    // ------------------------------------------------------------------
    // 1. Authenticate & get tenant
    // ------------------------------------------------------------------
    const tenantId = await getTenantId();
    if (!tenantId) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const supabase = await createServiceClient();

    // ------------------------------------------------------------------
    // 2. Parse body
    // ------------------------------------------------------------------
    let body: GenerateCampaignRequest & { clientName?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const { clientId, clientName, url } = body as any;

    let resolvedClientId: string | null = null;

    // Resolve client by UUID or name
    if (clientId && typeof clientId === "string") {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (uuidRegex.test(clientId)) {
        resolvedClientId = clientId;
      }
    }

    if (!resolvedClientId && clientName && typeof clientName === "string") {
      try {
        const lookupClient = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { autoRefreshToken: false, persistSession: false } }
        );
        const { data: match } = await lookupClient
          .from("clients")
          .select("id")
          .eq("tenant_id", tenantId)
          .ilike("name", clientName.trim())
          .limit(1)
          .single();

        if (match?.id) {
          resolvedClientId = match.id;
        } else {
          const { data: created } = await lookupClient
            .from("clients")
            .insert({
              tenant_id: tenantId,
              name: clientName.trim(),
              website: url ?? null,
            })
            .select("id")
            .single();
          if (created?.id) resolvedClientId = created.id;
        }
      } catch (e: any) {
        return NextResponse.json(
          { error: "Failed to resolve or create client", details: e?.message },
          { status: 500 }
        );
      }
    }

    if (!resolvedClientId) {
      return NextResponse.json(
        { error: "clientId or clientName is required" },
        { status: 400 }
      );
    }

    if (!url || typeof url !== "string") {
      return NextResponse.json(
        { error: "url is required" },
        { status: 400 }
      );
    }

    // ------------------------------------------------------------------
    // 3. Crawl the website (defensive)
    // ------------------------------------------------------------------
    let siteAudit;
    try {
      siteAudit = await crawlWebsite(url);
    } catch (crawlError: any) {
      console.error("[generate-campaign] Crawl failed:", crawlError?.message);
      return NextResponse.json(
        {
          error: "Failed to crawl website",
          details: crawlError?.message ?? "The website could not be reached. Check the URL and try again.",
        },
        { status: 422 }
      );
    }

    const auditData = toAuditData(siteAudit);

    // ------------------------------------------------------------------
    // 4. Discover competitors (defensive)
    // ------------------------------------------------------------------
    let competitorData: any[] = [];
    try {
      const competitorUrls = await discoverCompetitors(
        new URL(siteAudit.url).hostname,
        tenantId,
        {
          url: siteAudit.url,
          homepageTitle: siteAudit?.homepage?.title,
          metaDescription: siteAudit?.homepage?.metaDescription,
          overallScore: auditData.overallScore,
        }
      );
      competitorData = await toCompetitorData(competitorUrls, {
        url: siteAudit.url,
        homepageTitle: siteAudit?.homepage?.title,
        metaDescription: siteAudit?.homepage?.metaDescription,
        overallScore: auditData.overallScore,
      });
    } catch (compError: any) {
      console.warn("[generate-campaign] Competitor discovery failed, continuing without:", compError?.message);
      competitorData = [];
    }

    // ------------------------------------------------------------------
    // 5. Fetch tier templates for the tenant (or use defaults)
    // ------------------------------------------------------------------
    let tiers: CampaignTier[] = DEFAULT_TIERS;

    try {
      const { data: tierTemplates } = await supabase
        .from("tier_templates")
        .select("name, price, deliverables, description")
        .eq("tenant_id", tenantId)
        .order("price", { ascending: true });

      if (tierTemplates && tierTemplates.length >= 2) {
        tiers = tierTemplates as CampaignTier[];
      }
    } catch {
      console.warn(
        "[generate-campaign] Could not fetch tier_templates, using defaults"
      );
    }

    // ------------------------------------------------------------------
    // 6. Get current user
    // ------------------------------------------------------------------
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const userId = user?.id ?? null;

    // ------------------------------------------------------------------
    // 7. Call AI to generate campaign JSON (defensive)
    // ------------------------------------------------------------------
    const systemPrompt = getSeoCampaignPrompt(
      auditData,
      competitorData,
      tiers
    );

    const userPrompt = `Generate detailed SEO campaign plans for ${url}.
The website audit revealed an overall score of ${auditData.overallScore}/100 with ${auditData.technicalIssues?.length ?? 0} technical issues and ${auditData.onPageIssues?.length ?? 0} on-page issues.
Competitors include: ${competitorData.map((c: any) => c.competitorUrl).join(", ") || "none detected"}.

IMPORTANT: Recommend the SINGLE BEST TIER for this business based on: their current site quality, number of competitors, industry competitiveness, current rankings, and content gaps. Include a "recommended_tier" field with the tier name and a brief justification.

Create one campaign per tier that is realistic, actionable, and tailored to the actual findings.`;

    let campaigns;
    try {
      campaigns = await generateStructuredOutput<CampaignObject[]>(
        "seo_campaign_generation" as AITask,
        systemPrompt,
        userPrompt,
        tenantId,
        {
          type: "object",
          properties: {
            campaigns: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  tierName: { type: "string" },
                  tierPrice: { type: "number" },
                  executiveSummary: { type: "string" },
                  targetKeywords: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        keyword: { type: "string" },
                        searchVolume: { type: "number" },
                        difficulty: {
                          type: "string",
                          enum: ["low", "medium", "high"],
                        },
                        currentRanking: { type: ["number", "null"] },
                        targetRanking: { type: "number" },
                        intent: {
                          type: "string",
                          enum: [
                            "informational",
                            "commercial",
                            "transactional",
                            "navigational",
                          ],
                        },
                      },
                      required: [
                        "keyword",
                        "searchVolume",
                        "difficulty",
                        "currentRanking",
                        "targetRanking",
                        "intent",
                      ],
                    },
                  },
                },
                required: ["tierName", "tierPrice", "executiveSummary"],
              },
            },
            recommended_tier: {
              type: "object",
              properties: {
                tierName: { type: "string" },
                justification: { type: "string" },
                keyFactors: {
                  type: "array",
                  items: { type: "string" },
                },
              },
              required: ["tierName", "justification"],
            },
          },
          required: ["campaigns", "recommended_tier"],
        },
        {
          clientId: resolvedClientId,
          functionName: "generate_seo_campaigns",
          temperature: 0.4,
          maxTokens: 16384,
        }
      );
    } catch (aiError: any) {
      console.error("[generate-campaign] AI generation failed:", aiError?.message);
      return NextResponse.json(
        { error: "AI generation failed", details: aiError?.message ?? "Could not generate campaigns" },
        { status: 500 }
      );
    }

    // Unwrap from { campaigns: [...] } wrapper
    const rawResult = campaigns as any;
    const campaignArray: CampaignObject[] = Array.isArray(rawResult?.campaigns)
      ? rawResult.campaigns
      : Array.isArray(rawResult)
        ? rawResult
        : [rawResult];

    const recommendedTier = rawResult?.recommended_tier ?? null;

    // ------------------------------------------------------------------
    // 8. Store campaigns in seo_campaigns table
    // ------------------------------------------------------------------
    const storedCampaigns: unknown[] = [];

    for (const campaign of campaignArray) {
      try {
        // Idempotency guard: skip if an identical proposed campaign exists
        // for this tenant + client + URL + tier (prevents duplicate saves on
        // double-click / retry — see SEO Audit Review finding).
        const { data: existing } = await supabase
          .from("seo_campaigns")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("client_id", resolvedClientId)
          .eq("url", siteAudit.url)
          .eq("tier_name", campaign.tierName)
          .in("status", ["proposed", "approved", "active"])
          .limit(1);

        if (existing && existing.length > 0) {
          storedCampaigns.push({
            id: existing[0].id,
            deduplicated: true,
          });
          continue;
        }

        const { data: stored, error: insertError } = await supabase
          .from("seo_campaigns")
          .insert({
            tenant_id: tenantId,
            client_id: resolvedClientId,
            url: siteAudit.url,
            tier_name: campaign.tierName,
            tier_price: campaign.tierPrice,
            status: "proposed",
            campaign_json: campaign,
            audit_json: siteAudit,
            competitors_json: competitorData,
            created_by: userId,
          })
          .select("*")
          .single();

        if (insertError) {
          console.error("[generate-campaign] Failed to store campaign:", insertError);
        } else if (stored) {
          storedCampaigns.push(stored);
        }
      } catch (storeError: any) {
        console.error("[generate-campaign] Store error:", storeError?.message);
      }
    }

    // ------------------------------------------------------------------
    // 9. Return the generated campaigns (always JSON)
    // ------------------------------------------------------------------
    return NextResponse.json({
      success: true,
      audit: {
        url: siteAudit.url,
        overallScore: siteAudit.overallScore,
        technicalIssues: siteAudit.technicalIssues.length,
        onPageIssues: siteAudit.onPageIssues.length,
      },
      competitors: competitorData.map((c: any) => c.competitorUrl),
      campaigns: storedCampaigns,
      recommended_tier: recommendedTier,
    });
  } catch (error: any) {
    console.error("[generate-campaign] Unexpected error:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    // ALWAYS return JSON, never let Next.js render HTML
    return NextResponse.json(
      { error: "Internal server error", details: message },
      { status: 500 }
    );
  }
}