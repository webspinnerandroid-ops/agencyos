import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { generateStructuredOutput } from "@/lib/ai/orchestrator";

/**
 * POST /api/outreach/[id]/pitch
 * Body: { siteName?: string, sampleTitles?: string[], angle?: string }
 *
 * Drafts a personalized guest-post pitch for this target using the tenant's
 * text model. Saves it to target.pitch (status stays 'discovered' until the
 * user marks it pitched).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = await getTenantId();
    if (!tenantId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      siteName?: string;
      sampleTitles?: string[];
      angle?: string;
    };

    const supabase = await createServiceClient();
    const { data: target, error } = await supabase
      .from("outreach_targets")
      .select("*")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error || !target) {
      return NextResponse.json({ error: "Target not found" }, { status: 404 });
    }

    const pitch = await generateStructuredOutput<{ subject: string; body: string }>(
      "team_chat",
      `You are a senior outreach specialist. Write a short, personal, non-spammy
guest-post pitch email. First line: a specific compliment referencing the blog's
actual content or audience. Then 2-3 concrete article ideas tailored to this
blog (specific, not generic). Close with a low-pressure ask and your signature.
Return JSON: { "subject": "under 70 chars", "body": "plain text, under 250 words" }.`,
      `Blog: ${target.blog_name ?? target.blog_url}
Blog URL: ${target.blog_url}
Their angle/why we matched: ${target.notes ?? ""}
Our site/brand: ${body.siteName ?? "our agency"}
Our content strengths: ${(body.sampleTitles ?? []).join("; ") || "SEO, content marketing, and industry research"}
Specific angle to lead with: ${body.angle ?? "(pick the strongest fit for this blog)"}`,
      tenantId,
      {
        type: "object",
        properties: { subject: { type: "string" }, body: { type: "string" } },
        required: ["subject", "body"],
      },
      { temperature: 0.7, maxTokens: 900, functionName: "write_guest_post_pitch" }
    );

    const fullPitch = `Subject: ${pitch.subject}\n\n${pitch.body}`;
    const { data: updated } = await supabase
      .from("outreach_targets")
      .update({ pitch: fullPitch })
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .select("*")
      .single();

    return NextResponse.json({ pitch: fullPitch, target: updated });
  } catch (err: any) {
    const message = err?.message ?? "Internal error";
    const noKey = message.includes("No API key") || message.includes("no provider");
    return NextResponse.json(
      { error: noKey ? "No AI provider key configured. Add one in AI Settings → API Keys." : message },
      { status: 500 }
    );
  }
}
