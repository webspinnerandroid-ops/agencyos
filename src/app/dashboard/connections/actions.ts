"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { getTenantId } from "@/lib/auth";
import {
  type ConnectionProvider,
  type ConnectionRecord,
  buildGoogleAuthUrl,
  encodeTokenBundle,
  getAccessToken,
  googleOAuthConfigured,
  listGA4Properties,
  listProviderResources,
  listSearchConsoleSites,
} from "@/lib/connections";

export interface ActionResponse<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/** List the tenant's connections, minus token material. */
export async function getConnections(): Promise<
  ActionResponse<(Omit<ConnectionRecord, "encrypted_token">)[]> & {
    googleConfigured: boolean;
  }
> {
  try {
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();
    const { data, error } = await supabase
      .from("tenant_connections")
      .select(
        "id, tenant_id, provider, account_email, account_name, scopes, selected_resource, resource_label, connected, last_synced_at, created_at, updated_at"
      )
      .eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
    return {
      success: true,
      googleConfigured: googleOAuthConfigured(),
      data: (data ?? []) as never,
    };
  } catch (err) {
    return {
      success: false,
      googleConfigured: googleOAuthConfigured(),
      error: (err as Error).message,
    };
  }
}

// ---------------------------------------------------------------------------
// OAuth initiation
// ---------------------------------------------------------------------------

/**
 * Start the Google OAuth round-trip for a provider. Stores an `oauth_states`
 * row (10-min TTL) and returns the Google consent URL to redirect the user to.
 */
export async function initiateConnection(
  provider: ConnectionProvider
): Promise<ActionResponse<{ redirectUrl: string }>> {
  if (!googleOAuthConfigured()) {
    return {
      success: false,
      error:
        "Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the server environment, then try again.",
    };
  }
  try {
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();
    const state = crypto.randomUUID();
    const { error: insertErr } = await supabase.from("oauth_states").insert({
      tenant_id: tenantId,
      state,
      platform: provider,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
    if (insertErr) throw new Error(insertErr.message);
    return { success: true, data: { redirectUrl: buildGoogleAuthUrl(provider, state) } };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Resource selection + refresh
// ---------------------------------------------------------------------------

/** List the connectable resources for a provider using its stored token. */
export async function getResources(
  provider: ConnectionProvider
): Promise<
  ActionResponse<{ kind: "ga4" | "search_console"; options: unknown[] }>
> {
  try {
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();
    const { data: conn, error } = await supabase
      .from("tenant_connections")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("provider", provider)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!conn) return { success: false, error: "Not connected." };

    const { accessToken, fresh } = await getAccessToken(conn as ConnectionRecord);
    if (fresh) {
      await supabase
        .from("tenant_connections")
        .update({ encrypted_token: encodeTokenBundle(fresh) })
        .eq("id", conn.id);
    }

    let options: unknown[] = [];
    if (provider === "google_analytics") {
      options = await listGA4Properties(accessToken);
    } else {
      options = await listSearchConsoleSites(accessToken);
    }

    // Cache the flattened pickable list so the Traffic tab property picker
    // needs no Google round-trip. Best-effort.
    try {
      const cached = await listProviderResources(provider, accessToken);
      await supabase
        .from("tenant_connections")
        .update({ available_resources: cached })
        .eq("id", conn.id);
    } catch (err) {
      console.error("[getResources] cache:", (err as Error).message);
    }

    return {
      success: true,
      data: { kind: provider === "google_analytics" ? "ga4" : "search_console", options },
    };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/** Save which resource (GA4 property / SC site) this connection tracks. */
export async function selectResource(
  provider: ConnectionProvider,
  resource: string,
  label: string
): Promise<ActionResponse> {
  try {
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();
    const { error } = await supabase
      .from("tenant_connections")
      .update({ selected_resource: resource, resource_label: label })
      .eq("tenant_id", tenantId)
      .eq("provider", provider);
    if (error) throw new Error(error.message);
    revalidatePath("/dashboard/connections");
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Disconnect
// ---------------------------------------------------------------------------

export async function disconnectConnection(
  provider: ConnectionProvider
): Promise<ActionResponse> {
  try {
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();
    const { error } = await supabase
      .from("tenant_connections")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("provider", provider);
    if (error) throw new Error(error.message);
    revalidatePath("/dashboard/connections");
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

