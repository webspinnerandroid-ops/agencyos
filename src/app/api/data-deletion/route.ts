import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { rateLimitRequest, getClientIp } from "@/lib/rate-limit";

/**
 * Public data-deletion request endpoint (required by Meta/Facebook, Google,
 * and app-store review). A user submits the email on their account and we
 * record a `data_deletion_requested` entry in the admin audit log, then alert
 * every super admin so the request is processed (account + data removal).
 *
 * This is a request intake — it does NOT delete anything itself. Deletion is
 * performed by a super admin from the Admin panel (deleteUser / deleteTenant),
 * which already has the hard guarantee that super admin accounts can never be
 * removed. The audit entry gives the admin every detail needed to act.
 */
export async function POST(request: NextRequest) {
  try {
    // Abuse protection — public endpoint.
    const rl = rateLimitRequest(request, "data-deletion", 5);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Rate limit exceeded. Try again in ${rl.retryAfterSeconds}s.` },
        {
          status: 429,
          headers: { "Retry-After": String(rl.retryAfterSeconds) },
        }
      );
    }

    const body = await request.json().catch(() => null);
    const email = typeof body?.email === "string" ? body.email.trim() : "";
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { error: "A valid email address is required." },
        { status: 400 }
      );
    }
    if (email.length > 320) {
      return NextResponse.json(
        { error: "Email address is too long." },
        { status: 400 }
      );
    }
    if (reason.length > 2000) {
      return NextResponse.json(
        { error: "Reason is too long (max 2000 characters)." },
        { status: 400 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const ip = getClientIp(request);

    // Record the request in the admin audit log (best-effort — a failure to
    // log must never block the user's confirmation).
    let auditOk = false;
    try {
      const { error } = await supabase.from("admin_audit_log").insert({
        actor_email: email,
        action: "data_deletion_requested",
        target_type: "user",
        target_label: email,
        details: { reason: reason || null, ip },
      });
      auditOk = !error;
      if (error) {
        console.warn("[data-deletion] audit insert failed:", error.message);
      }
    } catch (err) {
      console.warn("[data-deletion] audit insert failed:", err);
    }

    // Alert every super admin so the request gets processed.
    if (auditOk) {
      try {
        const { data: roles } = await supabase
          .from("user_roles")
          .select("user_id, tenant_id")
          .eq("role", "super_admin");
        for (const r of roles ?? []) {
          const { createNotification } = await import("@/lib/in-app-notifications");
          await createNotification({
            tenantId: r.tenant_id,
            userId: r.user_id,
            kind: "alert",
            title: "Data deletion request",
            body: `${email} requested deletion of their data${reason ? ` — reason: ${reason.slice(0, 300)}` : ""}.`,
            link: "/dashboard/admin",
          });
        }
      } catch (err) {
        console.warn("[data-deletion] super-admin notify failed:", err);
      }
    }

    return NextResponse.json({
      success: true,
      message:
        "Your data deletion request has been received. We will process it within 30 days and confirm by email. If you are a signed-in user, you can also delete your account directly from your profile settings.",
    });
  } catch (error: any) {
    console.error("[data-deletion] Error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}
