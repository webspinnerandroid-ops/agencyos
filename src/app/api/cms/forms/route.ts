import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/cms/forms
 * Public endpoint — AI-built form widgets POST here. Fields are read from
 * the form body; page_id/block_id identify which widget submitted. Stored
 * per tenant for the agency to review.
 */
export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const pageId = String(form.get("page_id") ?? "");
    const blockId = String(form.get("block_id") ?? "");

    const fields: Record<string, string> = {};
    for (const [key, value] of form.entries()) {
      if (key === "page_id" || key === "block_id") continue;
      fields[key] = typeof value === "string" ? value.slice(0, 5000) : String(value);
    }
    if (Object.keys(fields).length === 0) {
      return NextResponse.json({ error: "No form fields submitted" }, { status: 400 });
    }

    const supabase = await createServiceClient();

    // Resolve the tenant from the page (public endpoint — no auth cookie).
    let tenantId: string | null = null;
    if (pageId) {
      const { data: page } = await supabase
        .from("site_pages")
        .select("tenant_id")
        .eq("id", pageId)
        .maybeSingle();
      tenantId = page?.tenant_id ?? null;
    }

    const { error } = await supabase.from("cms_form_submissions").insert({
      tenant_id: tenantId ?? "00000000-0000-0000-0000-000000000000", // orphan fallback
      page_id: pageId || null,
      block_id: blockId || null,
      fields,
    });
    if (error) {
      console.error("[cms/forms]", error.message);
      return NextResponse.json({ error: "Failed to store submission" }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: "Thank you — your submission has been received." });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal error" },
      { status: 500 }
    );
  }
}
