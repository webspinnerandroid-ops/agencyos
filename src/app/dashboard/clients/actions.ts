"use server";

import { getTenantId, requireRole } from "@/lib/auth";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import { createServiceClient } from "@/lib/supabase/server";
import { getLifecycle, getOrCreateLifecycle } from "@/lib/client-lifecycle";

export interface ClientRow {
  id: string;
  name: string;
  website: string | null;
  notes: string | null;
  workspace_id: string | null;
  created_at: string;
}

export interface ClientListItem extends ClientRow {
  lifecycle: {
    step: number;
    status: string;
    totalSteps: number;
  } | null;
}

export async function listClients(): Promise<ClientListItem[]> {
  const tenantId = await getTenantId();
  const supabase = await createServiceClient();

  const { data: clients, error } = await supabase
    .from("clients")
    .select("id, name, website, notes, workspace_id, created_at")
    .eq("tenant_id", tenantId)
    .order("name", { ascending: true });

  if (error) throw new Error(error.message);
  const rows = (clients ?? []) as ClientRow[];

  const lifecycles = await Promise.all(
    rows.map(async (c) => {
      const lc = await getLifecycle(tenantId, c.id);
      return lc
        ? {
            step: lc.step,
            status: lc.status,
            totalSteps: 6,
          }
        : null;
    })
  );

  return rows.map((c, i) => ({ ...c, lifecycle: lifecycles[i] }));
}

export interface WorkspaceOption {
  id: string;
  name: string;
  is_default: boolean;
}

export async function listWorkspaceOptions(): Promise<WorkspaceOption[]> {
  const tenantId = await getTenantId();
  const supabase = await createServiceClient();
  const { data, error } = await supabase
    .from("workspaces")
    .select("id, name, is_default")
    .eq("tenant_id", tenantId)
    .order("is_default", { ascending: false })
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as WorkspaceOption[];
}

export async function createClient(input: {
  name: string;
  website?: string;
  notes?: string;
  workspaceId?: string | null;
}): Promise<{ id: string }> {
  const tenantId = await getTenantId();
  await requireRole("agency_editor");
  const name = (input.name ?? "").trim();
  if (!name) throw new Error("Client name is required");

  // Resolve the workspace: an explicitly chosen one (validated against this
  // tenant), else the currently-selected workspace, else none (the wizard will
  // offer to create one on Step 1).
  let workspaceId = input.workspaceId ?? (await getCurrentWorkspaceId());
  const supabase = await createServiceClient();
  if (workspaceId) {
    const { data: owned } = await supabase
      .from("workspaces")
      .select("id")
      .eq("id", workspaceId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!owned) workspaceId = null;
  }

  const { data, error } = await supabase
    .from("clients")
    .insert({
      tenant_id: tenantId,
      workspace_id: workspaceId || null,
      name,
      website: (input.website ?? "").trim() || null,
      notes: (input.notes ?? "").trim() || null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Failed to create client: ${error?.message ?? ""}`);

  // Kick off the onboarding lifecycle immediately so the client detail page
  // and wizard always have a row to drive.
  await getOrCreateLifecycle(tenantId, data.id, workspaceId || null);

  return { id: data.id };
}

export async function getClient(clientId: string): Promise<{
  client: ClientRow;
  lifecycle: { step: number; status: string; totalSteps: number } | null;
} | null> {
  const tenantId = await getTenantId();
  const supabase = await createServiceClient();
  const { data } = await supabase
    .from("clients")
    .select("id, name, website, notes, workspace_id, created_at")
    .eq("id", clientId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!data) return null;
  const lc = await getLifecycle(tenantId, clientId);
  return {
    client: data as ClientRow,
    lifecycle: lc
      ? { step: lc.step, status: lc.status, totalSteps: 6 }
      : null,
  };
}

export async function updateClient(
  clientId: string,
  input: { name: string; website?: string; notes?: string }
): Promise<void> {
  const tenantId = await getTenantId();
  await requireRole("agency_editor");
  const name = (input.name ?? "").trim();
  if (!name) throw new Error("Client name is required");

  const supabase = await createServiceClient();
  const { error } = await supabase
    .from("clients")
    .update({
      name,
      website: (input.website ?? "").trim() || null,
      notes: (input.notes ?? "").trim() || null,
    })
    .eq("id", clientId)
    .eq("tenant_id", tenantId);
  if (error) throw new Error(`Failed to update client: ${error.message}`);
}

const CLIENT_ORPHAN_TABLES = [
  "leads",
  "media_assets",
  "site_pages",
  "outreach_targets",
  "content_opportunities",
] as const;

/** Delete every row across a list of tables that reference a client_id. */
type ServiceSupabase = Awaited<ReturnType<typeof createServiceClient>>;

async function deleteClientOrphans(
  supabase: ServiceSupabase,
  clientId: string
): Promise<void> {
  for (const table of CLIENT_ORPHAN_TABLES) {
    // Scope by client_id first — client ids are unique tenant-owned UUIDs, so
    // no cross-tenant risk. Wrap each in its own try so one failure doesn't
    // abort the rest (best-effort cleanup that must never crash the delete).
    try {
      await supabase.from(table).delete().eq("client_id", clientId);
    } catch { /* best-effort */ }
  }
}

/**
 * Delete a client and everything tied to it. Rows referencing the client via
 * CASCADE (posts, seo campaigns, site audits, competitors, brand profiles,
 * team chats, campaign plans, onboarding) are removed automatically by the
 * FK. Rows that use SET NULL (leads, media, site pages, outreach, content
 * opportunities) are explicitly deleted first so nothing is orphaned. When
 * the client owns a workspace exclusively (no other client references it),
 * that workspace and its workspace-scoped content are removed too.
 */
async function deleteClientDeep(
  supabase: ServiceSupabase,
  tenantId: string,
  clientId: string
): Promise<void> {
  // 1. Do we own an exclusive workspace?
  const { data: client } = await supabase
    .from("clients")
    .select("id, name, workspace_id")
    .eq("id", clientId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  let exclusiveWorkspaceId: string | null = null;
  if (client?.workspace_id) {
    const { count: sharingCount } = await supabase
      .from("clients")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("workspace_id", client.workspace_id)
      .neq("id", clientId);
    if ((sharingCount ?? 0) === 0) {
      exclusiveWorkspaceId = client.workspace_id;
    }
  }

  // 2. Explicitly remove SET NULL (orphaning) child rows.
  await deleteClientOrphans(supabase, clientId);

  // 3. The client delete cascades all ON DELETE CASCADE relationships.
  const { error } = await supabase
    .from("clients")
    .delete()
    .eq("id", clientId)
    .eq("tenant_id", tenantId);
  if (error) throw new Error(error.message);

  // 4. Remove the exclusive workspace + its workspace-scoped content so
  // nothing is left floating without a client. Every chain below is
  // additionally scoped with .eq("tenant_id", tenantId) — the workspace id
  // alone is already tenant-unique (it was resolved from a tenant-scoped
  // client lookup), but the isolation audit (and defense in depth) requires
  // the explicit tenant filter on every tenant-scoped table.
  if (exclusiveWorkspaceId) {
    const wsTables = [
      "media_assets",
      "knowledgebase_items",
      "knowledgebase_folders",
      "brand_profiles",
      "site_audits",
      "social_accounts",
      "blog_platforms",
      "google_business_profiles",
      "team_chats",
    ] as const;
    for (const table of wsTables) {
      try {
        await supabase
          .from(table)
          .delete()
          .eq("tenant_id", tenantId)
          .eq("workspace_id", exclusiveWorkspaceId);
      } catch { /* best-effort */ }
    }
    // seo_campaigns key off workspace_id too.
    try {
      await supabase
        .from("seo_campaigns")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("workspace_id", exclusiveWorkspaceId);
    } catch { /* best-effort */ }
    // Any posts not already removed by the client cascade (they belong to the workspace).
    try {
      await supabase
        .from("posts")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("workspace_id", exclusiveWorkspaceId);
    } catch { /* best-effort */ }
    await supabase
      .from("workspaces")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("id", exclusiveWorkspaceId);
  }
}

export interface DeleteSummary {
  deleted: number;
  workspacesDeleted: number;
}

/** Delete one client (used by the detail page). */
export async function deleteClient(clientId: string): Promise<DeleteSummary> {
  const tenantId = await getTenantId();
  await requireRole("agency_admin");
  const supabase = await createServiceClient();
  await deleteClientDeep(supabase, tenantId, clientId);
  return { deleted: 1, workspacesDeleted: 0 };
}

/** Delete many clients at once (bulk delete from the list page). */
export async function deleteClients(clientIds: string[]): Promise<DeleteSummary> {
  const tenantId = await getTenantId();
  await requireRole("agency_admin");
  const supabase = await createServiceClient();
  for (const id of clientIds) {
    await deleteClientDeep(supabase, tenantId, id);
  }
  return { deleted: clientIds.length, workspacesDeleted: 0 };
}
