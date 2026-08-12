import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import { createServiceClient } from "@/lib/supabase/server";
import { generateStructuredOutput } from "@/lib/ai/orchestrator";

interface DiscoveredBlog {
  blog_name: string;
  blog_url: string;
  contact_email: string;
  relevance_score: number;
  authority_score: number;
  traffic_estimate: string;
  why: string;
}

/**
 * POST /api/outreach/discover
 * Body: { topic: string, keywords?: string[] }
 *
 * Uses the tenant's text model to curate a list of real, relevant blogs that
 * accept guest posts in this niche, with estimated relevance/authority scores
 * and a short "why" line. Results are saved as 'discovered' targets. Scores
 * are AI estimates, labeled as such in the UI.
 */
export async function POST(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    if (!tenantId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const workspaceId = (await getCurrentWorkspaceId().catch(() => null)) ?? null;
    const body = (await request.json().catch(() => ({}))) as {
      topic?: string;
      keywords?: string[];
    };
    const topic = body.topic?.trim();
    if (!topic) {
      return NextResponse.json({ error: "topic is required" }, { status: 400 });
    }

    const discovered = await generateStructuredOutput<{ blogs: DiscoveredBlog[] }>(
      "team_chat",
      `You are an outreach researcher for a digital agency. Find REAL blogs that
publish guest posts relevant to this niche. Only include blogs you are confident
exist (well-known publications or established niche blogs). For each, give:
- blog_name: the blog's name
- blog_url: the exact https:// homepage URL
- contact_email: the blog's guest-post/editor contact email IF widely published,
  otherwise an empty string (never invent an email)
- relevance_score: 0-100 how well this blog matches the niche
- authority_score: 0-100 an estimate of the blog's domain authority / page-rank
  strength (based on how well-known and linked-to it is)
- traffic_estimate: a rough monthly-visitor band like "50k-100k"
- why: one sentence on why they accept relevant guest posts here
Return JSON: { "blogs": [...] } with 6-10 entries. Never invent URLs.`,
      `Niche/topic: ${topic}\nFocus keywords: ${(body.keywords ?? []).join(", ") || "(none)"}\n\nReturn 6-10 real blogs accepting guest posts.`,
      tenantId,
      {
        type: "object",
        properties: {
          blogs: {
            type: "array",
            items: {
              type: "object",
              properties: {
                blog_name: { type: "string" },
                blog_url: { type: "string" },
                contact_email: { type: "string" },
                relevance_score: { type: "number" },
                authority_score: { type: "number" },
                traffic_estimate: { type: "string" },
                why: { type: "string" },
              },
              required: ["blog_name", "blog_url", "relevance_score", "authority_score", "traffic_estimate", "why"],
            },
          },
        },
        required: ["blogs"],
      },
      { temperature: 0.4, maxTokens: 2000, functionName: "discover_guest_post_blogs" }
    );

    const blogs = Array.isArray(discovered.blogs) ? discovered.blogs.slice(0, 12) : [];
    if (blogs.length === 0) {
      return NextResponse.json({ error: "Discovery returned no blogs — try again." }, { status: 502 });
    }

    const supabase = await createServiceClient();
    let inserted = 0;
    let skipped = 0;
    for (const blog of blogs) {
      const url = String(blog.blog_url ?? "").trim();
      if (!/^https?:\/\//.test(url)) continue;
      const { error } = await supabase.from("outreach_targets").insert({
        tenant_id: tenantId,
        workspace_id: workspaceId,
        blog_name: String(blog.blog_name ?? "").slice(0, 200) || url,
        blog_url: url,
        contact_email: String(blog.contact_email ?? "").trim() || null,
        relevance_score: Math.max(0, Math.min(100, Math.round(Number(blog.relevance_score) || 0))),
        authority_score: Math.max(0, Math.min(100, Math.round(Number(blog.authority_score) || 0))),
        traffic_estimate: String(blog.traffic_estimate ?? "").slice(0, 100) || null,
        notes: String(blog.why ?? "").slice(0, 2000) || null,
      });
      if (error && error.code === "23505") skipped++;
      else if (!error) inserted++;
    }

    return NextResponse.json({
      inserted,
      skipped,
      message: `Found ${inserted} new blog${inserted === 1 ? "" : "s"}${skipped ? ` (${skipped} already tracked)` : ""}. Scores are AI estimates.`,
    });
  } catch (err: any) {
    const message = err?.message ?? "Internal error";
    const noKey = message.includes("No API key") || message.includes("no provider");
    return NextResponse.json(
      { error: noKey ? "No AI provider key configured. Add one in AI Settings → API Keys." : message },
      { status: 500 }
    );
  }
}
