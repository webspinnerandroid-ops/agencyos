import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/gbp/digest-reply
 *
 * Turns a reply to the weekly reputation digest email into an internal note
 * on the review it was about (gbp_reviews.internal_notes). The note shows
 * inline on the review in Settings → Google Business Profile and the
 * Reputation dashboard, so client feedback lands next to the review Lana is
 * working on.
 *
 * Called by Resend's inbound webhook (or any mail gateway). Accepts either a
 * Resend-style payload ({ email: { from, subject, text } }) or a plain flat
 * shape. Opt-in hardening mirrors /api/outreach/reply-webhook: when
 * OUTREACH_WEBHOOK_SECRET is set, the request must carry it in the
 * `x-webhook-secret` header.
 *
 * Review matching, in order:
 *  1. A "[Re:#<id8>]" token from the digest email — the authoritative match
 *     (id8 is the first 8 chars of the review row's UUID).
 *  2. Fallback: the sender's email matches a connected Google account
 *     (google_business_profiles.account_email) and exactly one of that
 *     account's reviews is still unanswered — attach there.
 * Otherwise the reply is accepted but ignored (202) so mail providers don't
 * retry forever; nothing is written.
 *
 * Trust model (same class as the allowlisted outreach reply webhook): the
 * routing is driven by the SENDER's own email, never a client-supplied
 * tenant id. Candidate rows come from gbp_reviews (a table without a
 * tenant_id column, scoped through its profile join), and every write is
 * keyed to that row's own id + the tenant_id read off the row.
 */
export async function POST(request: NextRequest) {
  try {
    const secret = process.env.OUTREACH_WEBHOOK_SECRET;
    if (secret && request.headers.get("x-webhook-secret") !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const email = body.email ?? body;
    const fromRaw = String(email.from ?? email.sender ?? "");
    const subject = String(email.subject ?? "");
    const rawText = String(email.text ?? email.body ?? "");
    const fromEmail = (fromRaw.match(/<([^>]+)>/)?.[1] ?? fromRaw)
      .trim()
      .toLowerCase();
    if (!fromEmail.includes("@")) {
      return NextResponse.json({ error: "from is required" }, { status: 400 });
    }

    const text = firstRealLine(rawText, subject);
    if (!text) {
      return NextResponse.json({ ok: true, matched: false, reason: "no content" });
    }

    const supabase = await createServiceClient();

    // 1) Authoritative: the [Re:#<id8>] token embedded by the digest builder.
    //    id8 collisions are refused (ambiguous) rather than misdelivered.
    const token = (subject + " " + rawText).match(/\[Re:#([0-9a-f]{8,16})\]/i)?.[1];
    if (token) {
      const { data: rows } = await supabase
        .from("gbp_reviews")
        .select("id, tenant_id")
        .like("id", `${token}%`)
        .limit(2);
      const list = (rows ?? []) as { id: string; tenant_id: string }[];
      if (list.length === 1) {
        await appendNote(supabase, list[0].id, list[0].tenant_id, fromEmail, text);
        return NextResponse.json({ ok: true, matched: true, by: "token" });
      }
      if (list.length > 1) {
        return NextResponse.json({ ok: true, matched: false, reason: "ambiguous" });
      }
    }

    // 2) Fallback: the sender owns connected Google listings and has exactly
    //    one unanswered review among them. The embed filter keeps the
    //    candidate set to reviews whose owning profile carries the SENDER's
    //    account_email; the per-candidate re-verification below is
    //    defense-in-depth against PostgREST embed edge cases.
    const { data: candidates, error: candErr } = await supabase
      .from("gbp_reviews")
      .select(
        "id, tenant_id, profile_id, reviewer_name, star_rating, replied, create_time, google_business_profiles!inner(account_email)"
      )
      .eq("google_business_profiles.account_email", fromEmail)
      .eq("google_business_profiles.connected", true)
      .order("create_time", { ascending: false, nullsFirst: false })
      .limit(100);
    if (candErr) {
      console.warn("[gbpDigestReply] candidate query:", candErr.message);
    }
    const rows = (candidates ?? []) as {
      id: string;
      tenant_id: string;
      profile_id: string;
      reviewer_name: string | null;
      star_rating: string;
      replied: boolean | null;
      create_time: string | null;
    }[];

    // Defense-in-depth: re-verify each candidate's owning profile with a
    // small tenant-scoped query (the fallback path is rare and the cap keeps
    // this bounded).
    const owned: typeof rows = [];
    for (const r of rows) {
      const { data: prof } = await supabase
        .from("google_business_profiles")
        .select("account_email")
        .eq("id", r.profile_id)
        .eq("tenant_id", r.tenant_id)
        .eq("connected", true)
        .maybeSingle();
      if (prof?.account_email?.toLowerCase() === fromEmail) owned.push(r);
    }

    const unanswered = owned.filter((r) => !r.replied);
    let match: (typeof rows)[number] | undefined;
    if (unanswered.length === 1) {
      match = unanswered[0];
    } else if (unanswered.length > 1) {
      // Prefer a quoted reviewer first-name mention in the reply text.
      const lower = text.toLowerCase();
      match = unanswered.find(
        (r) =>
          r.reviewer_name &&
          lower.includes(r.reviewer_name.toLowerCase().split(" ")[0])
      );
    }
    if (match) {
      await appendNote(supabase, match.id, match.tenant_id, fromEmail, text);
      return NextResponse.json({ ok: true, matched: true, by: "sender" });
    }

    return NextResponse.json({ ok: true, matched: false });
  } catch (err) {
    console.error("[gbpDigestReply] failed:", err);
    return NextResponse.json(
      { error: (err as Error).message ?? "Internal error" },
      { status: 500 }
    );
  }
}

/** First meaningful line of the reply — strips quoted history and signatures. */
function firstRealLine(rawText: string, subject: string): string {
  const lines = rawText
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(
      (l) =>
        l.length > 0 &&
        !l.startsWith(">") &&
        !/^-{2,}\s*$/.test(l) && // "-- " signature delimiter (with variants)
        !/^on .+ wrote:$/i.test(l)
    );
  const candidate = lines[0] ?? "";
  // Some gateways deliver only a subject for ultra-short replies.
  if (!candidate && subject.trim()) {
    return subject.replace(/\[Re:#\w+\]/gi, "").trim();
  }
  return candidate.slice(0, 2000);
}

/** Append the note to gbp_reviews.internal_notes (read-modify-write). */
async function appendNote(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  reviewId: string,
  tenantId: string,
  fromEmail: string,
  text: string
): Promise<void> {
  const { data: row } = await supabase
    .from("gbp_reviews")
    .select("internal_notes")
    .eq("id", reviewId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const notes = ((row?.internal_notes ?? []) as string[]).slice(-20); // cap history
  notes.push(
    `[${new Date().toISOString().slice(0, 10)} from ${fromEmail}] ${text.slice(0, 1000)}`
  );
  const { error } = await supabase
    .from("gbp_reviews")
    .update({ internal_notes: notes })
    .eq("id", reviewId)
    .eq("tenant_id", tenantId);
  if (error) throw new Error(error.message);
}
