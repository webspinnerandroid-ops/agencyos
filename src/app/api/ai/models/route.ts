import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getTenantId } from "@/lib/auth";

/**
 * GET /api/ai/models?task=video_generation
 * Returns models that support the given task (defaults to video_generation),
 * grouped with their provider name — used by the Generate Videos page picker.
 */
export async function GET(request: NextRequest) {
  try {
    await getTenantId();
    const supabase = await createServiceClient();

    const task = request.nextUrl.searchParams.get("task") ?? "video_generation";

    const { data, error } = await supabase
      .from("ai_models")
      .select("id, model_identifier, supported_tasks, provider:ai_providers(id, name)")
      .contains("supported_tasks", [task])
      .order("model_identifier");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ models: data ?? [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
