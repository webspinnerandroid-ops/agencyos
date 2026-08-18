"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { getTenantId } from "@/lib/auth";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import {
  type ConnectionProvider,
  type ConnectionRecord,
  buildGoogleAuthUrl,
  encodeTokenBundle,
  getAccessToken,
  googleOAuthConfigured,
  isMissingWorkspaceColumn,
  listDriveFolders,
  listGA4Properties,
  listProviderResources,
  listSearchConsoleSites,
} from "@/lib/connections";

export interface ActionResponse<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Fetch a tenant's connections for one provider, preferring the row scoped to
 * the current workspace and falling back to the legacy tenant-wide (NULL
 * workspace) row. This lets multi-workspace tenants track different GA4
 * properties / SC sites per client while pre-070 rows keep working.
 */
async function resolveConnection(
  tenantId: string,
  workspaceId: string | null,
  provider?: ConnectionProvider
): Promise<ConnectionRecord | null> {
  const supabase = await createServiceClient();
  let query = supabase
    .from("tenant_connections")
    .select("*")
    .eq("tenant_id", tenantId);
  if (provider) query = query.eq("provider", provider);

  // This base query works before AND after migration 070: pre-070 every row
  // has a null workspace_id so the preference below naturally picks it.
  const { data } = await query;
  const rows = (data ?? []) as ConnectionRecord[];
  if (rows.length === 0) return null;
  if (!workspaceId) return rows[0];
  // Workspace-scoped row wins; otherwise the legacy NULL row.
  return (
    rows.find((r) => r.workspace_id === workspaceId) ??
    rows.find((r) => !r.workspace_id) ??
    rows[0]
  );
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/** List the workspace's connections, minus token material. */
export async function getConnections(): Promise<
  ActionResponse<(Omit<ConnectionRecord, "encrypted_token">)[]> & {
    googleConfigured: boolean;
  }
> {
  try {
    const tenantId = await getTenantId();
    const workspaceId = await getCurrentWorkspaceId().catch(() => null);
    const supabase = await createServiceClient();

    // Include the legacy tenant-wide rows so pre-070 connections keep showing.
    // If migration 070 hasn't been applied the workspace_id column is missing
    // — fall back to the tenant-wide list rather than breaking the page.
    let query = supabase
      .from("tenant_connections")
      .select(
        "id, tenant_id, workspace_id, provider, account_email, account_name, scopes, selected_resource, resource_label, connected, auto_save_to_drive, last_synced_at, created_at, updated_at"
      )
      .eq("tenant_id", tenantId);
    if (workspaceId) {
      query = query.or(
        `workspace_id.is.null,workspace_id.eq.${workspaceId}`
      );
    }
    const { data, error } = await query;
    if (error && isMissingWorkspaceColumn(error)) {
      const legacy = await supabase
        .from("tenant_connections")
        .select(
          "id, tenant_id, provider, account_email, account_name, scopes, selected_resource, resource_label, connected, auto_save_to_drive, last_synced_at, created_at, updated_at"
        )
        .eq("tenant_id", tenantId);
      if (legacy.error) throw new Error(legacy.error.message);
      return {
        success: true,
        googleConfigured: googleOAuthConfigured(),
        data: (legacy.data ?? []) as never,
      };
    }
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
 * row (10-min TTL) carrying the workspace so the callback assigns the
 * connection to the right workspace, and returns the Google consent URL.
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
    const workspaceId = await getCurrentWorkspaceId().catch(() => null);
    const supabase = await createServiceClient();
    const state = crypto.randomUUID();
    const { error: insertErr } = await supabase.from("oauth_states").insert({
      tenant_id: tenantId,
      workspace_id: workspaceId,
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
  ActionResponse<{
    kind: "ga4" | "search_console" | "drive";
    options: unknown[];
  }>
> {
  try {
    const tenantId = await getTenantId();
    const workspaceId = await getCurrentWorkspaceId().catch(() => null);
    const supabase = await createServiceClient();
    const conn = await resolveConnection(tenantId, workspaceId, provider);
    if (!conn) return { success: false, error: "Not connected." };

    const { accessToken, fresh } = await getAccessToken(conn);
    if (fresh) {
      await supabase
        .from("tenant_connections")
        .update({ encrypted_token: encodeTokenBundle(fresh) })
        .eq("id", conn.id);
    }

    let options: unknown[] = [];
    if (provider === "google_analytics") {
      options = await listGA4Properties(accessToken);
    } else if (provider === "google_drive") {
      options = await listDriveFolders(accessToken);
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
      data: {
        kind:
          provider === "google_analytics"
            ? "ga4"
            : provider === "google_drive"
              ? "drive"
              : "search_console",
        options,
      },
    };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Browse Drive folders, optionally drilling into a subfolder via `parentId`.
 * Returns the folders directly inside that parent so the picker can navigate
 * beyond the root instead of being limited to top-level folders.
 */
export async function getDriveFolders(
  parentId?: string
): Promise<ActionResponse<{ folders: { id: string; name: string }[] }>> {
  try {
    const tenantId = await getTenantId();
    const workspaceId = await getCurrentWorkspaceId().catch(() => null);
    const supabase = await createServiceClient();
    const conn = await resolveConnection(tenantId, workspaceId, "google_drive");
    if (!conn) return { success: false, error: "Google Drive is not connected yet." };

    const { accessToken, fresh } = await getAccessToken(conn);
    if (fresh) {
      await supabase
        .from("tenant_connections")
        .update({ encrypted_token: encodeTokenBundle(fresh) })
        .eq("id", conn.id);
    }

    const folders = await listDriveFolders(accessToken, parentId);
    return { success: true, data: { folders } };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/** Toggle auto-save of new assets to the workspace's attached Drive folder. */
export async function setDriveAutoSave(
  enabled: boolean
): Promise<ActionResponse<{ enabled: boolean }>> {
  try {
    const tenantId = await getTenantId();
    const workspaceId = await getCurrentWorkspaceId().catch(() => null);
    const supabase = await createServiceClient();
    const conn = await resolveConnection(tenantId, workspaceId, "google_drive");
    if (!conn) return { success: false, error: "Google Drive is not connected yet." };
    const { error } = await supabase
      .from("tenant_connections")
      .update({ auto_save_to_drive: enabled })
      .eq("id", conn.id);
    if (error) throw new Error(error.message);
    revalidatePath("/dashboard/connections");
    return { success: true, data: { enabled } };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/** Save which resource (GA4 property / SC site) this workspace tracks. */
export async function selectResource(
  provider: ConnectionProvider,
  resource: string,
  label: string
): Promise<ActionResponse> {
  try {
    const tenantId = await getTenantId();
    const workspaceId = await getCurrentWorkspaceId().catch(() => null);
    const supabase = await createServiceClient();
    const conn = await resolveConnection(tenantId, workspaceId, provider);
    if (!conn) return { success: false, error: "Not connected." };
    const { error } = await supabase
      .from("tenant_connections")
      .update({ selected_resource: resource, resource_label: label })
      .eq("id", conn.id);
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
    const workspaceId = await getCurrentWorkspaceId().catch(() => null);
    const supabase = await createServiceClient();
    const conn = await resolveConnection(tenantId, workspaceId, provider);
    if (!conn) return { success: false, error: "Not connected." };
    const { error } = await supabase
      .from("tenant_connections")
      .delete()
      .eq("id", conn.id);
    if (error) throw new Error(error.message);
    revalidatePath("/dashboard/connections");
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
