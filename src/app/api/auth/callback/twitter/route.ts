import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error || !code || !state) {
    return NextResponse.redirect(new URL("/dashboard/connections?error=oauth_denied", request.url));
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: stateRow, error: stateErr } = await supabase
    .from("oauth_states")
    .select("tenant_id, platform, code_verifier, workspace_id")
    .eq("state", state)
    .single();

  if (stateErr || !stateRow) {
    return NextResponse.redirect(new URL("/dashboard/connections?error=invalid_state", request.url));
  }

  try {
    const clientId = process.env.TWITTER_CLIENT_ID!;
    const clientSecret = process.env.TWITTER_CLIENT_SECRET!;
    const redirectUri = `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/api/auth/callback/twitter`;

    const tokenRes = await fetch("https://api.twitter.com/2/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code_verifier: stateRow.code_verifier ?? "challenge",
      }),
    });

    const tokenData = await tokenRes.json();

    if (tokenData.error) {
      console.error("[twitter-callback] Token error:", tokenData.error);
      return NextResponse.redirect(new URL("/dashboard/connections?error=token_exchange_failed", request.url));
    }

    // Get user info
    const meRes = await fetch("https://api.twitter.com/2/users/me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const meData = await meRes.json();
    const accountName = meData.data?.username ?? "Twitter User";

    const encrypted = Buffer.from(JSON.stringify({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
    })).toString("base64");

    await supabase.from("social_accounts").insert({
      tenant_id: stateRow.tenant_id,
      workspace_id: stateRow.workspace_id ?? null,
      platform: "twitter",
      account_name: `@${accountName}`,
      encrypted_token: encrypted,
    });

    await supabase.from("oauth_states").delete().eq("state", state);

    return NextResponse.redirect(new URL("/dashboard/connections?success=connected", request.url));
  } catch (err) {
    console.error("[twitter-callback] Error:", err);
    return NextResponse.redirect(new URL("/dashboard/connections?error=server_error", request.url));
  }
}