import { NextRequest, NextResponse } from "next/server";
import { getTenantId, requireRole } from "@/lib/auth";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import {
  listCampaignPlans,
  listCampaignPlanItems,
  getCampaignPlanWorkspace,
  updateCampaignItemStatus,
  type CampaignPlan,
  type CampaignPlanItem,
} from "@/lib/campaign-plans";
import { generateApprovedCampaignItem } from "@/lib/ai/team-task";

/**
 * GET /api/campaign-plans
 *
 * Returns the tenant's campaign plans (with their dated items) for the
 * current workspace, newest first. The calendar renders plan items as
 * "proposed" entries alongside the real posts.
 *
 * Query: ?workspaceId= (optional — defaults to the current workspace)
 */
export async function GET(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const { searchParams } = request.nextUrl;
    const workspaceId =
      searchParams.get("workspaceId") ?? (await getCurrentWorkspaceId());

    const [plans, items] = await Promise.all([
      listCampaignPlans(tenantId, workspaceId),
      listCampaignPlanItems(tenantId, workspaceId),
    ]);

    const itemsByPlan = new Map<string, CampaignPlanItem[]>();
    for (const item of items) {
      const list = itemsByPlan.get(item.plan_id) ?? [];
      list.push(item);
      itemsByPlan.set(item.plan_id, list);
    }
    const withItems: CampaignPlan[] = plans.map((p) => ({
      ...p,
      items: itemsByPlan.get(p.id) ?? [],
    }));

    return NextResponse.json({ plans: withItems });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/campaign-plans
 *
 * Approve a proposed campaign item — this approves the IDEA, not the
 * content: the item flips to "draft" and the actual content is generated in
 * the background (Cheryl for blogs with images, Pam for social captions).
 * The generated post lands in "pending_approval" — a second, human approval
 * is required before it can be scheduled or published.
 *
 * Body: { itemId: string }
 */
export async function POST(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    await requireRole("agency_editor");
    const body = (await request.json()) as { itemId?: string; mediaKind?: string };
    const itemId = body.itemId;
    const mediaKind =
      body.mediaKind === "video" ? ("video" as const) : ("image" as const);
    if (!itemId) {
      return NextResponse.json(
        { error: "itemId is required" },
        { status: 400 }
      );
    }

    const items = await listCampaignPlanItems(tenantId);
    const item = items.find((i) => i.id === itemId);
    if (!item) {
      return NextResponse.json(
        { error: "Campaign item not found" },
        { status: 404 }
      );
    }
    if (item.status !== "proposed") {
      return NextResponse.json(
        { error: `Item is already ${item.status}` },
        { status: 409 }
      );
    }

    // Idea approved — mark in progress; content generates in the background
    // (minutes for a blog with images). The UI polls and the post appears
    // as pending_approval when the content is ready.
    await updateCampaignItemStatus(tenantId, itemId, "draft");

    // Website-build milestones have no generated content — approving marks
    // the step in progress; the actual build happens in the Web Builder.
    if (item.kind === "website") {
      return NextResponse.json({
        success: true,
        generating: false,
        message:
          "Website milestone approved — build it in the Web Builder (/dashboard/cms).",
      });
    }

    // Foundation research checkpoints (voice/tone, persona, buyer personas)
    // have no generated content either — approving marks the research done.
    if (item.kind === "research") {
      return NextResponse.json({
        success: true,
        generating: false,
        message:
          "Research checkpoint approved — the team will use this as the campaign's foundation.",
      });
    }

    // The workspace lives on the plan (items are scoped to the tenant).
    const workspaceId = await getCampaignPlanWorkspace(tenantId, item.plan_id);
    void generateApprovedCampaignItem(tenantId, itemId, workspaceId, mediaKind).catch(
      (err) => console.error("[campaign-plans] generate failed:", err)
    );

    return NextResponse.json({
      success: true,
      generating: true,
      message: "Idea approved — generating the content now. It'll land as pending approval when ready.",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
