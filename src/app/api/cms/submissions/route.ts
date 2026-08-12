import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

/** GET /api/cms/submissions?pageId=<optional> — latest form submissions. */
export async function GET(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();
    const pageId = request.nextUrl.searchParams.get("pageId");

    let query = supabase
      .from("cms_form_submissions")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("submitted_at", { ascending: false })
      .limit(50);
    if (pageId) query = query.eq("page_id", pageId);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ submissions: data ?? [] });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal error" },
      { status: 500 }
    );
  }
}
