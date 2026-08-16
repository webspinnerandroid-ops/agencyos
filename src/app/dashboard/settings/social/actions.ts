"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { getTenantId } from "@/lib/auth";
import { encrypt } from "@/lib/encryption";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import { SUPPORTED_PLATFORMS, type SupportedPlatform } from "./constants";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

export interface SocialAccount {
  id: string;
  tenant_id: string;
  platform: string;
  account_name: string;
  created_at: string;
}

export interface ActionResponse<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface OAuthConfigStatus {
  metaConfigured: boolean;
  twitterConfigured: boolean;
  googleConfigured: boolean;
  googleBusinessConfigured: boolean;
  missingEnvVars: string[];
}

// ------------------------------------------------------------------
// Check OAuth environment variable configuration
// ------------------------------------------------------------------

export async function checkOAuthConfig(): Promise<OAuthConfigStatus> {
  const missing: string[] = [];
  const metaConfigured = !!(process.env.NEXT_PUBLIC_META_APP_ID && process.env.META_APP_SECRET);
  const twitterConfigured = !!(process.env.TWITTER_CLIENT_ID && process.env.TWITTER_CLIENT_SECRET);
  const googleConfigured = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  const googleBusinessConfigured = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

  if (!metaConfigured) {
    if (!process.env.NEXT_PUBLIC_META_APP_ID) missing.push("NEXT_PUBLIC_META_APP_ID");
    if (!process.env.META_APP_SECRET) missing.push("META_APP_SECRET");
  }
  if (!twitterConfigured) {
    if (!process.env.TWITTER_CLIENT_ID) missing.push("TWITTER_CLIENT_ID");
    if (!process.env.TWITTER_CLIENT_SECRET) missing.push("TWITTER_CLIENT_SECRET");
  }
  if (!googleConfigured) {
    if (!process.env.GOOGLE_CLIENT_ID) missing.push("GOOGLE_CLIENT_ID");
    if (!process.env.GOOGLE_CLIENT_SECRET) missing.push("GOOGLE_CLIENT_SECRET");
  }

  return {
    metaConfigured,
    twitterConfigured,
    googleConfigured,
    googleBusinessConfigured,
    missingEnvVars: missing,
  };
}

// ------------------------------------------------------------------
// Get platform list
// ------------------------------------------------------------------

export async function getSupportedPlatforms() {
  return SUPPORTED_PLATFORMS;
}

// ------------------------------------------------------------------
// Initiate Meta (Facebook / Instagram) OAuth flow
// ------------------------------------------------------------------

const META_APP_ID = process.env.NEXT_PUBLIC_META_APP_ID ?? "";
const META_APP_SECRET = process.env.META_APP_SECRET ?? "";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export async function initiateMetaOAuth(platform: "facebook" | "instagram"): Promise<{ success: boolean; redirectUrl?: string; error?: string }> {
  if (!META_APP_ID) {
    return { success: false, error: "Meta App ID not configured. Set NEXT_PUBLIC_META_APP_ID in .env.local" };
  }

  // Store pending OAuth state in DB (carrying the workspace so the callback
  // assigns the account to the right workspace)
  const tenantId = await getTenantId();
  const workspaceId = await getCurrentWorkspaceId().catch(() => null);
  const supabase = await createServiceClient();

  const state = crypto.randomUUID();

  const { error: insertErr } = await supabase
    .from("oauth_states")
    .insert({
      tenant_id: tenantId,
      workspace_id: workspaceId,
      state,
      platform,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });

  if (insertErr) {
    return { success: false, error: "Failed to initiate OAuth flow: " + insertErr.message };
  }

  const redirectUri = `${SITE_URL}/api/auth/callback/meta`;
  const scopes = platform === "instagram"
    ? "instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement"
    : "pages_show_list,pages_read_engagement,pages_manage_posts,pages_manage_metadata";

  const oauthUrl = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${encodeURIComponent(META_APP_ID)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}&scope=${encodeURIComponent(scopes)}&response_type=code`;

  return { success: true, redirectUrl: oauthUrl };
}

// ------------------------------------------------------------------
// Twitter OAuth 2.0
// ------------------------------------------------------------------

const TWITTER_CLIENT_ID = process.env.TWITTER_CLIENT_ID ?? "";
const TWITTER_CLIENT_SECRET = process.env.TWITTER_CLIENT_SECRET ?? "";

export async function initiateTwitterOAuth(): Promise<{ success: boolean; redirectUrl?: string; error?: string }> {
  if (!TWITTER_CLIENT_ID) {
    return { success: false, error: "Twitter Client ID not configured. Set TWITTER_CLIENT_ID in .env.local" };
  }

  const tenantId = await getTenantId();
  const workspaceId = await getCurrentWorkspaceId().catch(() => null);
  const supabase = await createServiceClient();

  const state = crypto.randomUUID();
  const codeVerifier = crypto.randomUUID() + crypto.randomUUID();
  const codeChallenge = codeVerifier; // In production, use SHA256 hashing

  const { error: insertErr } = await supabase
    .from("oauth_states")
    .insert({
      tenant_id: tenantId,
      workspace_id: workspaceId,
      state,
      platform: "twitter",
      code_verifier: codeVerifier,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });

  if (insertErr) {
    return { success: false, error: "Failed to initiate Twitter OAuth: " + insertErr.message };
  }

  const redirectUri = `${SITE_URL}/api/auth/callback/twitter`;
  const oauthUrl = `https://twitter.com/i/oauth2/authorize?response_type=code&client_id=${encodeURIComponent(TWITTER_CLIENT_ID)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=tweet.read+tweet.write+users.read+offline.access&state=${encodeURIComponent(state)}&code_challenge=${encodeURIComponent(codeChallenge)}&code_challenge_method=plain`;

  return { success: true, redirectUrl: oauthUrl };
}

// ------------------------------------------------------------------
// Google OAuth (YouTube)
// ------------------------------------------------------------------

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";

export async function initiateGoogleOAuth(platform: "youtube"): Promise<{ success: boolean; redirectUrl?: string; error?: string }> {
  if (!GOOGLE_CLIENT_ID) {
    return { success: false, error: "Google Client ID not configured. Set GOOGLE_CLIENT_ID in .env.local" };
  }

  const tenantId = await getTenantId();
  const workspaceId = await getCurrentWorkspaceId().catch(() => null);
  const supabase = await createServiceClient();

  const state = crypto.randomUUID();

  const { error: insertErr } = await supabase
    .from("oauth_states")
    .insert({
      tenant_id: tenantId,
      workspace_id: workspaceId,
      state,
      platform,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });

  if (insertErr) {
    return { success: false, error: "Failed to initiate Google OAuth: " + insertErr.message };
  }

  const redirectUri = `${SITE_URL}/api/auth/callback/google`;
  const oauthUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(GOOGLE_CLIENT_ID)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent("https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/yt-analytics.readonly")}&access_type=offline&prompt=consent&state=${encodeURIComponent(state)}`;

  return { success: true, redirectUrl: oauthUrl };
}

// ------------------------------------------------------------------
// Google OAuth (Business Profile)
// ------------------------------------------------------------------

export async function initiateGoogleGbpOAuth(): Promise<{ success: boolean; redirectUrl?: string; error?: string }> {
  if (!GOOGLE_CLIENT_ID) {
    return { success: false, error: "Google Client ID not configured. Set GOOGLE_CLIENT_ID in .env.local" };
  }

  const tenantId = await getTenantId();
  const workspaceId = await getCurrentWorkspaceId().catch(() => null);
  const supabase = await createServiceClient();

  const state = crypto.randomUUID();

  const { error: insertErr } = await supabase
    .from("oauth_states")
    .insert({
      tenant_id: tenantId,
      workspace_id: workspaceId,
      state,
      platform: "google_business",
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });

  if (insertErr) {
    return { success: false, error: "Failed to initiate Google OAuth: " + insertErr.message };
  }

  const redirectUri = `${SITE_URL}/api/auth/callback/google`;
  const oauthUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(GOOGLE_CLIENT_ID)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent("https://www.googleapis.com/auth/business.manage")}&access_type=offline&prompt=consent&state=${encodeURIComponent(state)}`;

  return { success: true, redirectUrl: oauthUrl };
}

// ------------------------------------------------------------------
// CRUD: Get accounts
// ------------------------------------------------------------------

export async function getSocialAccounts(): Promise<ActionResponse<SocialAccount[]>> {
  try {
    const tenantId = await getTenantId();
    const workspaceId = await getCurrentWorkspaceId().catch(() => null);
    const supabase = await createServiceClient();

    // Workspace-scoped accounts, plus legacy tenant-wide rows as fallback.
    let query = supabase
      .from("social_accounts")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });
    if (workspaceId) {
      query = query.or(`workspace_id.is.null,workspace_id.eq.${workspaceId}`);
    }
    const { data, error } = await query;

    if (error) throw new Error(error.message);

    return { success: true, data: data as SocialAccount[] };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ------------------------------------------------------------------
// Add a social account (called from OAuth callback — stores encrypted token)
// ------------------------------------------------------------------

export async function addSocialAccountFromCallback(
  platform: string,
  accountName: string,
  accessToken: string,
  refreshToken?: string,
  tokenExpiresAt?: string,
  workspaceId?: string | null
): Promise<ActionResponse<SocialAccount>> {
  try {
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();

    const tokenData = JSON.stringify({ access_token: accessToken, refresh_token: refreshToken, expires_at: tokenExpiresAt });
    const encryptedHex = encrypt(tokenData);

    const { data, error } = await supabase
      .from("social_accounts")
      .insert({
        tenant_id: tenantId,
        workspace_id: workspaceId ?? null,
        platform,
        account_name: accountName,
        encrypted_token: encryptedHex,
      })
      .select("*")
      .single();

    if (error) throw new Error(error.message);

    return { success: true, data: data as SocialAccount };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ------------------------------------------------------------------
// Remove a social account
// ------------------------------------------------------------------

export async function removeSocialAccount(accountId: string): Promise<ActionResponse> {
  try {
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();

    const { error } = await supabase
      .from("social_accounts")
      .delete()
      .eq("id", accountId)
      .eq("tenant_id", tenantId);

    if (error) throw new Error(error.message);

    revalidatePath("/dashboard/settings/social");
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}