import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getTenantId } from "@/lib/auth";

/**
 * GET /api/ai/models?task=video_generation
 * Returns models that support the given task AND belong to a provider that
 * actually has an API key connected (a tenant key for this tenant, or a
 * platform default key from the environment). Deprecated models are excluded.
 * Used by the Generate Videos picker and any task-model selector.
 */
export async function GET(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    if (!tenantId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const supabase = await createServiceClient();

    const task = request.nextUrl.searchParams.get("task") ?? "video_generation";

    // Only providers THIS TENANT has configured. Platform env defaults are the
    // super-admin's keys and must not leak into tenant-facing selectors.
    const { data: tenantKeys } = await supabase
      .from("tenant_api_keys")
      .select("provider_id")
      .eq("tenant_id", tenantId)
      .eq("is_active", true);
    const keyedProviderIds = new Set((tenantKeys ?? []).map((k: any) => k.provider_id));

    // Models with their provider.
    const { data, error } = await supabase
      .from("ai_models")
      .select("id, model_identifier, supported_tasks, is_deprecated, provider:ai_providers(id, name, type)")
      .contains("supported_tasks", [task]);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const models = (data ?? []).filter((m: any) => {
      const provider = m.provider as { id: string; name: string; type?: string } | null;
      if (!provider) return false;
      if (m.is_deprecated === true) return false;
      // Connected = an ACTIVE tenant key for this provider only.
      return keyedProviderIds.has(provider.id);
    });

    return NextResponse.json({ models });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
