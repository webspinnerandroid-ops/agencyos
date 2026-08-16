"use server";

import { createClient } from "@supabase/supabase-js";
import { getTenantId, getUserId, getRole, getUserEmail } from "@/lib/auth";
import { isDisposableEmail } from "@/lib/disposable-email";
import { randomBytes } from "crypto";

/**
 * Team-member invitation lives in its own module because it performs an
 * admin-wide cross-tenant check: it reads user_roles by primary key (user_id)
 * to refuse hijacking a user who already belongs to another team. That lookup
 * is intentionally outside the actor's tenant scope (super_admin / agency_admin
 * manage the whole team), so this file is allowlisted in
 * scripts/audit-tenant-scope.cjs rather than weakening the per-tenant guard.
 */

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export interface ActionResponse<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Add a team member to this tenant (super admin or agency admin). Creates the
 * auth account if it doesn't exist (with a temporary password the admin can
 * share while outbound email is off), assigns their role, and grants the
 * requested workspaces. Idempotent for an existing account: it just attaches
 * the role and memberships.
 */
export async function inviteTeamMember(
  email: string,
  role: string,
  workspaceIds: string[]
): Promise<ActionResponse<{ userId: string; tempPassword?: string; existing: boolean }>> {
  try {
    const actorRole = await getRole().catch(() => null);
    if (actorRole !== "super_admin" && actorRole !== "agency_admin") {
      throw new Error("Forbidden: admin access required");
    }
    const tenantId = await getTenantId();
    const supabase = getAdminClient();

    const cleanEmail = String(email ?? "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) {
      throw new Error("A valid email is required.");
    }
    if (isDisposableEmail(cleanEmail)) {
      throw new Error("Please use a real email address — disposable/temporary mail providers are not allowed.");
    }

    const allowedRoles = ["agency_admin", "agency_editor", "client"];
    if (!allowedRoles.includes(role)) {
      throw new Error("Role must be Admin, Editor, or User / Client.");
    }
    // Super-admin role is never handed out here — super admins are minted
    // explicitly, and never by an agency admin.

    // Workspaces must belong to this tenant.
    const validIds: string[] = [];
    for (const wsId of workspaceIds ?? []) {
      const { data: ws } = await supabase
        .from("workspaces")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("id", wsId)
        .maybeSingle();
      if (ws) validIds.push(wsId);
    }

    let userId: string;
    let existing = false;
    let tempPassword: string | undefined;
    const { data: existingUsers } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const found = existingUsers?.users.find((u) => u.email?.toLowerCase() === cleanEmail);
    if (found) {
      userId = found.id;
      existing = true;
    } else {
      tempPassword = randomBytes(12).toString("base64url");
      const { data: created, error: createErr } = await supabase.auth.admin.createUser({
        email: cleanEmail,
        password: tempPassword,
        email_confirm: false,
        user_metadata: { invited_by: (await getUserId()) ?? null },
      });
      if (createErr || !created?.user) {
        throw new Error("Could not create the user: " + (createErr?.message ?? "unknown error"));
      }
      userId = created.user.id;
    }

    // A user belongs to exactly one tenant (user_roles.user_id is the PK).
    // This by-PK lookup is intentionally cross-tenant: it refuses to move a
    // user who already belongs to a different team.
    const { data: existingRole } = await supabase
      .from("user_roles")
      .select("tenant_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (existingRole && existingRole.tenant_id !== tenantId) {
      throw new Error("That user already belongs to another team.");
    }

    const { error: roleErr } = await supabase
      .from("user_roles")
      .upsert({ user_id: userId, tenant_id: tenantId, role }, { onConflict: "user_id" });
    if (roleErr) throw new Error(roleErr.message);

    const actorId = await getUserId();
    for (const wsId of validIds) {
      await supabase
        .from("workspace_members")
        .upsert(
          { tenant_id: tenantId, workspace_id: wsId, user_id: userId, granted_by: actorId },
          { onConflict: "workspace_id,user_id" }
        );
    }

    // Best-effort audit trail.
    try {
      await supabase.from("admin_audit_log").insert({
        actor_email: await getUserEmail().catch(() => null),
        action: existing ? "team_member_added" : "team_member_invited",
        target_type: "team_member",
        target_id: userId,
        target_label: cleanEmail,
        details: { role, workspaceIds: validIds },
      });
    } catch { /* audit is best-effort */ }

    return { success: true, data: { userId, tempPassword, existing } };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
