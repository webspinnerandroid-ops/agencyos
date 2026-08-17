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

  // Validate OAuth state
  const { data: stateRow, error: stateErr } = await supabase
    .from("oauth_states")
    .select("tenant_id, platform, workspace_id")
    .eq("state", state)
    .single();

  if (stateErr || !stateRow) {
    return NextResponse.redirect(new URL("/dashboard/connections?error=invalid_state", request.url));
  }

  // Exchange code for token
  const appId = process.env.NEXT_PUBLIC_META_APP_ID!;
  const appSecret = process.env.META_APP_SECRET!;
  const redirectUri = `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/api/auth/callback/meta`;

  try {
    const tokenRes = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${appSecret}&code=${code}`
    );
    const tokenData = await tokenRes.json();

    if (tokenData.error) {
      console.error("[meta-callback] Token exchange failed:", tokenData.error);
      return NextResponse.redirect(new URL("/dashboard/connections?error=token_exchange_failed", request.url));
    }

    // Get user info
    const meRes = await fetch(`https://graph.facebook.com/me?access_token=${tokenData.access_token}`);
    const meData = await meRes.json();

    const accountName = meData.name ?? "Facebook Page";

    // Store in social_accounts
    const encrypted = Buffer.from(JSON.stringify({
      access_token: tokenData.access_token,
      expires_in: tokenData.expires_in,
    })).toString("base64");

    await supabase
      .from("social_accounts")
      .insert({
        tenant_id: stateRow.tenant_id,
        workspace_id: stateRow.workspace_id ?? null,
        platform: stateRow.platform,
        account_name: accountName,
        encrypted_token: encrypted,
      });

    // Clean up used state
    await supabase.from("oauth_states").delete().eq("state", state);

    return NextResponse.redirect(new URL("/dashboard/connections?success=connected", request.url));
  } catch (err) {
    console.error("[meta-callback] Error:", err);
    return NextResponse.redirect(new URL("/dashboard/connections?error=server_error", request.url));
  }
}