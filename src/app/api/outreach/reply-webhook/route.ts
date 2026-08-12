import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/outreach/reply-webhook
 *
 * Records a reply to an outreach email and auto-updates the pipeline. Called
 * by Resend's inbound webhook (or any mail gateway) when a target replies to
 * a pitch. Accepts either a Resend-style payload or a plain
 * { targetId, from, subject, text } shape.
 *
 * Opt-in hardening: when OUTREACH_WEBHOOK_SECRET is set, the request must
 * carry it in the `x-webhook-secret` header. Target ids are UUIDs either way.
 */
export async function POST(request: NextRequest) {
  try {
    const secret = process.env.OUTREACH_WEBHOOK_SECRET;
    if (secret && request.headers.get("x-webhook-secret") !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    // Resend inbound: { email: { from, subject, text, to } }; plain: flat.
    const email = body.email ?? body;
    const targetId = String(body.targetId ?? email.targetId ?? "");
    const from = String(email.from ?? email.sender ?? "");
    const subject = String(email.subject ?? "");
    const text = String(email.text ?? email.body ?? "").slice(0, 4000);
    if (!targetId || !text.trim()) {
      return NextResponse.json({ error: "targetId and text are required" }, { status: 400 });
    }

    const supabase = await createServiceClient();
    const { data: target } = await supabase
      .from("outreach_targets")
      .select("id, tenant_id, client_id, status, notes, last_reply_text, last_reply_seen, reply_count")
      .eq("id", targetId)
      .maybeSingle();
    if (!target) {
      return NextResponse.json({ error: "Unknown target" }, { status: 404 });
    }

    const replyNote = `[Reply ${new Date().toISOString().slice(0, 10)} from ${from}] ${text}`;
    const nextStatus = target.status === "rejected" ? "pitched" : target.status || "pitched";
    const { error } = await supabase
      .from("outreach_targets")
      .update({
        last_reply_at: new Date().toISOString(),
        last_reply_text: text,
        reply_count: (target.reply_count ?? 0) + 1,
        last_reply_seen: false,
        status: nextStatus,
        notes: [target.notes, replyNote].filter(Boolean).join("\n"),
      })
      .eq("id", target.id)
      .eq("tenant_id", target.tenant_id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Keep the client file up to date: append the reply to the client's notes
    // so the conversation trail lives with the client record.
    if (target.client_id) {
      const { data: client } = await supabase
        .from("clients")
        .select("notes")
        .eq("id", target.client_id)
        .eq("tenant_id", target.tenant_id)
        .maybeSingle();
      if (client) {
        await supabase
          .from("clients")
          .update({ notes: [client.notes, replyNote].filter(Boolean).join("\n") })
          .eq("id", target.client_id)
          .eq("tenant_id", target.tenant_id);
      }
    }

    return NextResponse.json({ ok: true, status: nextStatus, replyCount: (target.reply_count ?? 0) + 1 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 });
  }
}
