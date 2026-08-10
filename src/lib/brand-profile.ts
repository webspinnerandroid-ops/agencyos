"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { getTenantId } from "@/lib/auth";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import type { BrandProfile } from "./brand-profile-utils";
export type { BrandProfile, PresetId } from "./brand-profile-utils";

export interface ActionResponse<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

async function resolveWorkspaceId(): Promise<string> {
  const wsId = await getCurrentWorkspaceId();
  if (!wsId) throw new Error("No workspace selected");
  return wsId;
}

export async function getBrandProfiles(): Promise<ActionResponse<BrandProfile[]>> {
  try {
    const tenantId = await getTenantId();
    const workspaceId = await resolveWorkspaceId();
    const supabase = await createServiceClient();
    const { data, error } = await supabase
      .from("brand_profiles")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("workspace_id", workspaceId)
      .order("is_default", { ascending: false })
      .order("name");
    if (error) throw new Error(error.message);
    return { success: true, data: data as BrandProfile[] };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function getDefaultBrandProfile(): Promise<ActionResponse<BrandProfile>> {
  try {
    const tenantId = await getTenantId();
    const workspaceId = await resolveWorkspaceId();
    const supabase = await createServiceClient();
    const { data, error } = await supabase
      .from("brand_profiles")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("workspace_id", workspaceId)
      .eq("is_default", true)
      .single();
    if (error) throw new Error(error.message);
    return { success: true, data: data as BrandProfile };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function saveBrandProfile(
  profileId: string,
  updates: Partial<BrandProfile>
): Promise<ActionResponse<BrandProfile>> {
  try {
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();
    const patch: Record<string, any> = { ...updates };
    delete patch.id;
    delete patch.workspace_id;
    delete patch.tenant_id;
    delete patch.created_at;
    delete patch.updated_at;
    patch.updated_at = new Date().toISOString();
    const { data, error } = await supabase
      .from("brand_profiles")
      .update(patch)
      .eq("id", profileId)
      .eq("tenant_id", tenantId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { success: true, data: data as BrandProfile };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function createBrandProfile(name: string): Promise<ActionResponse<BrandProfile>> {
  try {
    const tenantId = await getTenantId();
    const workspaceId = await resolveWorkspaceId();
    const supabase = await createServiceClient();
    const { data, error } = await supabase
      .from("brand_profiles")
      .insert({ tenant_id: tenantId, workspace_id: workspaceId, name, is_default: false })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { success: true, data: data as BrandProfile };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function deleteBrandProfile(profileId: string): Promise<ActionResponse> {
  try {
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();
    const { error } = await supabase
      .from("brand_profiles")
      .delete()
      .eq("id", profileId)
      .eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}