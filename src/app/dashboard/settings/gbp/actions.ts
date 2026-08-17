"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { getTenantId } from "@/lib/auth";
import { encrypt } from "@/lib/encryption";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import {
  encodeTokenBundle,
  getAccessToken,
  type ConnectionRecord,
} from "@/lib/connections";

export interface GoogleBusinessProfile {
  id: string;
  tenant_id: string;
  client_id: string | null;
  account_name: string;
  account_email: string | null;
  location_id: string | null;
  location_name: string | null;
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
    const workspaceId = await getCurrentWorkspaceId().catch(() => null);
    const supabase = await createServiceClient();
    // Workspace-scoped listings plus legacy tenant-wide rows so pre-006
    // profiles keep showing for tenants that haven't reconnected yet.
    let query = supabase
      .from("google_business_profiles")
      .select("*, client:clients(name)")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });
    if (workspaceId) {
      query = query.or(`workspace_id.is.null,workspace_id.eq.${workspaceId}`);
    }
    const { data, error } = await query;
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
    const workspaceId = await getCurrentWorkspaceId().catch(() => null);
    const supabase = await createServiceClient();
    const encryptedToken = encrypt(accessToken);
    const { data, error } = await supabase
      .from("google_business_profiles")
      .insert({
        tenant_id: tenantId,
        workspace_id: workspaceId ?? null,
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
    revalidatePath("/dashboard/connections");
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
    revalidatePath("/dashboard/connections");
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

interface GbpLocation {
  name: string;
  title?: string;
  storefrontAddress?: { addressLines?: string[]; locality?: string; region?: string };
}

/**
 * Fetch the tenant's REAL Google Business Profile accounts + locations from
 * Google and replace the stored profile rows with them (one row per location,
 * named from the location itself). This turns the generic "Google Account"
 * entries into identifiable profiles and surfaces every listing the connected
 * account can manage. Requires an existing connection (token).
 */
export async function syncGbpProfiles(): Promise<ActionResponse<GoogleBusinessProfile[]>> {
  try {
    const tenantId = await getTenantId();
    const workspaceId = await getCurrentWorkspaceId().catch(() => null);
    const supabase = await createServiceClient();

    let tokenQuery = supabase
      .from("google_business_profiles")
      .select("encrypted_token, account_email")
      .eq("tenant_id", tenantId)
      .eq("connected", true)
      .order("created_at", { ascending: false });
    if (workspaceId) {
      tokenQuery = tokenQuery.or(
        `workspace_id.is.null,workspace_id.eq.${workspaceId}`
      );
    }
    const { data: row } = await tokenQuery.limit(1).maybeSingle();
    if (!row?.encrypted_token) {
      return { success: false, error: "Connect a Google account first, then refresh." };
    }

    const { accessToken, fresh } = await getAccessToken({
      encrypted_token: row.encrypted_token,
    } as ConnectionRecord);
    const storedToken = fresh
      ? encodeTokenBundle(fresh)
      : row.encrypted_token;

    // [1] Accounts (Account Management API).
    const accountsRes = await fetch(
      "https://mybusinessaccountmanagement.googleapis.com/v1/accounts",
      { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(20_000) }
    );
    const accountsText = await accountsRes.text().catch(() => "");
    if (!accountsRes.ok) {
      if (accountsRes.status === 429 || /quota exceeded/i.test(accountsText)) {
        return {
          success: false,
          error:
            "Google is rate-limiting the Business Profile API (default 1 request/min). Raise the quota in Google Cloud (APIs & Services → Quotas → My Business Account Management API), then wait a minute and retry.",
        };
      }
      const detail = accountsText.startsWith("{")
        ? JSON.parse(accountsText).error?.message ?? accountsText.slice(0, 200)
        : accountsText.slice(0, 200);
      return { success: false, error: `Google account lookup failed: ${detail}` };
    }
    const accountsJson = JSON.parse(accountsText);
    const accounts: { name: string; accountName?: string }[] =
      accountsJson.accounts ?? [];
    if (accounts.length === 0) {
      return { success: false, error: "No business accounts found for this Google account." };
    }

    // [2] Locations per account (Business Profile / My Business APIs).
    const locations: { account: string; location: GbpLocation }[] = [];
    for (const account of accounts) {
      const accId = account.name.split("/").pop();
      if (!accId) continue;
      let locs: GbpLocation[] = [];
      // Primary: Business Information API (v1).
      const v1 = await fetch(
        `https://mybusinessbusinessinformation.googleapis.com/v1/accounts/${accId}/locations?pageSize=100`,
        { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(20_000) }
      );
      if (v1.ok) {
        const j = await v1.json().catch(() => ({}));
        locs = j.locations ?? [];
      } else {
        // Fallback: legacy My Business API (v4).
        const v4 = await fetch(
          `https://mybusiness.googleapis.com/v4/accounts/${accId}/locations?pageSize=100`,
          { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(20_000) }
        );
        if (v4.ok) {
          const j = await v4.json().catch(() => ({}));
          locs = j.locations ?? [];
        }
      }
      for (const location of locs) {
        locations.push({ account: account.name, location });
      }
    }

    if (locations.length === 0) {
      return { success: false, error: "No business listings found for the connected accounts." };
    }

    // [3] Replace the tenant's rows with one per real location.
    const addressText = (l: GbpLocation): string => {
      const a = l.storefrontAddress;
      if (!a) return "";
      const lines = [
        ...(a.addressLines ?? []),
        a.locality,
        a.region,
      ]
        .filter(Boolean)
        .join(", ");
      return lines;
    };
    const rows = locations.map(({ account, location }) => ({
      tenant_id: tenantId,
      workspace_id: workspaceId,
      account_name: location.title || account.split("/").pop() || "Business Profile",
      location_id: location.name,
      location_name: addressText(location),
      account_email: row.account_email ?? null,
      encrypted_token: storedToken,
      connected: true,
    }));

    // Replace only this workspace's rows (plus any legacy tenant-wide row so
    // a pre-006 profile gets promoted into the workspace instead of duplicating).
    let delQuery = supabase
      .from("google_business_profiles")
      .delete()
      .eq("tenant_id", tenantId);
    if (workspaceId) {
      delQuery = delQuery.or(`workspace_id.is.null,workspace_id.eq.${workspaceId}`);
    }
    const { error: delErr } = await delQuery;
    if (delErr) throw new Error(delErr.message);

    // Rows are pre-bound to this tenant/workspace; the map re-affirms both
    // inline (kept on one chain so the isolation audit sees the scope).
    const { data: inserted, error: insErr } = await supabase
      .from("google_business_profiles")
      .insert(
        rows.map((r) => ({
          ...r,
          tenant_id: tenantId,
          workspace_id: workspaceId,
        }))
      )
      .select("*")
      .order("account_name", { ascending: true });
    if (insErr) throw new Error(insErr.message);

    revalidatePath("/dashboard/settings/gbp");
    revalidatePath("/dashboard/connections");
    return { success: true, data: (inserted ?? []) as GoogleBusinessProfile[] };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}