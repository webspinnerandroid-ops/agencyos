"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { getTenantId } from "@/lib/auth";
import { encrypt } from "@/lib/encryption";

export interface GoogleBusinessProfile {
  id: string;
  tenant_id: string;
  client_id: string | null;
  account_name: string;
  location_id: string | null;
  connected: boolean;
  created_at: string;
}

export interface ActionResponse<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

export async function getProfiles(): Promise<ActionResponse<GoogleBusinessProfile[]>> {
  try {
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();
    const { data, error } = await supabase
      .from("google_business_profiles")
      .select("*, client:clients(name)")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { success: true, data: data as GoogleBusinessProfile[] };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function connectProfile(
  accountName: string,
  clientId: string | null,
  locationId: string,
  accessToken: string
): Promise<ActionResponse<GoogleBusinessProfile>> {
  try {
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();
    const encryptedToken = encrypt(accessToken);
    const { data, error } = await supabase
      .from("google_business_profiles")
      .insert({
        tenant_id: tenantId,
        client_id: clientId || null,
        account_name: accountName,
        location_id: locationId,
        encrypted_token: encryptedToken,
        connected: true,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    revalidatePath("/dashboard/settings/gbp");
    return { success: true, data: data as GoogleBusinessProfile };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function removeProfile(profileId: string): Promise<ActionResponse> {
  try {
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();
    const { error } = await supabase
      .from("google_business_profiles")
      .delete()
      .eq("id", profileId)
      .eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
    revalidatePath("/dashboard/settings/gbp");
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function getClientsForSelect(): Promise<ActionResponse<{ id: string; name: string }[]>> {
  try {
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();
    const { data, error } = await supabase
      .from("clients")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .order("name");
    if (error) throw new Error(error.message);
    return { success: true, data: data ?? [] };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}