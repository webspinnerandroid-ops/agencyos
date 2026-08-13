import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { exchangeGoogleCode, encodeTokenBundle, siteUrl } from "@/lib/connections";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error || !code || !state) {
    return NextResponse.redirect(`${siteUrl()}/dashboard/connections?error=oauth_denied`);
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: stateRow, error: stateErr } = await supabase
    .from("oauth_states")
    .select("tenant_id, platform")
    .eq("state", state)
    .single();

  if (stateErr || !stateRow) {
    return NextResponse.redirect(`${siteUrl()}/dashboard/connections?error=invalid_state`);
  }

  try {
    const tokens = await exchangeGoogleCode(code);

    // Get user info (best-effort — degrades to the fallback name when the
    // call fails so a connection is never blocked on it).
    let meData: { name?: string; email?: string } = {};
    try {
      const meRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (meRes.ok) meData = (await meRes.json()) as { name?: string; email?: string };
    } catch {
      // ignore — fall back to the generic name
    }
    const accountName = meData.name ?? meData.email ?? "Google Account";

    const encrypted = encodeTokenBundle(tokens);

    const isConnectionsPlatform =
      stateRow.platform === "google_analytics" ||
      stateRow.platform === "search_console";

    if (isConnectionsPlatform) {
      await supabase.from("tenant_connections").upsert(
        {
          tenant_id: stateRow.tenant_id,
          provider: stateRow.platform,
          account_email: meData.email ?? null,
          account_name: accountName,
          encrypted_token: encrypted,
          scopes: tokens.scope ?? null,
          connected: true,
        },
        { onConflict: "tenant_id,provider" }
      );
    } else if (stateRow.platform === "google_business") {
      // Reconnect replaces the tenant's existing profile rows so repeated
      // connects can't stack up duplicates (previously showed several
      // identical "Google Account" entries).
      await supabase
        .from("google_business_profiles")
        .delete()
        .eq("tenant_id", stateRow.tenant_id);
      await supabase.from("google_business_profiles").insert({
        tenant_id: stateRow.tenant_id,
        account_name: accountName,
        encrypted_token: encrypted,
        connected: true,
      });
    } else if (stateRow.platform === "gmail") {
      await supabase.from("email_accounts").upsert(
        {
          tenant_id: stateRow.tenant_id,
          platform: "gmail",
          email_address: meData.email ?? "unknown@gmail.com",
          account_name: accountName,
          encrypted_token: encrypted,
        },
        { onConflict: "tenant_id,platform,email_address" }
      );
    } else {
      // Store in social_accounts (YouTube)
      await supabase.from("social_accounts").insert({
        tenant_id: stateRow.tenant_id,
        platform: "youtube",
        account_name: accountName,
        encrypted_token: encrypted,
      });
    }

    await supabase.from("oauth_states").delete().eq("state", state);

    const redirectTarget =
      stateRow.platform === "google_business"
        ? "/dashboard/settings/gbp?success=connected"
        : stateRow.platform === "gmail"
          ? "/dashboard/settings?success=gmail_connected"
          : isConnectionsPlatform
            ? `/dashboard/connections?success=${stateRow.platform}_connected`
            : "/dashboard/settings/social?success=connected";
    // Absolute redirect so the browser lands on the canonical site even if
    // this callback was served by a dev/local instance (which used to strand
    // the user on localhost after a successful connection).
    return NextResponse.redirect(`${siteUrl()}${redirectTarget}`);
  } catch (err) {
    console.error("[google-callback] Error:", err);
    const fallback =
      stateRow.platform === "google_analytics" ||
      stateRow.platform === "search_console"
        ? "/dashboard/connections?error=server_error"
        : stateRow.platform === "google_business"
          ? "/dashboard/settings/gbp?error=server_error"
          : "/dashboard/settings/social?error=server_error";
    return NextResponse.redirect(`${siteUrl()}${fallback}`);
  }
}