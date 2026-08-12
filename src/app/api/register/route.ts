import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { rateLimitRequest } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  try {
    // Rate limit (abuse protection — register is public and creates tenants)
    const rl = rateLimitRequest(request, "register", 5);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Rate limit exceeded. Try again in ${rl.retryAfterSeconds}s.` },
        {
          status: 429,
          headers: { "Retry-After": String(rl.retryAfterSeconds) },
        }
      );
    }

    const body = await request.json();
    const { email, password, companyName, planId } = body;

    if (!email || !password || !companyName) {
      return NextResponse.json({ error: "email, password, and companyName required" }, { status: 400 });
    }

    // Use direct Supabase admin client (bypasses RLS, no cookie binding)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // 0. Create user via admin API. email_confirm: false — Supabase sends the
    // confirmation email and the account can't sign in until it's verified.
    const { data: userData, error: userError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: false,
      user_metadata: { company_name: companyName },
    });

    if (userError) {
      return NextResponse.json({ error: "Failed to create user: " + userError.message }, { status: 500 });
    }

    const userId = userData.user.id;

    // 1. Create tenant
    const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + Date.now().toString(36);
    const { data: tenant, error: tenantError } = await supabase
      .from("tenants")
      .insert({ name: companyName, slug, primary_color: "#2563eb" })
      .select("id")
      .single();

    if (tenantError) {
      return NextResponse.json({ error: "Failed to create tenant: " + tenantError.message }, { status: 500 });
    }

    // 2. Assign user role
    const { error: roleError } = await supabase
      .from("user_roles")
      .insert({ user_id: userId, tenant_id: tenant.id, role: "agency_admin" });

    if (roleError) {
      return NextResponse.json({ error: "Failed to assign role: " + roleError.message }, { status: 500 });
    }

    // 3. Create default workspace
    const { data: workspace } = await supabase
      .from("workspaces")
      .insert({ tenant_id: tenant.id, name: "Default Workspace", slug: "default", is_default: true })
      .select("id")
      .single();

    // 4. Create default brand profile
    if (workspace) {
      await supabase.from("brand_profiles").insert({
        workspace_id: workspace.id,
        tenant_id: tenant.id,
        name: "Default Brand Profile",
        is_default: true,
      });
    }

    // 5. Create subscription record
    await supabase.from("subscriptions").insert({
      tenant_id: tenant.id,
      plan_id: planId || "starter",
      status: "trialing",
    });

    // 6. Issue a trial license
    const licenseKey = `AOS-${Date.now().toString(36).toUpperCase()}-TRIAL`;
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

    const limits: Record<string, any> = { max_workspaces: 1, max_kb_items: 50 };
    if (planId === "growth") {
      limits.max_workspaces = 5;
      limits.max_kb_items = 250;
    } else if (planId === "enterprise") {
      limits.max_workspaces = 100;
      limits.max_kb_items = 10000;
    }

    // NOTE: licenses CHECK constraint only allows active/suspended/expired/cancelled,
    // so we keep status 'active' and flag the Trial via metadata.is_trial.
    await supabase.from("licenses").insert({
      tenant_id: tenant.id,
      license_key: licenseKey,
      plan_id: planId || "starter",
      status: "active",
      seats_total: 1,
      seats_used: 1,
      expires_at: expiresAt,
      limits,
      metadata: { is_trial: true },
    });

    return NextResponse.json({ success: true, tenantId: tenant.id, licenseKey });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Internal error" }, { status: 500 });
  }
}