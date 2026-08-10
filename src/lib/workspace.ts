"use server";

import { headers } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { getTenantId } from "@/lib/auth";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

export interface Workspace {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  description: string | null;
  logo_url: string | null;
  is_default: boolean;
  created_at: string;
}

export interface ActionResponse<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

// ------------------------------------------------------------------
// getCurrentWorkspaceId — Reads x-workspace-id header set by middleware
// ------------------------------------------------------------------

import { cookies } from "next/headers";

export async function getCurrentWorkspaceId(): Promise<string | null> {
  try {
    const headersList = await headers();
    const headerWs = headersList.get("x-workspace-id");
    if (headerWs) return headerWs;
    // Fallback to cookie (set by WorkspaceSelector component)
    const cookieStore = await cookies();
    const cookieWs = cookieStore.get("workspace_id")?.value;
    if (cookieWs) return cookieWs;
    // Final fallback: the tenant default workspace. Ensures pages like
    // Brand Profile work for all roles before the selector has run.
    const { data, error } = await getAdminClient()
      .from("workspaces")
      .select("id")
      .eq("tenant_id", await getTenantId())
      .eq("is_default", true)
      .maybeSingle();
    if (error) throw error;
    return data?.id ?? null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------
// CRUD
// ------------------------------------------------------------------

export async function getWorkspaces(): Promise<ActionResponse<Workspace[]>> {
  try {
    const tenantId = await getTenantId();
    const supabase = getAdminClient();
    const { data, error } = await supabase
      .from("workspaces")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("is_default", { ascending: false })
      .order("name");

    if (error) throw new Error(error.message);
    return { success: true, data: data as Workspace[] };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function getDefaultWorkspace(): Promise<ActionResponse<Workspace>> {
  try {
    const tenantId = await getTenantId();
    const supabase = getAdminClient();
    const { data, error } = await supabase
      .from("workspaces")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("is_default", true)
      .single();

    if (error) throw new Error(error.message);
    return { success: true, data: data as Workspace };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function createWorkspace(
  name: string,
  description?: string
): Promise<ActionResponse<Workspace>> {
  try {
    const tenantId = await getTenantId();
    const supabase = getAdminClient();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

    // Check workspace count against license limits
    const { count } = await supabase
      .from("workspaces")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId);

    // Get license limits
    const { data: license } = await supabase
      .from("licenses")
      .select("limits")
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .maybeSingle();

    const maxWorkspaces = (license?.limits as any)?.max_workspaces ?? 1;
    if (count && count >= maxWorkspaces) {
      return { success: false, error: `Workspace limit reached (${maxWorkspaces}). Upgrade your plan.` };
    }

    const { data, error } = await supabase
      .from("workspaces")
      .insert({
        tenant_id: tenantId,
        name,
        slug,
        description: description || null,
        is_default: (count ?? 0) === 0,
      })
      .select("*")
      .single();

    if (error) throw new Error(error.message);

    // If this is the first workspace, also create a default brand profile
    if ((count ?? 0) === 0) {
      await supabase.from("brand_profiles").insert({
        workspace_id: data.id,
        tenant_id: tenantId,
        name: "Default Brand Profile",
        is_default: true,
      });
    }

    return { success: true, data: data as Workspace };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function updateWorkspace(
  workspaceId: string,
  updates: { name?: string; description?: string }
): Promise<ActionResponse<Workspace>> {
  try {
    const tenantId = await getTenantId();
    const supabase = getAdminClient();

    const patch: Record<string, any> = {};
    if (updates.name) patch.name = updates.name;
    if (updates.description !== undefined) patch.description = updates.description;

    const { data, error } = await supabase
      .from("workspaces")
      .update(patch)
      .eq("id", workspaceId)
      .eq("tenant_id", tenantId)
      .select("*")
      .single();

    if (error) throw new Error(error.message);
    return { success: true, data: data as Workspace };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function deleteWorkspace(workspaceId: string): Promise<ActionResponse> {
  try {
    const tenantId = await getTenantId();
    const supabase = getAdminClient();

    const { error } = await supabase
      .from("workspaces")
      .delete()
      .eq("id", workspaceId)
      .eq("tenant_id", tenantId);

    if (error) throw new Error(error.message);
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}