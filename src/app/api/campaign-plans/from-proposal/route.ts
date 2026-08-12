import { NextRequest, NextResponse } from "next/server";
import { getTenantId, requireRole } from "@/lib/auth";
import {
  getCurrentWorkspaceId,
  createWorkspace,
  type Workspace,
} from "@/lib/workspace";
import {
  createCampaignFromProposal,
  WEBSITE_PLAN,
} from "@/lib/campaign-from-proposal";

/**
 * POST /api/campaign-plans/from-proposal
 *
 * Materialize a sold SEO proposal tier into a dated campaign plan (proposed
 * items on the Content Calendar), without any LLM call — the proposal's
 * content calendar is the blueprint.
 *
 * Body: { campaignId: string, workspaceId?: string, createWorkspace?: boolean,
 *         includeWebsite?: boolean }
 *
 * When createWorkspace is true, a dedicated workspace is created for the
 * campaign (named after the tier) so its plan, posts and chats stay isolated
 * from the tenant's general work. Falls back to the current workspace when
 * the license's workspace limit is reached, so starting a campaign never
 * hard-fails on quota.
 *
 * When includeWebsite is true, website-build milestones (owned by Ray) are
 * added to the plan so the site build is part of the campaign flow.
 */
export async function POST(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    await requireRole("agency_editor");

    const body = (await request.json()) as {
      campaignId?: string;
      workspaceId?: string;
      createWorkspace?: boolean;
      includeWebsite?: boolean;
    };
    if (!body.campaignId) {
      return NextResponse.json(
        { error: "campaignId is required" },
        { status: 400 }
      );
    }

    let workspaceId =
      body.workspaceId ?? (await getCurrentWorkspaceId());
    let createdWorkspace: Workspace | null = null;

    if (body.createWorkspace && !body.workspaceId) {
      // Read the proposal title first so the workspace name is meaningful.
      const { createClient } = await import("@supabase/supabase-js");
      const sb = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
      );
      const { data: campaign } = await sb
        .from("seo_campaigns")
        .select("tier_name, campaign_json")
        .eq("id", body.campaignId)
        .eq("tenant_id", tenantId)
        .single();
      const json =
        (campaign?.campaign_json ?? {}) as { tierName?: string };
      const name = [
        campaign?.tier_name ?? json.tierName ?? "Campaign",
        "Workspace",
      ].join(" ");

      const created = await createWorkspace(name);
      if (created.success && created.data) {
        workspaceId = created.data.id;
        createdWorkspace = created.data;
      }
      // On quota failure, silently fall back to the current workspace.
    }

    const plan = await createCampaignFromProposal(
      tenantId,
      body.campaignId,
      workspaceId,
      body.includeWebsite === true
    );

    // The sold tier is now live — mark it approved so Recent SEO Audits and
    // the client proposal page show it as started, not just proposed. When a
    // website build was included, attach the full website plan (pages,
    // functions, add-ons) to the campaign so the proposal and build track it.
    const { createClient: makeClient } = await import("@supabase/supabase-js");
    const sb = makeClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    const { data: campaign } = await sb
      .from("seo_campaigns")
      .select("campaign_json")
      .eq("id", body.campaignId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    const campaignJson = (campaign?.campaign_json ?? {}) as Record<string, unknown>;
    if (body.includeWebsite === true) {
      campaignJson.websitePlan = WEBSITE_PLAN;
    } else {
      delete campaignJson.websitePlan;
    }
    await sb
      .from("seo_campaigns")
      .update({
        status: "approved",
        campaign_json: campaignJson,
      })
      .eq("id", body.campaignId)
      .eq("tenant_id", tenantId)
      .in("status", ["proposed", "approved"]);

    return NextResponse.json({
      success: true,
      planId: plan.id,
      planUrl: `/dashboard/calendar?plan=${plan.id}`,
      workspace: createdWorkspace
        ? {
            id: createdWorkspace.id,
            name: createdWorkspace.name,
          }
        : null,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
