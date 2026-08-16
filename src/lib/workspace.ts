"use server";

import { headers } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { getTenantId, getUserId, getRole, getUserEmail } from "@/lib/auth";
import { createNotification } from "@/lib/in-app-notifications";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// ------------------------------------------------------------------
// Team isolation (workspace_members)
// ------------------------------------------------------------------

/**
 * Resolve the set of workspace ids a user is allowed into, or null when no
 * isolation applies (owner roles, unknown user, pre-migration, or a tenant
 * with no membership rows — the legacy "see everything" case). When a set is
 * returned, the caller may ONLY access those workspace ids.
 */
async function resolveAllowedWorkspaceIds(
  userId: string | null,
  tenantId: string,
  role: string | null
): Promise<string[] | null> {
  // Owner roles always see everything.
  if (role === "super_admin" || role === "agency_admin") return null;
  if (!userId) return null; // unknown user — fail open (legacy)
  try {
    const supabase = getAdminClient();
    const { data, error } = await supabase
      .from("workspace_members")
      .select("workspace_id, user_id")
      .eq("tenant_id", tenantId);
    if (error) return null; // pre-migration (table missing) — legacy behavior
    if (!data || data.length === 0) return null; // not isolated yet
    return data
      .filter((r: any) => r.user_id === userId)
      .map((r: any) => r.workspace_id);
  } catch {
    return null;
  }
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
    const tenantId = await getTenantId();
    const userId = await getUserId();
    const role = await getRole().catch(() => null);

    // Resolve a candidate workspace id from header or cookie, then VALIDATE
    // that it actually belongs to this tenant before trusting it. A stale
    // workspace_id cookie can survive a tenant switch (same origin, another
    // tenant's session) and would otherwise scope this tenant's writes to
    // another tenant's workspace — a cross-tenant data leak. The proxy also
    // self-heals the cookie, but this check is the authoritative guard so
    // no caller ever acts on an unowned workspace id. It also enforces
    // per-workspace team isolation (workspace_members).
    const headersList = await headers();
    const headerWs = headersList.get("x-workspace-id");
    const cookieStore = await cookies();
    const cookieWs = cookieStore.get("workspace_id")?.value;
    const candidate = headerWs || cookieWs;

    const allowed = await resolveAllowedWorkspaceIds(userId, tenantId, role);

    if (candidate) {
      const { data: owned, error: ownedErr } = await getAdminClient()
        .from("workspaces")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("id", candidate)
        .maybeSingle();
      if (!ownedErr && owned && (allowed === null || allowed.includes(owned.id))) {
        return owned.id;
      }
      // Not owned by this tenant (or not granted to this member) — fall through.
    }

    // Fallback: the tenant default workspace if the caller can access it,
    // otherwise the first workspace the caller is allowed into.
    const { data: defaultWs, error: defaultErr } = await getAdminClient()
      .from("workspaces")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("is_default", true)
      .maybeSingle();
    if (!defaultErr && defaultWs && (allowed === null || allowed.includes(defaultWs.id))) {
      return defaultWs.id;
    }
    if (allowed !== null) return allowed[0] ?? null;
    return defaultWs?.id ?? null;
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

    // Team isolation: non-owner members see only their granted workspaces.
    const role = await getRole().catch(() => null);
    const userId = await getUserId();
    const allowed = await resolveAllowedWorkspaceIds(userId, tenantId, role);
    let workspaces = (data as Workspace[]) ?? [];
    if (allowed !== null) {
      workspaces = workspaces.filter((w) => allowed.includes(w.id));
    }
    return { success: true, data: workspaces };
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

// ------------------------------------------------------------------
// Team access management (super admin + agency admin)
// ------------------------------------------------------------------

export interface TeamMemberAccess {
  userId: string;
  email: string;
  role: string;
  granted: boolean;
  lastSignInAt: string | null;
  isOwner: boolean;
}

export async function getWorkspaceTeamAccess(
  workspaceId: string
): Promise<ActionResponse<{ canManage: boolean; members: TeamMemberAccess[] }>> {
  try {
    const role = await getRole().catch(() => null);
    const canManage = role === "super_admin" || role === "agency_admin";
    if (!canManage) {
      return { success: true, data: { canManage: false, members: [] } };
    }
    const tenantId = await getTenantId();
    const supabase = getAdminClient();
    const { data: ws } = await supabase
      .from("workspaces")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("id", workspaceId)
      .maybeSingle();
    if (!ws) return { success: false, error: "Workspace not found" };

    // Everyone with a role in this tenant is a team member.
    const { data: roleRows } = await supabase
      .from("user_roles")
      .select("user_id, role")
      .eq("tenant_id", tenantId);

    const { data: memberRows, error: memberErr } = await supabase
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", workspaceId);
    const granted = new Set(
      memberErr ? [] : (memberRows ?? []).map((r: any) => r.user_id)
    );

    const members: TeamMemberAccess[] = [];
    for (const r of roleRows ?? []) {
      const isOwner = r.role === "super_admin" || r.role === "agency_admin";
      let email = "Unknown";
      let lastSignInAt: string | null = null;
      try {
        const { data: u } = await supabase.auth.admin.getUserById(r.user_id);
        email = u?.user?.email ?? "Unknown";
        lastSignInAt = u?.user?.last_sign_in_at ?? null;
      } catch { /* keep Unknown */ }
      members.push({
        userId: r.user_id,
        email,
        role: r.role,
        granted: isOwner ? true : granted.has(r.user_id),
        lastSignInAt,
        isOwner,
      });
    }
    return { success: true, data: { canManage: true, members } };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function setWorkspaceMemberAccess(
  workspaceId: string,
  userId: string,
  granted: boolean
): Promise<ActionResponse> {
  try {
    const role = await getRole().catch(() => null);
    if (role !== "super_admin" && role !== "agency_admin") {
      throw new Error("Forbidden: admin access required");
    }
    const tenantId = await getTenantId();
    const supabase = getAdminClient();
    const { data: ws } = await supabase
      .from("workspaces")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("id", workspaceId)
      .maybeSingle();
    if (!ws) throw new Error("Workspace not found");

    // Target must be a member of this workspace's team.
    const { data: memberRole } = await supabase
      .from("user_roles")
      .select("role")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!memberRole) throw new Error("That user is not a member of this workspace's team.");
    if (memberRole.role === "super_admin" || memberRole.role === "agency_admin") {
      throw new Error("Owner accounts always have access to every workspace.");
    }

    if (granted) {
      const actorId = await getUserId();
      const { error } = await supabase
        .from("workspace_members")
        .upsert(
          { tenant_id: tenantId, workspace_id: workspaceId, user_id: userId, granted_by: actorId },
          { onConflict: "workspace_id,user_id" }
        );
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase
        .from("workspace_members")
        .delete()
        .eq("workspace_id", workspaceId)
        .eq("user_id", userId);
      if (error) throw new Error(error.message);
    }

    // Best-effort audit trail.
    try {
      const actorEmail = await getUserEmail().catch(() => null);
      let targetEmail = userId;
      try {
        const { data: u } = await supabase.auth.admin.getUserById(userId);
        targetEmail = u?.user?.email ?? userId;
      } catch { /* keep id */ }
      await supabase.from("admin_audit_log").insert({
        actor_email: actorEmail,
        action: granted ? "workspace_member_granted" : "workspace_member_revoked",
        target_type: "workspace_member",
        target_id: userId,
        target_label: targetEmail,
        details: { workspaceId },
      });
    } catch { /* audit is best-effort */ }

    // Notify the affected member (best-effort).
    try {
      await createNotification({
        tenantId,
        userId,
        kind: "info",
        title: granted ? "Workspace access granted" : "Workspace access removed",
        body: granted
          ? "You now have access to a workspace in this team."
          : "Your access to a workspace was removed.",
        link: "/dashboard/workspaces",
      });
    } catch { /* notification is best-effort */ }

    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

