import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/outreach/[id]/send
 *
 * Emails the drafted pitch to the target's contact address via Resend, then
 * marks the target 'pitched' with pitch_sent_at set. Requires a draft pitch
 * and a contact email on the target.
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

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "RESEND_API_KEY is not configured — add it in the server env, then try again." },
        { status: 500 }
      );
    }

    const supabase = await createServiceClient();
    const { data: target, error } = await supabase
      .from("outreach_targets")
      .select("blog_name, blog_url, contact_email, pitch, status")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error || !target) {
      return NextResponse.json({ error: "Target not found" }, { status: 404 });
    }
    if (!target.contact_email) {
      return NextResponse.json(
        { error: "This target has no contact email — add one before sending." },
        { status: 400 }
      );
    }
    if (!target.pitch) {
      return NextResponse.json(
        { error: "Draft the pitch first (Draft pitch), then send." },
        { status: 400 }
      );
    }

    // The pitch is stored as "Subject: ...\n\nbody".
    const subjectMatch = target.pitch.match(/^Subject:\s*(.+)$/im);
    const subject = subjectMatch?.[1]?.trim() || `Guest post pitch for ${target.blog_name ?? "your blog"}`;
    const body = target.pitch.replace(/^Subject:\s*.+$/im, "").trim();

    const fromEmail = process.env.RESEND_FROM_EMAIL ?? "agency@updates.yourdomain.com";
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [target.contact_email],
        subject,
        text: body,
        tags: [
          { name: "outreach_target_id", value: id },
          { name: "tenant_id", value: tenantId },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `Email provider error (${res.status}): ${text.slice(0, 300)}` },
        { status: 502 }
      );
    }

    await supabase
      .from("outreach_targets")
      .update({ status: "pitched", pitch_sent_at: new Date().toISOString() })
      .eq("id", id)
      .eq("tenant_id", tenantId);

    return NextResponse.json({ ok: true, sentTo: target.contact_email, subject });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 });
  }
}
