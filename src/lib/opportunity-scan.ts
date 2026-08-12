import { createClient } from "@supabase/supabase-js";
import { generateStructuredOutput } from "@/lib/ai/orchestrator";

/**
 * Weekly opportunity scan (Reddit / LinkedIn / Quora).
 *
 * For a tenant, asks the configured text model to surface real, relevant
 * places the client could answer questions / post useful content this week,
 * with a concrete recommendation for each. Results land in
 * content_opportunities with week_start so each week is a fresh batch.
 * Runs on demand (button) or weekly via the Inngest cron.
 */

interface OpportunityItem {
  platform: "reddit" | "linkedin" | "quora";
  title: string;
  url: string;
  snippet: string;
  relevance_score: number;
  recommendation: string;
}

export interface ScanContext {
  brandName: string;
  topics: string[];
  targetAudience: string;
}

export function createScanSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Generate a batch of opportunities for one tenant. Returns the count of new
 * rows inserted. Called by POST /api/opportunities/generate and the weekly
 * cron. Never crashes the caller: failures are logged and return 0.
 */
export async function scanOpportunitiesForTenant(
  tenantId: string,
  workspaceId: string | null,
  context: ScanContext,
  weekStart: string
): Promise<{ inserted: number; error?: string }> {
  try {
    const supabase = createScanSupabase();
    const output = await generateStructuredOutput<{ opportunities: OpportunityItem[] }>(
      "team_chat",
      `You are a community-marketing analyst. Find REAL, CURRENT opportunities on
Reddit, LinkedIn, and Quora where this brand could post something genuinely
useful this week. Only include opportunities you are reasonably confident
exist; never invent URLs or subreddits.

PLATFORM RULES (non-negotiable — getting these wrong gets accounts banned):
- REDDIT: never recommend dropping links or self-promotion of any kind (Reddit
  bans blatant promotion and most subreddits have a 9:1 comment-to-promote rule
  or ban promotion outright). Recommendations must be purely helpful comments
  answering the actual question — no product mention, no link, no "we/our"
  unless the conversation explicitly asks. Flag in the recommendation when a
  subreddit's rules should be checked first.
- LINKEDIN: professional and useful; no hard sales pitches, no engagement bait.
  Frame as an expert insight, and only reference the brand if it's genuinely
  relevant to the discussion.
- QUORA: answers must be comprehensive and selfless; no promotional links
  (Quora moderates promotional answers hard).

For each:
- platform: "reddit" | "linkedin" | "quora"
- title: the question / discussion topic
- url: the thread or search URL if confidently known, else an empty string
- snippet: 1-2 sentence summary of what people are asking
- relevance_score: 0-100 fit with the brand
- recommendation: EXACTLY what to post — concrete, helpful, on-topic, and
  platform-safe (per the rules above; value first, promotion last or never)
Return JSON: { "opportunities": [...] } with 5-9 entries across all three
platforms. Useful > self-promotional. If a brand would not be safe to engage
with on a platform, prefer safer alternatives.`,
      `Brand: ${context.brandName}
What we do / topics: ${context.topics.join("; ") || "(generic)"}
Target audience: ${context.targetAudience || "(broad)"}
This week: ${weekStart}
Find 5-9 real, SAFE opportunities where posting something helpful would work,
respecting each platform's anti-promotion rules.`,
      tenantId,
      {
        type: "object",
        properties: {
          opportunities: {
            type: "array",
            items: {
              type: "object",
              properties: {
                platform: { type: "string", enum: ["reddit", "linkedin", "quora"] },
                title: { type: "string" },
                url: { type: "string" },
                snippet: { type: "string" },
                relevance_score: { type: "number" },
                recommendation: { type: "string" },
              },
              required: ["platform", "title", "snippet", "relevance_score", "recommendation"],
            },
          },
        },
        required: ["opportunities"],
      },
      { temperature: 0.5, maxTokens: 2200, functionName: "weekly_opportunity_scan" }
    );

    const items = Array.isArray(output.opportunities) ? output.opportunities.slice(0, 12) : [];
    let inserted = 0;
    for (const item of items) {
      const { error } = await supabase.from("content_opportunities").insert({
        tenant_id: tenantId,
        workspace_id: workspaceId,
        platform: item.platform,
        title: String(item.title ?? "").slice(0, 300) || "Untitled opportunity",
        url: String(item.url ?? "").trim() || null,
        snippet: String(item.snippet ?? "").slice(0, 1000) || null,
        relevance_score: Math.max(0, Math.min(100, Math.round(Number(item.relevance_score) || 0))),
        recommendation: String(item.recommendation ?? "").slice(0, 3000) || null,
        week_start: weekStart,
      });
      if (!error) inserted++;
    }
    return { inserted };
  } catch (err: any) {
    console.error("[opportunity-scan]", tenantId, err?.message);
    return { inserted: 0, error: err?.message ?? "Scan failed" };
  }
}

/** Monday of the current week, as YYYY-MM-DD. */
export function currentWeekStart(): string {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? 6 : day - 1; // Monday = 0
  const monday = new Date(now);
  monday.setDate(now.getDate() - diff);
  return monday.toISOString().slice(0, 10);
}
