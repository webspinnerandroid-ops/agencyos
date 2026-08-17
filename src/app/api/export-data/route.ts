import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { rateLimitRequest } from "@/lib/rate-limit";
import { emailDataExport } from "@/lib/data-emails";

/**
 * POST /api/export-data
 * Body: { email }
 *
 * GDPR "export my data" — looks up the account by email, gathers everything
 * associated with it (profile, roles, and per-tenant posts, media assets,
 * audits, clients, knowledge base), and emails the user a JSON archive.
 *
 * This is a request intake like /api/data-deletion: it emails the archive
 * directly (no admin step needed), and records an audit entry so there's a
 * paper trail. Best-effort on every sub-step so a partial failure still
 * returns the archive.
 */
export async function POST(request: NextRequest) {
  try {
    const rl = rateLimitRequest(request, "export-data", 3);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Rate limit exceeded. Try again in ${rl.retryAfterSeconds}s.` },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
      );
    }

    const body = await request.json().catch(() => null);
    const email = typeof body?.email === "string" ? body.email.trim() : "";
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "A valid email address is required." }, { status: 400 });
    }
    if (email.length > 320) {
      return NextResponse.json({ error: "Email address is too long." }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Find the account. Prefer the admin getUserByEmail API; fall back to a
    // page of auth users for older SDK behavior.
    let user: { id: string; email?: string | null; created_at?: string; last_sign_in_at?: string | null } | null = null;
    try {
      const { data } = await (supabase.auth.admin as any).getUserByEmail(email);
      if (data?.user) user = data.user;
    } catch {
      // fall through to listUsers
    }
    if (!user) {
      const { data: page } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
      user = (page?.users ?? []).find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase()) ?? null;
    }

    const archive: Record<string, unknown> = {
      requestedAt: new Date().toISOString(),
      email,
      accountFound: !!user,
    };

    if (user) {
      archive.user = {
        id: user.id,
        email: user.email,
        createdAt: user.created_at,
        lastSignInAt: user.last_sign_in_at,
      };

      // Roles + the tenants the account can touch.
      const { data: roles } = await supabase
        .from("user_roles")
        .select("tenant_id, role")
        .eq("user_id", user.id);
      archive.roles = roles ?? [];
      const tenantIds = [...new Set((roles ?? []).map((r) => r.tenant_id).filter(Boolean))] as string[];

      // Per-tenant data — each is best-effort so one failure doesn't sink the export.
      const tenantData: Record<string, unknown> = {};
      for (const tenantId of tenantIds) {
        const bucket: Record<string, unknown> = {};
        const { data: t } = await supabase.from("tenants").select("id, name, slug, created_at").eq("id", tenantId).maybeSingle();
        bucket.tenant = t ?? null;

        const { data: clients } = await supabase.from("clients").select("id, name").eq("tenant_id", tenantId);
        bucket.clients = clients ?? [];

        const { data: posts } = await supabase
          .from("posts")
          .select("id, type, title, content, status, seo_score, aeo_geo_score, created_at, created_by")
          .eq("tenant_id", tenantId);
        bucket.posts = posts ?? [];

        const { data: assets } = await supabase
          .from("media_assets")
          .select("id, type, task, prompt, url, metadata, status, created_at")
          .eq("tenant_id", tenantId);
        bucket.media_assets = assets ?? [];

        const { data: audits } = await supabase
          .from("seo_campaigns")
          .select("id, url, tier_name, status, created_at")
          .eq("tenant_id", tenantId);
        bucket.seo_campaigns = audits ?? [];

        const { data: kb } = await supabase
          .from("knowledgebase_items")
          .select("id, title, created_at")
          .eq("tenant_id", tenantId);
        bucket.knowledgebase = kb ?? [];

        tenantData[tenantId] = bucket;
      }
      archive.tenants = tenantData;
    }

    // Email the archive (best-effort).
    const emailResult = await emailDataExport({ toEmail: email, archiveJson: JSON.stringify(archive) });

    // Paper trail in the admin audit log.
    try {
      await supabase.from("admin_audit_log").insert({
        actor_email: email,
        action: "data_exported",
        target_type: "user",
        target_label: email,
        details: { accountFound: !!user, emailed: emailResult.sent, tenantCount: archive.tenants ? Object.keys(archive.tenants as object).length : 0 },
      });
    } catch (err) {
      console.warn("[export-data] audit insert failed:", err);
    }

    if (!emailResult.sent) {
      return NextResponse.json(
        {
          success: true,
          message:
            "Your data export was prepared, but email delivery isn't configured yet — please contact support to receive your archive.",
          emailed: false,
        },
        { status: 200 }
      );
    }

    return NextResponse.json({
      success: true,
      emailed: true,
      message: "Your data export is on its way — check your inbox for a JSON archive.",
    });
  } catch (error: any) {
    console.error("[export-data] Error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}
