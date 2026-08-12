import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import { discoverBlogsForTopic } from "@/lib/outreach/discover";

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

    const inserted = await discoverBlogsForTopic(
      tenantId,
      workspaceId,
      topic,
      Array.isArray(body.keywords) ? body.keywords.map((k) => String(k).trim()).filter(Boolean) : []
    );

    return NextResponse.json({
      message:
        inserted > 0
          ? `Discovery complete — ${inserted} blog${inserted === 1 ? "" : "s"} saved as targets.`
          : "Discovery ran but returned no new blogs (they may already exist as targets).",
      count: inserted,
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
