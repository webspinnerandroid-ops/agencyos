import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/notifications";

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

    // Resolve the tenant + the form widget's config from the page (public
    // endpoint — no auth cookie). The block config carries the destination
    // email / subject / newsletter flags set in the builder.
    let tenantId: string | null = null;
    let blockConfig: Record<string, unknown> = {};
    if (pageId) {
      const { data: page } = await supabase
        .from("site_pages")
        .select("tenant_id, blocks")
        .eq("id", pageId)
        .maybeSingle();
      tenantId = page?.tenant_id ?? null;
      const blocks = (Array.isArray(page?.blocks) ? page.blocks : []) as any[];
      const block = blocks.find((b) => b.id === blockId);
      if (block?.kind === "custom" && typeof block.config === "object" && block.config) {
        blockConfig = block.config as Record<string, unknown>;
      }
    }
    if (!tenantId) {
      return NextResponse.json(
        { error: "This form is not connected to a published page." },
        { status: 400 }
      );
    }

    const { error } = await supabase.from("cms_form_submissions").insert({
      tenant_id: tenantId,
      page_id: pageId || null,
      block_id: blockId || null,
      fields,
    });
    if (error) {
      console.error("[cms/forms]", error.message);
      return NextResponse.json({ error: "Failed to store submission" }, { status: 500 });
    }

    // Email the destination if the widget was configured with one. Delivery
    // goes through the notifications helper (logs until SMTP/Resend is set).
    const destination = String(blockConfig.destination_email ?? "").trim();
    if (destination) {
      const rows = Object.entries(fields)
        .map(([k, v]) => `<li><strong>${k}:</strong> ${String(v).replace(/</g, "&lt;")}</li>`)
        .join("");
      await sendEmail({
        to: destination,
        subject: String(blockConfig.email_subject ?? "New form submission from your website").slice(0, 150),
        html: `<p>A new form submission arrived from your website:</p><ul>${rows}</ul>`,
      }).catch((e: any) => console.error("[cms/forms] email", e?.message));
    }

    return NextResponse.json({
      success: true,
      message: blockConfig.newsletter
        ? "Thank you — you're subscribed!"
        : "Thank you — your submission has been received.",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal error" },
      { status: 500 }
    );
  }
}
