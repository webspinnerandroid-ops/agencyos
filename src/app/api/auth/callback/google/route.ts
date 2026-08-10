import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error || !code || !state) {
    return NextResponse.redirect(new URL("/dashboard/settings/social?error=oauth_denied", request.url));
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
    return NextResponse.redirect(new URL("/dashboard/settings/social?error=invalid_state", request.url));
  }

  try {
    const clientId = process.env.GOOGLE_CLIENT_ID!;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
    const redirectUri = `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/api/auth/callback/google`;

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const tokenData = await tokenRes.json();

    if (tokenData.error) {
      console.error("[google-callback] Token error:", tokenData.error);
      const redirectTarget = stateRow.platform === "google_business"
        ? "/dashboard/settings/gbp?error=token_exchange_failed"
        : "/dashboard/settings/social?error=token_exchange_failed";
      return NextResponse.redirect(new URL(redirectTarget, request.url));
    }

    // Get user info
    const meRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const meData = await meRes.json();
    const accountName = meData.name ?? meData.email ?? "Google Account";

    const encrypted = Buffer.from(JSON.stringify({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_in: tokenData.expires_in,
    })).toString("base64");

    if (stateRow.platform === "google_business") {
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
          : "/dashboard/settings/social?success=connected";
    return NextResponse.redirect(new URL(redirectTarget, request.url));
  } catch (err) {
    console.error("[google-callback] Error:", err);
    return NextResponse.redirect(new URL("/dashboard/settings/social?error=server_error", request.url));
  }
}