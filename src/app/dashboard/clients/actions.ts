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

export async function createClient(input: {
  name: string;
  website?: string;
  notes?: string;
}): Promise<{ id: string }> {
  const tenantId = await getTenantId();
  await requireRole("agency_editor");
  const workspaceId = await getCurrentWorkspaceId();
  const name = (input.name ?? "").trim();
  if (!name) throw new Error("Client name is required");

  const supabase = await createServiceClient();
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

export async function deleteClient(clientId: string): Promise<void> {
  const tenantId = await getTenantId();
  await requireRole("agency_admin");
  const supabase = await createServiceClient();
  const { error } = await supabase
    .from("clients")
    .delete()
    .eq("id", clientId)
    .eq("tenant_id", tenantId);
  if (error) throw new Error(error.message);
}
