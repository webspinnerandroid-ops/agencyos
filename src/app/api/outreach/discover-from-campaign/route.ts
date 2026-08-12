import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import { createServiceClient } from "@/lib/supabase/server";
import { discoverBlogsForTopic } from "@/lib/outreach/discover";

/**
 * POST /api/outreach/discover-from-campaign
 *
 * Pulls the actual blog topics from the workspace's mapped-out campaign plans
 * (Malory's roadmap) and runs guest-post discovery for them — so outreach
 * follows the established content roadmap instead of ad-hoc topics. Reuses
 * the same discovery engine as /api/outreach/discover.
 */
export async function POST(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    if (!tenantId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const workspaceId = (await getCurrentWorkspaceId().catch(() => null)) ?? null;

    const supabase = await createServiceClient();
    // campaign_plan_items carry no workspace_id — join through the plan.
    const q = supabase
      .from("campaign_plan_items")
      .select("topic, campaign_plans!inner(workspace_id)")
      .eq("tenant_id", tenantId)
      .eq("kind", "blog")
      .order("due_date", { ascending: false });

    const { data: items } = workspaceId
      ? await q.eq("campaign_plans.workspace_id", workspaceId).limit(10)
      : await q.limit(10);
    const topics = (items ?? [])
      .map((i: { topic: string }) => i.topic?.trim())
      .filter((t: string | undefined): t is string => Boolean(t));

    if (topics.length === 0) {
      return NextResponse.json(
        { error: "No blog topics found in your campaign plans yet. Ask Malory to map out a campaign first." },
        { status: 400 }
      );
    }

    // Discover for the top 3 roadmap topics so a run stays fast and focused.
    const chosen = topics.slice(0, 3);
    let total = 0;
    for (const topic of chosen) {
      try {
        total += await discoverBlogsForTopic(tenantId, workspaceId, topic, [], `campaign plan topic`);
      } catch (err) {
        console.warn(`[outreach] Discovery failed for topic "${topic}":`, err);
      }
    }

    return NextResponse.json({
      message: `Discovery complete — searched ${chosen.length} campaign topic${chosen.length === 1 ? "" : "s"} and saved ${total} new target${total === 1 ? "" : "s"}.`,
      topics: chosen,
      count: total,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 });
  }
}
