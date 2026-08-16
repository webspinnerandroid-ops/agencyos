import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { rateLimitRequest } from "@/lib/rate-limit";
import { isDisposableEmail } from "@/lib/disposable-email";

/**
 * POST /api/auth/resend-confirmation
 * Body: { email }
 *
 * Generates a fresh signup-confirmation link for an unverified account and
 * emails it via Resend (rate limited — public endpoint). Never reveals
 * whether an account exists: the response is the same either way.
 */
export async function POST(request: NextRequest) {
  try {
    const rl = rateLimitRequest(request, "resend-confirmation", 5);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Rate limit exceeded. Try again in ${rl.retryAfterSeconds}s.` },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
      );
    }

    const body = await request.json().catch(() => ({}));
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
    }

    // Disposable / temp-mail domains can't request confirmation links — the
    // account should never have existed, and this blocks the resend path too.
    if (isDisposableEmail(email)) {
      return NextResponse.json({ ok: true });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Only send for users who exist and are NOT yet confirmed.
    const { data: users } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const existing = users?.users.find((u) => u.email?.toLowerCase() === email);
    if (!existing || existing.email_confirmed_at) {
      // Never reveal whether an account exists — same message either way.
      return NextResponse.json({ ok: true });
    }

    // Generate a fresh signup link, then email it via Resend (reliable, and
    // works even if the provider's default confirmation email was missed).
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: "signup",
      email,
      // Not used for confirmation — required by the API's signup-link shape.
      password: "placeholder-not-used",
    } as any);
    const actionLink = linkData?.properties?.action_link;
    if (linkError || !actionLink) {
      return NextResponse.json({ error: "Could not generate a confirmation link." }, { status: 500 });
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Email delivery is not configured yet." }, { status: 500 });
    }
    const fromEmail = process.env.RESEND_FROM_EMAIL ?? "agency@updates.yourdomain.com";
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from: fromEmail,
        to: [email],
        subject: "Confirm your Agency OS account",
        html: `<p>Thanks for signing up for Agency OS!</p>
<p>Click the button below to confirm your email address and activate your account:</p>
<p><a href="${actionLink}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;">Confirm my email</a></p>
<p style="color:#6b7280;font-size:14px;">If the button doesn't work, copy and paste this link into your browser:<br/>${actionLink}</p>
<p style="color:#6b7280;font-size:14px;">If you didn't create an Agency OS account, you can ignore this email.</p>`,
        tags: [{ name: "auth_type", value: "signup_confirmation" }],
      }),
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 });
  }
}
