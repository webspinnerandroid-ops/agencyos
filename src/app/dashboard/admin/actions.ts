"use server";

import { createServiceClient } from "@/lib/supabase/server";
import { getTenantId, getRole, getUserEmail } from "@/lib/auth";

/** Append an entry to the license audit log (best-effort, never fails the op). */
async function auditLicense(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  entry: {
    licenseId: string;
    tenantId?: string | null;
    action: string;
    details?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    const email = await getUserEmail();
    await supabase.from("license_audit_log").insert({
      license_id: entry.licenseId,
      tenant_id: entry.tenantId ?? null,
      actor_email: email,
      action: entry.action,
      details: entry.details ?? {},
    });
  } catch (err) {
    console.error("[admin] audit log write failed:", err);
  }
}

export interface ActionResponse<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  client_count: number;
  subscription_status: string | null;
  plan_id: string | null;
}

export interface LicenseRecord {
  id: string;
  tenant_id: string;
  license_key: string;
  plan_id: string;
  status: string;
  seats_total: number;
  seats_used: number;
  issued_at: string;
  expires_at: string | null;
  tenant_name?: string;
  hubs?: string[];
}

export interface LicenseAuditEntry {
  id: string;
  license_id: string;
  tenant_id: string | null;
  actor_email: string | null;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface UserRecord {
  user_id: string;
  email: string;
  role: string;
  tenant_id: string;
  tenant_name: string;
  license_status: string | null;
  plan_id: string | null;
  is_trial: boolean;
  has_license: boolean;
}

async function requireSuperAdmin() {
  const role = await getRole();
  if (role !== "super_admin") {
    throw new Error("Forbidden: super_admin access required");
  }
}

// ------------------------------------------------------------------
// Dashboard stats
// ------------------------------------------------------------------

export async function getDashboardStats(): Promise<ActionResponse<{
  totalTenants: number;
  totalClients: number;
  totalPosts: number;
  activeLicenses: number;
  totalRevenue: number;
  recentTenants: TenantSummary[];
}>> {
  try {
    await requireSuperAdmin();
    const supabase = await createServiceClient();

    const [{ count: tenantCount }, { count: clientCount }, { count: postCount }, { data: licenses }, { data: recentTenants }] = await Promise.all([
      supabase.from("tenants").select("*", { count: "exact", head: true }),
      supabase.from("clients").select("*", { count: "exact", head: true }),
      supabase.from("posts").select("*", { count: "exact", head: true }),
      supabase.from("licenses").select("id").eq("status", "active"),
      supabase.from("tenants").select("id, name, slug, created_at").order("created_at", { ascending: false }).limit(10),
    ]);

    const tenantsWithDetails: TenantSummary[] = [];
    if (recentTenants) {
      for (const t of recentTenants) {
        const [{ count: cc }, { data: sub }] = await Promise.all([
          supabase.from("clients").select("*", { count: "exact", head: true }).eq("tenant_id", t.id),
          supabase.from("subscriptions").select("plan_id, status").eq("tenant_id", t.id).maybeSingle(),
        ]);
        tenantsWithDetails.push({
          id: t.id,
          name: t.name ?? "Unknown",
          slug: t.slug ?? "",
          created_at: t.created_at,
          client_count: cc ?? 0,
          subscription_status: sub?.status ?? null,
          plan_id: sub?.plan_id ?? null,
        });
      }
    }

    return {
      success: true,
      data: {
        totalTenants: tenantCount ?? 0,
        totalClients: clientCount ?? 0,
        totalPosts: postCount ?? 0,
        activeLicenses: licenses?.length ?? 0,
        totalRevenue: 0,
        recentTenants: tenantsWithDetails,
      },
    };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ------------------------------------------------------------------
// Tenant management
// ------------------------------------------------------------------

export async function getAllTenants(): Promise<ActionResponse<TenantSummary[]>> {
  try {
    await requireSuperAdmin();
    const supabase = await createServiceClient();
    const { data: tenants } = await supabase.from("tenants").select("id, name, slug, created_at").order("name");

    if (!tenants) return { success: true, data: [] };

    const result: TenantSummary[] = [];
    for (const t of tenants) {
      const [{ count: cc }, { data: sub }] = await Promise.all([
        supabase.from("clients").select("*", { count: "exact", head: true }).eq("tenant_id", t.id),
        supabase.from("subscriptions").select("plan_id, status").eq("tenant_id", t.id).maybeSingle(),
      ]);
      result.push({
        id: t.id,
        name: t.name ?? "Unknown",
        slug: t.slug ?? "",
        created_at: t.created_at,
        client_count: cc ?? 0,
        subscription_status: sub?.status ?? null,
        plan_id: sub?.plan_id ?? null,
      });
    }
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ------------------------------------------------------------------
// License management
// ------------------------------------------------------------------

export async function getLicenses(): Promise<ActionResponse<LicenseRecord[]>> {
  try {
    await requireSuperAdmin();
    const supabase = await createServiceClient();
    const { data, error } = await supabase
      .from("licenses")
      .select("*, tenant:tenants(name)")
      .order("issued_at", { ascending: false });
    if (error) throw new Error(error.message);
    const mapped = (data ?? []).map((l: any) => ({ ...l, tenant_name: l.tenant?.name ?? "N/A" }));

    // Attach each tenant's purchased hubs (hub-and-spoke) so the admin table
    // can grant/revoke them without payment.
    const tenantIds = [...new Set((mapped as any[]).map((l) => l.tenant_id).filter(Boolean))] as string[];
    const hubByTenant = new Map<string, string[]>();
    if (tenantIds.length > 0) {
      const { data: settingsRows } = await supabase
        .from("tenant_settings")
        .select("tenant_id, settings")
        .in("tenant_id", tenantIds);
      for (const row of settingsRows ?? []) {
        const hubs = (row.settings as any)?.hubs;
        hubByTenant.set(row.tenant_id, Array.isArray(hubs) ? hubs : []);
      }
    }
    const withHubs = (mapped as any[]).map((l) => ({
      ...l,
      hubs: hubByTenant.get(l.tenant_id) ?? [],
    }));
    return { success: true, data: withHubs as LicenseRecord[] };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function issueLicense(
  tenantId: string,
  planId: string,
  seats: number,
  expiresAt?: string
): Promise<ActionResponse<LicenseRecord>> {
  try {
    await requireSuperAdmin();
    const supabase = await createServiceClient();
    const licenseKey = `AOS-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    const { data, error } = await supabase
      .from("licenses")
      .insert({
        tenant_id: tenantId,
        license_key: licenseKey,
        plan_id: planId,
        status: "active",
        seats_total: seats,
        seats_used: 0,
        expires_at: expiresAt || null,
      })
      .select("*")
      .single();

    if (error) throw new Error(error.message);
    await auditLicense(supabase, {
      licenseId: data.id,
      tenantId,
      action: "issued",
      details: { planId, seats, expiresAt: expiresAt ?? null, licenseKey },
    });
    return { success: true, data: data as LicenseRecord };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function getLicenseAudit(
  licenseId: string
): Promise<ActionResponse<LicenseAuditEntry[]>> {
  try {
    await requireSuperAdmin();
    const supabase = await createServiceClient();
    const { data, error } = await supabase
      .from("license_audit_log")
      .select("id, license_id, tenant_id, actor_email, action, details, created_at")
      .eq("license_id", licenseId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return { success: true, data: (data ?? []) as LicenseAuditEntry[] };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function revokeLicense(licenseId: string): Promise<ActionResponse> {
  try {
    await requireSuperAdmin();
    const supabase = await createServiceClient();
    const { error } = await supabase.from("licenses").update({ status: "cancelled" }).eq("id", licenseId);
    if (error) throw new Error(error.message);
    await auditLicense(supabase, { licenseId, action: "revoked" });
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Change an EXISTING license's plan — the super admin's "toggle off trial"
 * path. Updates the plan in place (no new license needed) and clears the
 * trial flag so the tenant is treated as a paid customer going forward.
 */
export async function updateLicensePlan(
  licenseId: string,
  planId: string
): Promise<ActionResponse> {
  try {
    await requireSuperAdmin();
    const supabase = await createServiceClient();

    const { data: existing } = await supabase
      .from("licenses")
      .select("id, metadata, tenant_id")
      .eq("id", licenseId)
      .maybeSingle();
    if (!existing) throw new Error("License not found.");

    // Clear the trial flag and carry over any other metadata.
    const metadata = {
      ...((existing.metadata ?? {}) as Record<string, unknown>),
      is_trial: false,
    };

    const { error } = await supabase
      .from("licenses")
      .update({ plan_id: planId, status: "active", metadata })
      .eq("id", licenseId);
    if (error) throw new Error(error.message);

    // Keep the subscription in sync so billing/limits follow the new plan.
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("id")
      .eq("tenant_id", existing.tenant_id)
      .maybeSingle();
    if (sub) {
      await supabase
        .from("subscriptions")
        .update({ plan_id: planId, status: "active" })
        .eq("id", sub.id);
    }

    await auditLicense(supabase, {
      licenseId,
      tenantId: existing.tenant_id,
      action: "plan_changed",
      details: { planId },
    });

    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Renew a license without payment — extends expires_at by the given number of
 * days (default 30) from today (or from the current expiry if it's still in
 * the future), sets status back to active, and clears the trial flag.
 */
export async function renewLicense(
  licenseId: string,
  days = 30
): Promise<ActionResponse<{ expires_at: string }>> {
  try {
    await requireSuperAdmin();
    const supabase = await createServiceClient();

    const { data: existing } = await supabase
      .from("licenses")
      .select("id, tenant_id, expires_at, metadata")
      .eq("id", licenseId)
      .maybeSingle();
    if (!existing) throw new Error("License not found.");

    const base =
      existing.expires_at && new Date(existing.expires_at).getTime() > Date.now()
        ? new Date(existing.expires_at)
        : new Date();
    const newExpiry = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);

    const metadata = {
      ...((existing.metadata ?? {}) as Record<string, unknown>),
      is_trial: false,
    };

    const { error } = await supabase
      .from("licenses")
      .update({
        expires_at: newExpiry.toISOString(),
        status: "active",
        metadata,
      })
      .eq("id", licenseId);
    if (error) throw new Error(error.message);

    await auditLicense(supabase, {
      licenseId,
      tenantId: existing.tenant_id ?? null,
      action: "renewed",
      details: { days, expires_at: newExpiry.toISOString() },
    });

    return { success: true, data: { expires_at: newExpiry.toISOString() } };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Grant a hub to a tenant without payment (super admin only) — adds the hub
 * to tenant_settings.settings.hubs so usage limits expand immediately.
 */
export async function grantHub(
  tenantId: string,
  hubId: string
): Promise<ActionResponse> {
  try {
    await requireSuperAdmin();
    const supabase = await createServiceClient();

    const { data: existing } = await supabase
      .from("tenant_settings")
      .select("settings")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    const hubs: string[] = Array.isArray((existing?.settings as any)?.hubs)
      ? ((existing?.settings as any).hubs as string[])
      : [];
    if (!hubs.includes(hubId)) {
      hubs.push(hubId);
    }
    const settings = {
      ...(((existing?.settings as any) ?? {}) as object),
      hubs,
    };
    if (existing) {
      await supabase
        .from("tenant_settings")
        .update({ settings, updated_at: new Date().toISOString() })
        .eq("tenant_id", tenantId);
    } else {
      await supabase.from("tenant_settings").insert({ tenant_id: tenantId, settings });
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Revoke a hub from a tenant without payment (super admin only).
 */
export async function revokeHub(
  tenantId: string,
  hubId: string
): Promise<ActionResponse> {
  try {
    await requireSuperAdmin();
    const supabase = await createServiceClient();

    const { data: existing } = await supabase
      .from("tenant_settings")
      .select("settings")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    const hubs: string[] = Array.isArray((existing?.settings as any)?.hubs)
      ? ((existing?.settings as any).hubs as string[])
      : [];
    const next = hubs.filter((h) => h !== hubId);
    const settings = {
      ...(((existing?.settings as any) ?? {}) as object),
      hubs: next,
    };
    if (existing) {
      await supabase
        .from("tenant_settings")
        .update({ settings, updated_at: new Date().toISOString() })
        .eq("tenant_id", tenantId);
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Permanently deletes a license row (not just revoke).
 */
export async function deleteLicense(licenseId: string): Promise<ActionResponse> {
  try {
    await requireSuperAdmin();
    const supabase = await createServiceClient();
    const { error } = await supabase.from("licenses").delete().eq("id", licenseId);
    if (error) throw new Error(error.message);
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Permanently deletes a user account: their auth identity (auth.admin) and
 * every user_roles row. Tenant data is untouched — the user's posts etc.
 * remain with the tenant(s) they worked in.
 */
export async function deleteUser(userId: string): Promise<ActionResponse> {
  try {
    await requireSuperAdmin();
    const supabase = await createServiceClient();

    const { error: rolesError } = await supabase
      .from("user_roles")
      .delete()
      .eq("user_id", userId);
    if (rolesError) throw new Error(rolesError.message);

    const { error: authError } = await supabase.auth.admin.deleteUser(userId);
    if (authError) throw new Error(authError.message);

    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Permanently deletes a tenant and EVERYTHING under it: all rows across all
 * tenant-scoped tables (via the delete_tenant_data SQL function from
 * migration 025), the licenses, the media objects in Bunny storage, and the
 * auth accounts of users who belong ONLY to this tenant. Users who also have
 * roles in other tenants keep their accounts.
 */
export async function deleteTenant(
  tenantId: string
): Promise<ActionResponse<{ deletedAccounts: number }>> {
  try {
    await requireSuperAdmin();
    const supabase = await createServiceClient();

    // 1. Users attached to this tenant (to decide auth cleanup afterward).
    const { data: roleRows } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("tenant_id", tenantId);
    const attachedUserIds = [...new Set((roleRows ?? []).map((r) => r.user_id))];

    // 2. Collect media object URLs for Bunny cleanup (best-effort).
    const mediaUrls: string[] = [];
    const { data: assets } = await supabase
      .from("media_assets")
      .select("url")
      .eq("tenant_id", tenantId);
    for (const a of assets ?? []) if (typeof a.url === "string") mediaUrls.push(a.url);
    // Images embedded in post content (they live in Bunny too).
    const { data: postRows } = await supabase
      .from("posts")
      .select("content")
      .eq("tenant_id", tenantId);
    for (const p of postRows ?? []) {
      try {
        const c = typeof p.content === "string" ? JSON.parse(p.content) : p.content;
        for (const img of c?.images ?? []) {
          if (typeof img?.url === "string") mediaUrls.push(img.url);
        }
      } catch { /* skip malformed row */ }
    }

    // 3. Delete every tenant-scoped row + the tenant itself (SQL function).
    const { error: rpcError } = await supabase.rpc("delete_tenant_data", {
      p_tenant_id: tenantId,
    });
    if (rpcError) throw new Error(rpcError.message);

    // 4. Remove auth accounts for users with no remaining roles anywhere.
    let deletedAccounts = 0;
    for (const userId of attachedUserIds) {
      const { data: remaining } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("user_id", userId)
        .limit(1);
      if (!remaining || remaining.length === 0) {
        const { error: authError } = await supabase.auth.admin.deleteUser(userId);
        if (!authError) deletedAccounts++;
      }
    }

    // 5. Best-effort Bunny storage cleanup (never fails the operation).
    if (process.env.BUNNY_STORAGE_API_KEY) {
      const { deleteStoredImage } = await import("@/lib/media/storage");
      await Promise.allSettled(
        [...new Set(mediaUrls)].map((u) => deleteStoredImage(u))
      );
    }

    return { success: true, data: { deletedAccounts } };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ------------------------------------------------------------------
// User management (levels: client / agency_admin / super_admin)
// ------------------------------------------------------------------

export async function getAllUsers(): Promise<ActionResponse<UserRecord[]>> {
  try {
    await requireSuperAdmin();
    const supabase = await createServiceClient();

    // Fetch all user_roles joined with tenant names
    const { data: roles, error: rolesError } = await supabase
      .from("user_roles")
      .select("user_id, tenant_id, role, tenant:tenants(name)");

    if (rolesError) throw new Error(rolesError.message);

    // Fetch all license/subscription info per tenant to derive trial status
    const { data: licenses, error: licError } = await supabase
      .from("licenses")
      .select("tenant_id, plan_id, status, metadata, license_key");
    if (licError) throw new Error(licError.message);

    const { data: subs, error: subError } = await supabase
      .from("subscriptions")
      .select("tenant_id, plan_id, status");
    if (subError) throw new Error(subError.message);

    // Build tenant -> license/subscription maps
    const licByTenant = new Map<string, { plan_id: string | null; status: string | null; is_trial: boolean }>();
    for (const l of licenses ?? []) {
      const isTrial = l.status === "trialing" || (l.metadata as any)?.is_trial === true || String(l.license_key ?? "").toUpperCase().includes("TRIAL");
      licByTenant.set(l.tenant_id, {
        plan_id: l.plan_id ?? null,
        status: l.status ?? null,
        is_trial: isTrial,
      });
    }

    const subByTenant = new Map<string, { plan_id: string | null; status: string | null }>();
    for (const s of subs ?? []) {
      if (!subByTenant.has(s.tenant_id)) {
        subByTenant.set(s.tenant_id, { plan_id: s.plan_id ?? null, status: s.status ?? null });
      }
    }

    // Fetch ALL auth users from auth.admin (service role), paginating so the
    // list stays complete past the first 1000 accounts (listUsers returns one
    // page at a time, with data.nextPage = null on the last page). This is the
    // source of truth — users with no user_roles row still appear
    // ("unassigned").
    const authUsersArr: { id: string; email?: string | null }[] = [];
    let userPage: number | null = 1;
    while (userPage !== null) {
      const { data: pageData, error: authError } = await supabase.auth.admin.listUsers({
        page: userPage,
        perPage: 1000,
      });
      if (authError) throw new Error(authError.message);
      authUsersArr.push(...(pageData?.users ?? []));
      userPage = pageData?.nextPage ?? null;
    }
    const emailById = new Map<string, string>();
    for (const u of authUsersArr) {
      emailById.set(u.id, u.email ?? "");
    }

    // Group role rows by user_id (a user may have roles in multiple tenants)
    const rolesByUser = new Map<string, any[]>();
    for (const r of roles ?? []) {
      const arr = rolesByUser.get(r.user_id) ?? [];
      arr.push(r);
      rolesByUser.set(r.user_id, arr);
    }

    const users: UserRecord[] = [];

    // First: users with role rows (one record per role row)
    for (const [userId, userRoles] of rolesByUser) {
      for (const r of userRoles) {
        const lic = licByTenant.get(r.tenant_id);
        const sub = subByTenant.get(r.tenant_id);
        const isTrial = lic?.is_trial === true || sub?.status === "trialing";
        users.push({
          user_id: r.user_id,
          email: emailById.get(r.user_id) ?? "Unknown",
          role: r.role ?? "",
          tenant_id: r.tenant_id,
          tenant_name: r.tenant?.name ?? "Unknown",
          license_status: lic?.status ?? sub?.status ?? null,
          plan_id: lic?.plan_id ?? sub?.plan_id ?? null,
          is_trial: isTrial,
          has_license: !!lic,
        });
      }
    }

    // Second: auth users with NO role row at all — show as "unassigned"
    for (const u of authUsersArr) {
      if (!rolesByUser.has(u.id)) {
        users.push({
          user_id: u.id,
          email: u.email ?? "Unknown",
          role: "unassigned",
          tenant_id: "",
          tenant_name: "—",
          license_status: null,
          plan_id: null,
          is_trial: false,
          has_license: false,
        });
      }
    }

    // Sort: super_admin first, then by email
    users.sort((a, b) => {
      if (a.role === "super_admin") return -1;
      if (b.role === "super_admin") return 1;
      return a.email.localeCompare(b.email);
    });

    return { success: true, data: users };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function assignLevel(
  userId: string,
  role: string,
  tenantId?: string
): Promise<ActionResponse> {
  try {
    await requireSuperAdmin();

    const allowed = ["super_admin", "agency_admin", "agency_editor", "client"];
    if (!allowed.includes(role)) {
      throw new Error("Invalid role: " + role);
    }

    const supabase = await createServiceClient();

    // Does the user already have a role row? If so, just update the level.
    const { data: existing } = await supabase
      .from("user_roles")
      .select("user_id, tenant_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from("user_roles")
        .update({ role })
        .eq("user_id", userId);
      if (error) throw new Error(error.message);
      return { success: true };
    }

    // No role row yet ("unassigned"): insert one, which requires a tenant.
    if (!tenantId) {
      return {
        success: false,
        error: "This user has no tenant yet — select a tenant to assign them to.",
      };
    }

    // Verify the tenant exists before inserting (FK would also reject a bad id).
    const { data: tenant } = await supabase
      .from("tenants")
      .select("id")
      .eq("id", tenantId)
      .maybeSingle();
    if (!tenant) {
      return { success: false, error: "Selected tenant does not exist." };
    }

    const { error: insertError } = await supabase
      .from("user_roles")
      .insert({ user_id: userId, tenant_id: tenantId, role });
    if (insertError) throw new Error(insertError.message);

    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
