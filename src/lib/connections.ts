/**
 * Google Analytics 4 + Search Console connections.
 *
 * OAuth follows the same pattern as the existing Google flows (social
 * accounts, Google Business Profile): an `oauth_states` row tracks the
 * round-trip, `/api/auth/callback/google` exchanges the code, and the tokens
 * are stored AES-encrypted in `tenant_connections` via `encrypt()`.
 *
 * Access tokens live ~1h; `getAccessToken()` transparently refreshes with the
 * stored refresh token when needed.
 */
import { decrypt, encrypt } from "@/lib/encryption";

export type ConnectionProvider = "google_analytics" | "search_console";

export interface ConnectionRecord {
  id: string;
  tenant_id: string;
  provider: ConnectionProvider;
  account_email: string | null;
  account_name: string | null;
  encrypted_token: string;
  scopes: string | null;
  selected_resource: string | null;
  resource_label: string | null;
  connected: boolean;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TokenBundle {
  access_token: string;
  refresh_token?: string | null;
  expires_at?: number; // epoch seconds
  scope?: string;
}

export const PROVIDER_LABELS: Record<ConnectionProvider, string> = {
  google_analytics: "Google Analytics 4",
  search_console: "Search Console",
};

export const PROVIDER_SCOPES: Record<ConnectionProvider, string> = {
  google_analytics: "https://www.googleapis.com/auth/analytics.readonly",
  search_console: "https://www.googleapis.com/auth/webmasters.readonly",
};

export function googleOAuthConfigured(): boolean {
  return !!(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
  );
}

export function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export function encodeTokenBundle(tokens: TokenBundle): string {
  return encrypt(JSON.stringify(tokens));
}

export function decodeTokenBundle(encrypted: string): TokenBundle {
  const raw = decrypt(encrypted) ?? "{}";
  return JSON.parse(raw) as TokenBundle;
}

async function tokenExchange(body: URLSearchParams): Promise<TokenBundle> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    throw new Error(
      data.error_description ?? data.error ?? `Token exchange failed (${res.status})`
    );
  }
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_in ? Math.floor(Date.now() / 1000) + data.expires_in : undefined,
    scope: data.scope,
  };
}

/** Exchange the authorization code for tokens (called by the callback route). */
export async function exchangeGoogleCode(
  code: string
): Promise<TokenBundle> {
  return tokenExchange(
    new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${siteUrl()}/api/auth/callback/google`,
      grant_type: "authorization_code",
    })
  );
}

/** Refresh an expired access token using the stored refresh token. */
export async function refreshGoogleToken(
  refreshToken: string
): Promise<TokenBundle> {
  const fresh = await tokenExchange(
    new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: "refresh_token",
    })
  );
  // Refresh responses don't always return a new refresh token — keep the old one.
  if (!fresh.refresh_token) fresh.refresh_token = refreshToken;
  return fresh;
}

/**
 * Return a usable access token for a stored connection, refreshing when the
 * stored one has expired. When `fresh` is non-null the caller should persist
 * the re-encrypted bundle via `encodeTokenBundle(fresh)`.
 */
export async function getAccessToken(
  connection: ConnectionRecord
): Promise<{ accessToken: string; fresh: TokenBundle | null }> {
  const bundle = decodeTokenBundle(connection.encrypted_token);
  if (
    bundle.expires_at &&
    bundle.expires_at > Math.floor(Date.now() / 1000) + 60 &&
    bundle.access_token
  ) {
    return { accessToken: bundle.access_token, fresh: null };
  }
  if (!bundle.refresh_token) {
    throw new Error("Connection has no refresh token — reconnect it.");
  }
  const fresh = await refreshGoogleToken(bundle.refresh_token);
  return { accessToken: fresh.access_token, fresh };
}

// ---------------------------------------------------------------------------
// Resource listing
// ---------------------------------------------------------------------------

async function googleGet<T>(path: string, accessToken: string): Promise<T> {
  const res = await fetch(`https://www.googleapis.com${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text().catch(() => "");
  let data: unknown = {};
  if (text.trim().startsWith("{") || text.trim().startsWith("[")) {
    try {
      data = JSON.parse(text);
    } catch {
      data = {};
    }
  }
  if (!res.ok) {
    const apiMsg = (data as { error?: { message?: string } })?.error?.message;
    if (!apiMsg && res.status === 404) {
      // Google serves a bare HTML 404 when the requested API is not enabled
      // for the project that owns the OAuth client.
      throw new Error(
        "The Google API for this connection isn't enabled on your Google Cloud project. Enable it (APIs & Services → Library), then try again."
      );
    }
    throw new Error(apiMsg ?? `Google API error (${res.status})`);
  }
  return data as T;
}

export interface GA4PropertyOption {
  propertyId: string; // numeric id
  displayName: string;
  accountName: string;
}

/**
 * Flatten GA4 account summaries into a selectable property list.
 * Endpoint: analyticsadmin.googleapis.com/v1beta/accountSummaries
 */
export async function listGA4Properties(
  accessToken: string
): Promise<GA4PropertyOption[]> {
  const data = await googleGet<{
    accountSummaries?: {
      name?: string;
      displayName?: string;
      propertySummaries?: { property?: string; displayName?: string }[];
    }[];
  }>("/analyticsadmin/v1beta/accountSummaries", accessToken);

  const out: GA4PropertyOption[] = [];
  for (const account of data.accountSummaries ?? []) {
    const accountName =
      account.displayName ?? account.name?.replace("accounts/", "") ?? "Account";
    for (const prop of account.propertySummaries ?? []) {
      const propertyId = prop.property?.replace("properties/", "");
      if (!propertyId) continue;
      out.push({
        propertyId,
        displayName: prop.displayName ?? `Property ${propertyId}`,
        accountName,
      });
    }
  }
  return out;
}

/** List Search Console verified sites. Endpoint: webmasters/v3/sites */
export async function listSearchConsoleSites(
  accessToken: string
): Promise<{ siteUrl: string; permissionLevel: string }[]> {
  const data = await googleGet<{
    siteEntry?: { siteUrl?: string; permissionLevel?: string }[];
  }>("/webmasters/v3/sites", accessToken);
  return (data.siteEntry ?? [])
    .filter((s) => s.siteUrl)
    .map((s) => ({ siteUrl: s.siteUrl!, permissionLevel: s.permissionLevel ?? "" }));
}

// ---------------------------------------------------------------------------
// Build the Google consent URL for a provider
// ---------------------------------------------------------------------------

export function buildGoogleAuthUrl(
  provider: ConnectionProvider,
  state: string
): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${siteUrl()}/api/auth/callback/google`,
    response_type: "code",
    scope: PROVIDER_SCOPES[provider],
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}
