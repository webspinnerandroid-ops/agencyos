import { NextRequest, NextResponse } from "next/server";
import { getTenantId, getUserId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Super-admin model registry.
 *
 * GET                — all models with provider + deprecation state.
 * POST { verify }    — check availability of fal.ai models by fetching their
 *                      public model page; 404 ⇒ mark deprecated + record time.
 * POST { deprecate } — manually set is_deprecated for a model id.
 */
async function requireAdmin(): Promise<{ tenantId: string; supabase: any } | { error: string }> {
  const tenantId = await getTenantId();
  if (!tenantId) return { error: "Authentication required" };
  const userId = await getUserId();
  if (!userId) return { error: "Authentication required" };
  const supabase = await createServiceClient();
  const { data: roles } = await supabase
    .from("user_roles")
    .select("role")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId);
  const isAdmin = (roles ?? []).some((r: any) => r.role === "super_admin");
  return isAdmin ? { tenantId, supabase } : { error: "Super admin access required" };
}

export async function GET() {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: 403 });

    const { supabase } = auth;
    const { data, error } = await supabase
      .from("ai_models")
      .select("id, model_identifier, supported_tasks, is_deprecated, last_verified_at, provider:ai_providers(id, name)")
      .order("model_identifier");
    if (error) throw error;
    return NextResponse.json({ models: data ?? [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Internal error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: 403 });

    const { supabase } = auth;
    const body = (await request.json().catch(() => ({}))) as {
      verify?: boolean;
      deprecate?: { id: string; is_deprecated: boolean };
    };

    // Manual deprecation toggle.
    if (body.deprecate) {
      const { data, error } = await supabase
        .from("ai_models")
        .update({ is_deprecated: body.deprecate.is_deprecated, last_verified_at: new Date().toISOString() })
        .eq("id", body.deprecate.id)
        .select("id, model_identifier, is_deprecated")
        .single();
      if (error) throw error;
      return NextResponse.json({ model: data });
    }

    // Availability check for fal.ai-hosted models (model pages are public).
    if (body.verify) {
      const { data } = await supabase
        .from("ai_models")
        .select("id, model_identifier, provider:ai_providers(name)")
        .eq("provider.name", "fal.ai");
      const checked: { model_identifier: string; exists: boolean }[] = [];
      for (const m of (data ?? []) as any[]) {
        const res = await fetch(`https://fal.ai/models/${m.model_identifier}`, { method: "HEAD" });
        const exists = res.status === 200;
        await supabase
          .from("ai_models")
          .update({ is_deprecated: !exists, last_verified_at: new Date().toISOString() })
          .eq("id", m.id);
        checked.push({ model_identifier: m.model_identifier, exists });
      }
      return NextResponse.json({ checked });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Internal error" }, { status: 500 });
  }
}
