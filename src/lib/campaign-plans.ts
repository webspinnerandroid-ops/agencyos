// ============================================================================
// Campaign plans — Malory's mapped-out campaigns, surfaced as a calendar.
//
// A campaign plan is a title + summary + dated items (blog posts / social
// posts). The AI team writes plans (structured output from Malory in the chat
// pipeline), and the Content Calendar renders the items as "proposed" entries
// alongside the real posts (draft / scheduled / published).
//
// All access goes through tenantScopedClient (tenant_id forced on write,
// auto-filtered on read) — same isolation pattern as ai-team-chat.ts.
// ============================================================================

import { createServiceClient } from "@/lib/supabase/server";
import { tenantScopedClient } from "@/lib/supabase/tenant-scope";

export type CampaignPlanStatus =
  | "proposed"
  | "active"
  | "completed"
  | "archived";

export type CampaignItemKind = "blog" | "social";
export type CampaignItemStatus =
  | "proposed"
  | "draft"
  | "scheduled"
  | "published"
  | "dropped";

export interface CampaignPlanItem {
  id: string;
  plan_id: string;
  tenant_id: string;
  kind: CampaignItemKind;
  topic: string;
  due_date: string;
  platform: string | null;
  owner: string | null;
  status: CampaignItemStatus;
  linked_post_id: string | null;
  keywords: string[] | null;
  internal_link: string | null;
  external_links: string[] | null;
  created_at: string;
}

export interface CampaignPlan {
  id: string;
  tenant_id: string;
  workspace_id: string | null;
  client_id: string | null;
  title: string;
  summary: string;
  status: CampaignPlanStatus;
  created_by: string | null;
  created_at: string;
  items?: CampaignPlanItem[];
}

export interface CampaignPlanInput {
  title: string;
  summary: string;
  workspaceId: string | null;
  createdBy?: string | null;
  items: {
    kind: CampaignItemKind;
    topic: string;
    dueDate: string; // YYYY-MM-DD
    platform?: string | null;
    owner?: string | null;
    keywords?: string[] | null;
    internalLink?: string | null;
    externalLinks?: string[] | null;
  }[];
}

/** Create a plan + its dated items (single tenant transaction-ish insert). */
export async function createCampaignPlan(
  tenantId: string,
  input: CampaignPlanInput
): Promise<CampaignPlan> {
  const supabase = tenantScopedClient(await createServiceClient(), tenantId);

  const { data: plan, error: planError } = await supabase
    .from("campaign_plans")
    .insert({
      workspace_id: input.workspaceId,
      client_id: null,
      title: input.title,
      summary: input.summary,
      status: "proposed",
      created_by: input.createdBy ?? "nina",
    })
    .select("*")
    .single();
  if (planError) throw new Error(`Failed to create campaign plan: ${planError.message}`);
  if (!plan) throw new Error("Failed to create campaign plan");

  if (input.items.length > 0) {
    const { error: itemsError } = await supabase.from("campaign_plan_items").insert(
      input.items.map((item) => ({
        plan_id: plan.id,
        kind: item.kind,
        topic: item.topic,
        due_date: item.dueDate,
        platform: item.platform ?? null,
        owner: item.owner ?? null,
        keywords: item.keywords ?? null,
        internal_link: item.internalLink ?? null,
        external_links: item.externalLinks ?? null,
        status: "proposed",
      }))
    );
    if (itemsError) {
      throw new Error(`Failed to save campaign plan items: ${itemsError.message}`);
    }
  }

  const withItems = await getCampaignPlan(tenantId, plan.id);
  return withItems ?? (plan as CampaignPlan);
}

/** Fetch one plan with its items (tenant-ownership enforced by the client). */
export async function getCampaignPlan(
  tenantId: string,
  planId: string
): Promise<CampaignPlan | null> {
  const supabase = tenantScopedClient(await createServiceClient(), tenantId);
  const { data: plan } = await supabase
    .from("campaign_plans")
    .select("*")
    .eq("id", planId)
    .maybeSingle();
  if (!plan) return null;
  const { data: items } = await supabase
    .from("campaign_plan_items")
    .select("*")
    .eq("plan_id", planId)
    .order("due_date");
  return { ...(plan as CampaignPlan), items: (items ?? []) as CampaignPlanItem[] };
}

/** List plans for a workspace (or all of the tenant), newest first. */
export async function listCampaignPlans(
  tenantId: string,
  workspaceId?: string | null
): Promise<CampaignPlan[]> {
  const supabase = tenantScopedClient(await createServiceClient(), tenantId);
  let query = supabase
    .from("campaign_plans")
    .select("*")
    .order("created_at", { ascending: false });
  if (workspaceId) query = query.eq("workspace_id", workspaceId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as CampaignPlan[];
}

/** Fetch all items across the tenant's plans (used by the calendar). */
export async function listCampaignPlanItems(
  tenantId: string,
  workspaceId?: string | null
): Promise<CampaignPlanItem[]> {
  const supabase = tenantScopedClient(await createServiceClient(), tenantId);

  // Items are scoped via the tenant filter; plan workspace filtering is a
  // post-filter on the joined plan id set (bounded: plan count is small).
  let planQuery = supabase
    .from("campaign_plans")
    .select("id")
    .order("created_at", { ascending: false });
  if (workspaceId) planQuery = planQuery.eq("workspace_id", workspaceId);
  const { data: plans, error: planError } = await planQuery;
  if (planError) throw new Error(planError.message);
  const planIds = (plans ?? []).map((p) => p.id);
  if (planIds.length === 0) return [];

  const { data, error } = await supabase
    .from("campaign_plan_items")
    .select("*")
    .in("plan_id", planIds)
    .order("due_date");
  if (error) throw new Error(error.message);
  return (data ?? []) as CampaignPlanItem[];
}

/**
 * Replace a plan's title/summary and its items (used by "Refine with Malory"
 * after a polish pass — old items are dropped, refined ones take their place).
 */
export async function updateCampaignPlan(
  tenantId: string,
  planId: string,
  input: {
    title?: string;
    summary?: string;
    items?: {
      kind: CampaignItemKind;
      topic: string;
      dueDate: string;
      platform?: string | null;
      owner?: string | null;
      keywords?: string[] | null;
      internalLink?: string | null;
      externalLinks?: string[] | null;
    }[];
  }
): Promise<void> {
  const supabase = tenantScopedClient(await createServiceClient(), tenantId);
  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.summary !== undefined) patch.summary = input.summary;
  if (Object.keys(patch).length > 0) {
    const { error: planError } = await supabase
      .from("campaign_plans")
      .update(patch)
      .eq("id", planId);
    if (planError) throw new Error(planError.message);
  }
  if (input.items && input.items.length > 0) {
    // Replace items: drop old ones (linked posts stay untouched), insert new.
    const { error: delError } = await supabase
      .from("campaign_plan_items")
      .delete()
      .eq("plan_id", planId);
    if (delError) throw new Error(delError.message);
    const { error: insError } = await supabase.from("campaign_plan_items").insert(
      input.items.map((item) => ({
        plan_id: planId,
        kind: item.kind,
        topic: item.topic,
        due_date: item.dueDate,
        platform: item.platform ?? null,
        owner: item.owner ?? null,
        keywords: item.keywords ?? null,
        internal_link: item.internalLink ?? null,
        external_links: item.externalLinks ?? null,
        status: "proposed",
      }))
    );
    if (insError) throw new Error(insError.message);
  }
}

/** The workspace a plan belongs to (tenant-scoped lookup). */
export async function getCampaignPlanWorkspace(
  tenantId: string,
  planId: string
): Promise<string | null> {
  const supabase = tenantScopedClient(await createServiceClient(), tenantId);
  const { data } = await supabase
    .from("campaign_plans")
    .select("workspace_id")
    .eq("id", planId)
    .maybeSingle();
  return data?.workspace_id ?? null;
}

/** Update an item's status (e.g. draft → scheduled once a post exists). */
export async function updateCampaignItemStatus(
  tenantId: string,
  itemId: string,
  status: CampaignItemStatus,
  linkedPostId?: string | null
): Promise<void> {
  const supabase = tenantScopedClient(await createServiceClient(), tenantId);
  const patch: Record<string, unknown> = { status };
  if (linkedPostId !== undefined) patch.linked_post_id = linkedPostId;
  const { error } = await supabase
    .from("campaign_plan_items")
    .update(patch)
    .eq("id", itemId);
  if (error) throw new Error(error.message);
}
