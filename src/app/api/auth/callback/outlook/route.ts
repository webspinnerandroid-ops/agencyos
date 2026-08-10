import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error || !code || !state) {
    return NextResponse.redirect(
      new URL("/dashboard/settings?error=outlook_oauth_denied", request.url)
    );
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
    return NextResponse.redirect(
      new URL("/dashboard/settings?error=invalid_state", request.url)
    );
  }

  try {
    const clientId = process.env.OUTLOOK_CLIENT_ID;
    const clientSecret = process.env.OUTLOOK_CLIENT_SECRET;
    const redirectUri = `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/api/auth/callback/outlook`;

    if (!clientId || !clientSecret) {
      throw new Error("Missing OUTLOOK_CLIENT_ID or OUTLOOK_CLIENT_SECRET environment variables");
    }

    const tokenRes = await fetch(
      "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      }
    );

    const tokenData = await tokenRes.json();

    if (tokenData.error) {
      console.error("[outlook-callback] Token error:", tokenData.error);
      return NextResponse.redirect(
        new URL("/dashboard/settings?error=token_exchange_failed", request.url)
      );
    }

    // Get user info from Microsoft Graph
    const meRes = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const meData = await meRes.json();
    const emailAddress = meData.mail ?? meData.userPrincipalName ?? "unknown@outlook.com";
    const accountName = meData.displayName ?? emailAddress;

    const encrypted = JSON.stringify({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_in: tokenData.expires_in,
    });

    // Store in email_accounts
    await supabase.from("email_accounts").upsert(
      {
        tenant_id: stateRow.tenant_id,
        platform: "outlook",
        email_address: emailAddress,
        account_name: accountName,
        encrypted_token: encrypted,
      },
      { onConflict: "tenant_id,platform,email_address" }
    );

    await supabase.from("oauth_states").delete().eq("state", state);

    return NextResponse.redirect(
      new URL("/dashboard/settings?success=outlook_connected", request.url)
    );
  } catch (err) {
    console.error("[outlook-callback] Error:", err);
    return NextResponse.redirect(
      new URL("/dashboard/settings?error=outlook_server_error", request.url)
    );
  }
}