"use server";

import { getTenantId, requireRole } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import {
  LIFECYCLE_STEPS,
  advanceLifecycle,
  completeLifecycle,
  getLifecycle,
  getOrCreateLifecycle,
  narrateToTeamRoom,
  stepIndexFor,
} from "@/lib/client-lifecycle";
import { createCampaignFromProposal } from "@/lib/campaign-from-proposal";
import { slugify } from "@/lib/cms";
import { getOrCreateTeamChat, sendChatMessage } from "@/lib/ai-team-chat";
import { listWorkspaceOptions, type WorkspaceOption } from "../../actions";

// ---------------------------------------------------------------------------
// Data for the wizard
// ---------------------------------------------------------------------------

export interface WizardData {
  client: {
    id: string;
    name: string;
    website: string | null;
    workspace_id: string | null;
  };
  lifecycle: {
    step: number;
    status: string;
    data: Record<string, unknown>;
  };
  workspace: { id: string; name: string } | null;
  workspaces: WorkspaceOption[];
  connections: { provider: string; selected_resource: string | null }[];
  brandProfiles: { id: string; name: string; is_default: boolean }[];
  proposals: { id: string; tier_name: string | null; status: string }[];
  plans: { id: string; title: string; status: string }[];
  platforms: {
    blog: { id: string; site_name: string; site_url: string }[];
    social: { id: string; platform: string; account_name: string | null }[];
  };
}

export async function getWizardData(clientId: string): Promise<WizardData> {
  const tenantId = await getTenantId();
  const supabase = await createServiceClient();

  const { data: client } = await supabase
    .from("clients")
    .select("id, name, website, workspace_id")
    .eq("id", clientId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!client) throw new Error("Client not found");

  const lifecycle =
    (await getLifecycle(tenantId, clientId)) ??
    (await getOrCreateLifecycle(tenantId, clientId, client.workspace_id ?? null));

  const workspaceId = lifecycle.workspace_id ?? client.workspace_id;
  const workspaceOptions = await listWorkspaceOptions();

  const [wsRes, connRes, bpRes, propRes, planRes, blogRes, socialRes] =
    await Promise.all([
      workspaceId
        ? supabase.from("workspaces").select("id, name").eq("id", workspaceId).eq("tenant_id", tenantId).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("tenant_connections")
        .select("provider, selected_resource")
        .eq("tenant_id", tenantId),
      workspaceId
        ? supabase
            .from("brand_profiles")
            .select("id, name, is_default")
            .eq("tenant_id", tenantId)
            .eq("workspace_id", workspaceId)
            .order("is_default", { ascending: false })
        : Promise.resolve({ data: [] }),
      supabase
        .from("seo_campaigns")
        .select("id, tier_name, status")
        .eq("tenant_id", tenantId)
        .eq("client_id", clientId)
        .in("status", ["approved", "deployed", "active"])
        .order("created_at", { ascending: false })
        .limit(20),
      workspaceId
        ? supabase
            .from("campaign_plans")
            .select("id, title, status")
            .eq("tenant_id", tenantId)
            .eq("workspace_id", workspaceId)
            .order("created_at", { ascending: false })
            .limit(10)
        : Promise.resolve({ data: [] }),
      supabase
        .from("blog_platforms")
        .select("id, site_name, site_url")
        .eq("tenant_id", tenantId)
        .limit(20),
      supabase
        .from("social_accounts")
        .select("id, platform, account_name")
        .eq("tenant_id", tenantId)
        .limit(20),
    ]);

  return {
    client: {
      id: client.id,
      name: client.name,
      website: client.website,
      workspace_id: client.workspace_id,
    },
    lifecycle: {
      step: lifecycle.step,
      status: lifecycle.status,
      data: (lifecycle.data ?? {}) as Record<string, unknown>,
    },
    workspace: (wsRes?.data as { id: string; name: string } | null) ?? null,
    workspaces: workspaceOptions,
    connections:
      (connRes?.data as { provider: string; selected_resource: string | null }[]) ?? [],
    brandProfiles:
      (bpRes?.data as { id: string; name: string; is_default: boolean }[]) ?? [],
    proposals:
      (propRes?.data as { id: string; tier_name: string | null; status: string }[]) ?? [],
    plans:
      (planRes?.data as { id: string; title: string; status: string }[]) ?? [],
    platforms: {
      blog: (blogRes?.data as { id: string; site_name: string; site_url: string }[]) ?? [],
      social:
        (socialRes?.data as {
          id: string;
          platform: string;
          account_name: string | null;
        }[]) ?? [],
    },
  };
}

// ---------------------------------------------------------------------------
// Step actions
// ---------------------------------------------------------------------------

async function resolveWorkspaceForClient(
  tenantId: string,
  clientId: string
): Promise<string | null> {
  const supabase = await createServiceClient();
  const { data: client } = await supabase
    .from("clients")
    .select("workspace_id, name")
    .eq("id", clientId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!client) throw new Error("Client not found");
  if (client.workspace_id) return client.workspace_id;

  const base = slugify(client.name || "Client").slice(0, 40);
  const { data: ws, error } = await supabase
    .from("workspaces")
    .insert({
      tenant_id: tenantId,
      name: client.name || "Client Workspace",
      slug: `${base}-${crypto.randomUUID().slice(0, 8)}`,
      is_default: false,
    })
    .select("id")
    .single();
  if (error || !ws) throw new Error(`Failed to create workspace: ${error?.message ?? ""}`);

  await supabase
    .from("clients")
    .update({ workspace_id: ws.id })
    .eq("id", clientId)
    .eq("tenant_id", tenantId);
  await supabase
    .from("client_onboarding")
    .update({ workspace_id: ws.id })
    .eq("tenant_id", tenantId)
    .eq("client_id", clientId);
  return ws.id;
}

export async function ensureClientWorkspace(
  clientId: string
): Promise<{ workspaceId: string }> {
  const tenantId = await getTenantId();
  await requireRole("agency_editor");
  const workspaceId = await resolveWorkspaceForClient(tenantId, clientId);
  if (!workspaceId) throw new Error("Could not resolve a workspace");
  return { workspaceId };
}

/**
 * Assign an existing workspace to the client (instead of creating a new one).
 * Validates that the workspace belongs to this tenant, then links both the
 * client row and its onboarding lifecycle to it.
 */
export async function assignExistingWorkspace(
  clientId: string,
  workspaceId: string
): Promise<{ workspaceId: string }> {
  const tenantId = await getTenantId();
  await requireRole("agency_editor");
  const supabase = await createServiceClient();

  const { data: ws } = await supabase
    .from("workspaces")
    .select("id")
    .eq("id", workspaceId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!ws) throw new Error("Workspace not found");

  await supabase
    .from("clients")
    .update({ workspace_id: workspaceId })
    .eq("id", clientId)
    .eq("tenant_id", tenantId);
  await supabase
    .from("client_onboarding")
    .update({ workspace_id: workspaceId })
    .eq("tenant_id", tenantId)
    .eq("client_id", clientId);

  return { workspaceId };
}

export async function advanceStep(
  clientId: string,
  stepId: string,
  data?: Record<string, unknown>
): Promise<{ step: number; status: string }> {
  const tenantId = await getTenantId();
  await requireRole("agency_editor");

  const lifecycle = await getLifecycle(tenantId, clientId);
  if (!lifecycle) throw new Error("Onboarding not started");

  // Steps 1 and 2 need a workspace to anchor the narration.
  const workspaceId =
    lifecycle.workspace_id ??
    (await resolveWorkspaceForClient(tenantId, clientId).catch(() => null));

  const { lifecycle: updated } = await advanceLifecycle(
    tenantId,
    clientId,
    stepId,
    data
  );

  const step = LIFECYCLE_STEPS[stepIndexFor(stepId)];
  const { data: client } = await (await createServiceClient())
    .from("clients")
    .select("name")
    .eq("id", clientId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const name = client?.name ?? "the client";
  const notes: Record<string, string> = {
    client_workspace: `Step 1 done for **${name}** — client confirmed and workspace ready.`,
    connections: `Step 2 done for **${name}** — the tools are connected, so audits and rankings have real data.`,
    brand_profile: `Step 3 done for **${name}** — brand voice, tone and persona are saved; the team will write inside them.`,
    content_plan: `Step 4 done for **${name}** — the content plan is on the calendar.`,
    publish_targets: `Step 5 done for **${name}** — publish targets confirmed.`,
    go_live: `Step 6 done for **${name}** — onboarding complete, the campaign is live!`,
  };
  try {
    await narrateToTeamRoom(tenantId, workspaceId, notes[stepId] ?? "", "lifecycle_step");
  } catch {
    // narration is best-effort — never block the wizard on it
  }

  return { step: updated.step, status: updated.status };
}

export async function createPlanFromProposal(
  clientId: string,
  campaignId: string
): Promise<{ planId: string }> {
  const tenantId = await getTenantId();
  await requireRole("agency_editor");
  const workspaceId = await resolveWorkspaceForClient(tenantId, clientId);

  const plan = await createCampaignFromProposal(tenantId, campaignId, workspaceId, true);
  // Attach the plan to this client so the calendar and AI team scope it.
  const supabase = await createServiceClient();
  await supabase
    .from("campaign_plans")
    .update({ client_id: clientId })
    .eq("id", plan.id)
    .eq("tenant_id", tenantId);

  try {
    await narrateToTeamRoom(
      tenantId,
      workspaceId,
      `The **${plan.title}** plan is on the calendar — seeded straight from the approved proposal so nothing drifts from what was sold. Approve the items to turn them into drafts.`,
      "plan_seeded"
    );
  } catch {
    // best-effort
  }
  return { planId: plan.id };
}

export async function delegateToMalory(
  clientId: string,
  stepId: string
): Promise<{ ok: boolean }> {
  const tenantId = await getTenantId();
  await requireRole("agency_editor");
  const supabase = await createServiceClient();
  const { data: client } = await supabase
    .from("clients")
    .select("name")
    .eq("id", clientId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const name = client?.name ?? "this client";

  const prompts: Record<string, string> = {
    client_workspace: `Onboarding check-in for ${name}: we've just confirmed the client and their workspace. Acknowledge and stand by for the next step.`,
    connections: `We're at Step 2 of onboarding for ${name} (Connect Tools). Check GA4, Search Console and Google Drive connections for this client and tell us exactly what's missing and how to fix it.`,
    brand_profile: `We're at Step 3 of onboarding for ${name} (Brand Profile). Confirm the brand voice, tone and persona so the content team knows how to write.`,
    content_plan: `We're at Step 4 of onboarding for ${name} (Content Plan). Map a dated 2-3 week launch campaign — blogs and socials — onto the calendar for this client.`,
    publish_targets: `We're at Step 5 of onboarding for ${name} (Publish Targets). Review the connected WordPress and social targets and confirm where content will go live.`,
    go_live: `We're at Step 6 of onboarding for ${name} (Go Live). Review the calendar plan and coordinate the team to start on the first pieces.`,
  };

  const chat = await getOrCreateTeamChat();
  if (!chat.success || !chat.data) throw new Error("Could not open the Team Room");
  const sent = await sendChatMessage(chat.data.id, prompts[stepId] ?? prompts.go_live);
  if (!sent.success) throw new Error(sent.error ?? "Malory could not take the step");
  return { ok: true };
}

export async function announceGoLive(clientId: string): Promise<void> {
  const tenantId = await getTenantId();
  await requireRole("agency_editor");
  const lifecycle = await completeLifecycle(tenantId, clientId);
  const supabase = await createServiceClient();
  const { data: client } = await supabase
    .from("clients")
    .select("name")
    .eq("id", clientId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  try {
    await narrateToTeamRoom(
      tenantId,
      lifecycle.workspace_id,
      `🎉 **${client?.name ?? "The client"} is live!** Onboarding is complete and the campaign is underway. I'll keep the team moving on the calendar pieces as they come due.`,
      "go_live"
    );
  } catch {
    // best-effort
  }
}
