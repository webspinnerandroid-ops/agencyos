// ============================================================================
// Google Business Profile API client — shared.
//
// Used by the dashboard server actions (settings/gbp) and by the background
// review-sync worker (Inngest). Everything takes an explicit tenantId /
// workspaceId (no request context), so it is safe to call from workers.
//
// All service-role queries are tenant-scoped inline (multi-tenant isolation
// audit requirement). The only intentionally unscoped sweep — "give me every
// connected tenant/workspace pair" — lives in the Inngest function file,
// which is allowlisted in scripts/audit-tenant-scope.cjs like the other
// cross-tenant job workers.
// ============================================================================

import { createServiceClient } from "@/lib/supabase/server";
import {
  encodeTokenBundle,
  getAccessToken,
  type ConnectionRecord,
} from "@/lib/connections";
import { createNotification } from "@/lib/in-app-notifications";
import {
  draftReviewReply,
  fetchBrandContext,
  starNumber,
} from "@/lib/gbp/drafting";
import { dispatchReviewAlert } from "@/lib/gbp/alerts";

export type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>;

// ---------------------------------------------------------------------------
// Google API types
// ---------------------------------------------------------------------------

export interface GbpAccount {
  name: string;
  accountName?: string;
}

export interface GbpLocation {
  name: string;
  title?: string;
  storefrontAddress?: {
    addressLines?: string[];
    locality?: string;
    region?: string;
  };
}

export interface GbpApiReview {
  reviewId?: string;
  starRating?: string;
  comment?: string;
  createTime?: string;
  reviewer?: { displayName?: string };
  reviewReply?: { comment?: string };
}

export interface GbpApiReviewsResponse {
  reviews?: GbpApiReview[];
  averageRating?: number;
  totalReviewCount?: number;
}

// ---------------------------------------------------------------------------
// UI-facing shapes (re-exported by the gbp server actions)
// ---------------------------------------------------------------------------

export interface GbpReviewSnapshot {
  reviewId: string;
  /** Google star rating word: ONE..FIVE. */
  starRating: string;
  comment: string | null;
  reviewerName: string;
  createTime: string | null;
  /** True once the business has posted a public reply on Google. */
  replied: boolean;
  replyComment: string | null;
  /** Locally drafted (AI) reply not yet posted to Google. */
  draftedReply: string | null;
  /** Same as draftedReply being set, for one-glance "Lana already drafted this" badges. */
  hasDraft: boolean;
  /** Notes that arrived by replying to the digest email (customer-facing context). */
  internalNotes: string[];
}

export interface GbpListingReviews {
  profileId: string;
  businessName: string;
  locationId: string;
  averageRating: number | null;
  totalReviewCount: number | null;
  reviews: GbpReviewSnapshot[];
  /** Per-listing fetch error (e.g. listing deleted on Google) — others still load. */
  error?: string;
}

export interface SyncPairResult {
  ok: boolean;
  error?: string;
  listings: GbpListingReviews[];
  newReviews: number;
}

// ---------------------------------------------------------------------------
// Fetch with retry/backoff + user-readable rate-limit errors
// ---------------------------------------------------------------------------

/**
 * User-readable message for Google API rate limiting. The project is approved
 * for 300 QPM (was the old 1 req/min default), so hitting 429 after automatic
 * retries means a quota/spike issue rather than an approval problem.
 */
export function gbp429Error(): string {
  return "Google is still rate-limiting the Business Profile API after automatic retries. This project is approved for 300 queries per minute — check APIs & Services → Quotas in Google Cloud and try again in a minute.";
}

/**
 * Fetch with automatic retry + exponential backoff on 429 (rate limit) and
 * 5xx (Google blips). Delays: ~1s, ~3s (+ jitter). The final response is
 * returned as-is so callers handle remaining errors (429 message, 4xx...).
 */
const GBP_RETRY_DELAYS_MS = [1_000, 3_000];

export async function gbpFetch(
  url: string,
  accessToken: string,
  init?: { method?: string; body?: string }
): Promise<Response> {
  let lastRes: Response | null = null;
  for (let attempt = 0; attempt <= GBP_RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      const jitter = Math.floor(Math.random() * 500);
      await new Promise((r) => setTimeout(r, GBP_RETRY_DELAYS_MS[attempt - 1] + jitter));
    }
    const res = await fetch(url, {
      method: init?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init?.body,
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status !== 429 && res.status < 500) return res;
    lastRes = res;
  }
  return lastRes!;
}

export async function fetchGbpAccounts(accessToken: string): Promise<GbpAccount[]> {
  const accountsRes = await gbpFetch(
    "https://mybusinessaccountmanagement.googleapis.com/v1/accounts",
    accessToken
  );
  const accountsText = await accountsRes.text().catch(() => "");
  if (!accountsRes.ok) {
    if (accountsRes.status === 429) throw new Error(gbp429Error());
    const detail = accountsText.startsWith("{")
      ? JSON.parse(accountsText).error?.message ?? accountsText.slice(0, 200)
      : accountsText.slice(0, 200);
    throw new Error(`Google account lookup failed: ${detail}`);
  }
  const accountsJson = JSON.parse(accountsText);
  return accountsJson.accounts ?? [];
}

export async function fetchGbpLocations(
  accessToken: string,
  account: GbpAccount
): Promise<GbpLocation[]> {
  const accId = account.name.split("/").pop();
  if (!accId) return [];
  // Primary: Business Information API (v1). readMask is required by that API.
  const v1 = await gbpFetch(
    `https://mybusinessbusinessinformation.googleapis.com/v1/accounts/${accId}/locations?pageSize=100&readMask=name,title,storefrontAddress`,
    accessToken
  );
  if (v1.ok) {
    const j = await v1.json().catch(() => ({}));
    return j.locations ?? [];
  }
  if (v1.status === 429) throw new Error(gbp429Error());
  // Fallback: legacy My Business API (v4).
  const v4 = await gbpFetch(
    `https://mybusiness.googleapis.com/v4/accounts/${accId}/locations?pageSize=100`,
    accessToken
  );
  if (v4.ok) {
    const j = await v4.json().catch(() => ({}));
    return j.locations ?? [];
  }
  if (v4.status === 429) throw new Error(gbp429Error());
  return [];
}

export const addressText = (l: GbpLocation): string => {
  const a = l.storefrontAddress;
  if (!a) return "";
  return [...(a.addressLines ?? []), a.locality, a.region].filter(Boolean).join(", ");
};

// ---------------------------------------------------------------------------
// Token + profile helpers
// ---------------------------------------------------------------------------

export interface GbpProfileRow {
  id: string;
  tenant_id: string;
  workspace_id: string | null;
  account_name: string | null;
  location_id: string | null;
  baseline_synced: boolean | null;
}

/**
 * Shared token lookup: grabs the newest connected profile row for this
 * tenant/workspace and returns a (possibly refreshed) access token, plus the
 * bundle to persist back so future calls use the rotated refresh token.
 * Tenant-scoped by explicit argument — no request context, worker-safe.
 */
export async function getFreshGbpTokenForProfile(
  supabase: ServiceClient,
  tenantId: string,
  workspaceId: string | null
): Promise<{ accessToken: string; storedToken: string } | { error: string }> {
  let tokenQuery = supabase
    .from("google_business_profiles")
    .select("encrypted_token, account_email")
    .eq("tenant_id", tenantId)
    .eq("connected", true)
    .order("created_at", { ascending: false });
  if (workspaceId) {
    tokenQuery = tokenQuery.or(`workspace_id.is.null,workspace_id.eq.${workspaceId}`);
  }
  const { data: row } = await tokenQuery.limit(1).maybeSingle();
  if (!row?.encrypted_token) {
    return { error: "Connect a Google account first, then try again." };
  }

  const { accessToken, fresh } = await getAccessToken({
    encrypted_token: row.encrypted_token,
  } as ConnectionRecord);
  const storedToken = fresh ? encodeTokenBundle(fresh) : row.encrypted_token;
  return { accessToken, storedToken };
}

/**
 * Fetch the reviews page for one listing off the legacy v4 API (the only one
 * that serves reviews). Returns a per-listing result instead of throwing so
 * one broken listing never fails the batch.
 */
export async function fetchReviewsForProfile(
  accessToken: string,
  accountId: string,
  locSuffix: string
): Promise<{ ok: true; data: GbpApiReviewsResponse } | { ok: false; error: string }> {
  const res = await gbpFetch(
    `https://mybusiness.googleapis.com/v4/accounts/${accountId}/locations/${locSuffix}/reviews?pageSize=50`,
    accessToken
  );
  if (!res.ok) {
    if (res.status === 429) return { ok: false, error: gbp429Error() };
    return { ok: false, error: `Google reviews fetch failed (HTTP ${res.status}).` };
  }
  const json = (await res.json().catch(() => ({}))) as GbpApiReviewsResponse;
  return { ok: true, data: json };
}

/**
 * Post a public reply to a review on Google (legacy v4 reply endpoint).
 * Returns the error message on failure instead of throwing — the caller
 * decides how to surface it.
 */
export async function postReplyOnGoogle(
  accessToken: string,
  accountId: string,
  locSuffix: string,
  reviewId: string,
  comment: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await gbpFetch(
    `https://mybusiness.googleapis.com/v4/accounts/${accountId}/locations/${locSuffix}/reviews/${encodeURIComponent(reviewId)}:reply`,
    accessToken,
    { method: "POST", body: JSON.stringify({ comment }) }
  );
  if (!res.ok) {
    if (res.status === 429) return { ok: false, error: gbp429Error() };
    const text = await res.text().catch(() => "");
    const detail = text.startsWith("{")
      ? JSON.parse(text).error?.message ?? text.slice(0, 200)
      : text.slice(0, 200);
    return { ok: false, error: `Google rejected the reply (HTTP ${res.status})${detail ? `: ${detail}` : "."}` };
  }
  return { ok: true };
}

/** Map every location the token can see to its owning account resource name. */
export async function buildLocationAccountMap(
  accessToken: string
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const accounts = await fetchGbpAccounts(accessToken);
  for (const account of accounts) {
    for (const location of await fetchGbpLocations(accessToken, account)) {
      map.set(location.name, account.name);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Sync-state tracking (gbp_sync_state) — one row per tenant, shared by the
// hourly worker and manual "Sync now" clicks so Google is never hammered.
// ---------------------------------------------------------------------------

export interface SyncStateRow {
  id: string;
  tenant_id: string;
  last_sync_started: string | null;
  last_sync_ok: string | null;
}

export async function getGbpSyncState(
  supabase: ServiceClient,
  tenantId: string
): Promise<SyncStateRow | null> {
  const { data } = await supabase
    .from("gbp_sync_state")
    .select("id, tenant_id, last_sync_started, last_sync_ok")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return (data as SyncStateRow | null) ?? null;
}

const MIN_SYNC_INTERVAL_MS = 60_000;

/** Stamp that a sync is starting (upsert on the per-tenant row). */
export async function markSyncStarted(
  supabase: ServiceClient,
  tenantId: string
): Promise<void> {
  await supabase
    .from("gbp_sync_state")
    .upsert(
      { tenant_id: tenantId, last_sync_started: new Date().toISOString() },
      { onConflict: "tenant_id" }
    );
}

/** Stamp a successful sync completion. */
export async function markSyncOk(
  supabase: ServiceClient,
  tenantId: string
): Promise<void> {
  await supabase
    .from("gbp_sync_state")
    .upsert(
      { tenant_id: tenantId, last_sync_ok: new Date().toISOString() },
      { onConflict: "tenant_id" }
    );
}

/** True when another sync ran so recently that Google shouldn't be hit again. */
export function isSyncThrottled(state: SyncStateRow | null): boolean {
  if (!state?.last_sync_started) return false;
  const t = Date.parse(state.last_sync_started);
  return !Number.isNaN(t) && Date.now() - t < MIN_SYNC_INTERVAL_MS;
}

// ---------------------------------------------------------------------------
// Snapshot reads (no Google calls)
// ---------------------------------------------------------------------------

/**
 * Render-ready reviews read straight from the gbp_reviews snapshots. The
 * hourly worker and manual syncs keep them fresh; the dashboard reads these
 * so opening the page never waits on Google.
 */
export async function listSnapshotReviews(
  supabase: ServiceClient,
  tenantId: string,
  workspaceId: string | null
): Promise<GbpListingReviews[]> {
  // Profiles in scope (same scope as getProfiles).
  let rowsQuery = supabase
    .from("google_business_profiles")
    .select("id, account_name, location_id, average_rating, total_review_count")
    .eq("tenant_id", tenantId)
    .eq("connected", true);
  if (workspaceId) {
    rowsQuery = rowsQuery.or(`workspace_id.is.null,workspace_id.eq.${workspaceId}`);
  }
  const { data: profileRows } = await rowsQuery;
  const profiles = ((profileRows ?? []) as {
    id: string;
    account_name: string | null;
    location_id: string | null;
    average_rating: number | null;
    total_review_count: number | null;
  }[]).filter((p) => p.location_id);
  if (profiles.length === 0) return [];

  const { data: reviewRows } = await supabase
    .from("gbp_reviews")
    .select(
      "profile_id, review_id, star_rating, comment, reviewer_name, create_time, replied, reply_comment, reply_text, internal_notes"
    )
    .eq("tenant_id", tenantId)
    .in("profile_id", profiles.map((p) => p.id))
    .order("create_time", { ascending: false, nullsFirst: false })
    .limit(500);

  const byProfile = new Map<string, GbpListingReviews>();
  for (const p of profiles) {
    byProfile.set(p.id, {
      profileId: p.id,
      businessName: p.account_name ?? "Business Profile",
      locationId: p.location_id!,
      averageRating: p.average_rating ?? null,
      totalReviewCount: p.total_review_count,
      reviews: [],
    });
  }
  for (const r of (reviewRows ?? []) as {
    profile_id: string;
    review_id: string;
    star_rating: string;
    comment: string | null;
    reviewer_name: string | null;
    create_time: string | null;
    replied: boolean | null;
    reply_comment: string | null;
    reply_text: string | null;
    internal_notes: string[] | null;
  }[]) {
    const listing = byProfile.get(r.profile_id);
    if (!listing) continue;
    listing.reviews.push({
      reviewId: r.review_id,
      starRating: r.star_rating,
      comment: r.comment,
      reviewerName: r.reviewer_name ?? "Google user",
      createTime: r.create_time,
      replied: !!r.replied,
      replyComment: r.reply_comment,
      draftedReply: r.reply_text,
      hasDraft: !r.replied && !!r.reply_text,
      internalNotes: r.internal_notes ?? [],
    });
  }
  return [...byProfile.values()];
}

// ---------------------------------------------------------------------------
// Review snapshot sync (gbp_reviews table) + new-review notifications
// ---------------------------------------------------------------------------

const excerpt = (text: string | null | undefined, max = 160): string => {
  if (!text) return "";
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/**
 * Sync review snapshots for every connected listing of one tenant/workspace
 * pair: upserts the latest Google reviews into `gbp_reviews` and fires
 * in-app notifications for genuinely-new reviews.
 *
 * Baseline rule: a listing's FIRST sync stores history silently (except up to
 * 3 unanswered ≤3★ reviews — the reputation fires Lana actually needs), so
 * connecting a business never spams the bell with years of old reviews.
 * Every sync after that notifies on each new review.
 *
 * Returns the same per-listing shape the reviews UI renders, so the
 * interactive action and the cron worker share one implementation.
 */
export async function syncGbpReviewsForPair(
  supabase: ServiceClient,
  tenantId: string,
  workspaceId: string | null
): Promise<SyncPairResult> {
  const empty: SyncPairResult = { ok: true, listings: [], newReviews: 0 };

  const token = await getFreshGbpTokenForProfile(supabase, tenantId, workspaceId);
  if ("error" in token) return { ok: false, error: token.error, listings: [], newReviews: 0 };
  const { accessToken } = token;

  // Connected listings for this tenant/workspace (same scope as getProfiles).
  let rowsQuery = supabase
    .from("google_business_profiles")
    .select("id, tenant_id, workspace_id, account_name, location_id, baseline_synced")
    .eq("tenant_id", tenantId)
    .eq("connected", true)
    .not("location_id", "is", null);
  if (workspaceId) {
    rowsQuery = rowsQuery.or(`workspace_id.is.null,workspace_id.eq.${workspaceId}`);
  }
  const { data: profileRows, error: rowsErr } = await rowsQuery;
  if (rowsErr) return { ok: false, error: rowsErr.message, listings: [], newReviews: 0 };
  const profiles = (profileRows ?? []) as GbpProfileRow[];
  if (profiles.length === 0) return empty;

  const locationAccount = await buildLocationAccountMap(accessToken);
  // Brand voice for this workspace, fetched once for all listings (used by
  // the pre-drafter below; empty string when no brand profile exists).
  const brandContext = await fetchBrandContext(supabase, tenantId, workspaceId);

  const listings: GbpListingReviews[] = [];
  let newReviews = 0;

  for (const profile of profiles) {
    const base: GbpListingReviews = {
      profileId: profile.id,
      businessName: profile.account_name ?? "Business Profile",
      locationId: profile.location_id!,
      averageRating: null,
      totalReviewCount: null,
      reviews: [],
    };
    const accountId = locationAccount.get(profile.location_id!)?.split("/").pop();
    const locSuffix = profile.location_id!.split("/").pop();
    if (!accountId || !locSuffix) {
      listings.push({
        ...base,
        error: "Listing not found on the connected Google accounts — re-run “Choose businesses”.",
      });
      continue;
    }

    const fetched = await fetchReviewsForProfile(accessToken, accountId, locSuffix);
    if (!fetched.ok) {
      listings.push({ ...base, error: fetched.error });
      continue;
    }
    const api = fetched.data;
    const apiReviews = api.reviews ?? [];

    // Existing snapshots for this listing — used both to detect new reviews
    // and to keep locally drafted replies visible after re-syncs.
    const { data: existingRows } = await supabase
      .from("gbp_reviews")
      .select("review_id, reply_text, notified_at")
      .eq("tenant_id", tenantId)
      .eq("profile_id", profile.id);
    const existing = new Map(
      (existingRows ?? []).map((r) => [r.review_id as string, r])
    );
    const isBaseline = !profile.baseline_synced;

    // Upsert snapshots. The payload deliberately omits reply_text/notified_at
    // so PostgREST's ON CONFLICT UPDATE leaves drafts and notification state
    // untouched on existing rows.
    if (apiReviews.length > 0) {
      const { error: upErr } = await supabase.from("gbp_reviews").upsert(
        apiReviews.map((r) => ({
          tenant_id: tenantId,
          workspace_id: profile.workspace_id,
          profile_id: profile.id,
          review_id: r.reviewId ?? "",
          star_rating: r.starRating ?? "FIVE",
          comment: r.comment ?? null,
          reviewer_name: r.reviewer?.displayName ?? "Google user",
          create_time: r.createTime ?? null,
          replied: !!r.reviewReply,
          reply_comment: r.reviewReply?.comment ?? null,
        })),
        { onConflict: "profile_id,review_id" }
      );
      if (upErr) {
        listings.push({ ...base, error: `Snapshot save failed: ${upErr.message}` });
        continue;
      }
    }

    // Notify on genuinely-new reviews (baseline stays quiet — see docstring).
    const newOnes = apiReviews.filter(
      (r) => r.reviewId && !existing.has(r.reviewId)
    );
    const toNotify = isBaseline
      ? newOnes
          .filter((r) => !r.reviewReply && starNumber(r.starRating ?? "FIVE") <= 3)
          .slice(0, 3)
      : newOnes;
    for (const r of toNotify) {
      const stars = starNumber(r.starRating ?? "FIVE");
      const who = r.reviewer?.displayName ?? "A Google user";
      const what = excerpt(r.comment);
      await createNotification({
        tenantId,
        kind: stars <= 3 ? "alert" : "info",
        title: `New ${stars}★ Google review for ${base.businessName}`,
        body: what ? `${who}: ${what}` : `${who} left a ${stars}★ rating.`,
        link: "/dashboard/settings/gbp",
        groupKey: `gbp-review:${profile.id}`,
      });

      // Out-of-band push for 1★ disasters: fan out to the tenant's configured
      // Slack/Discord webhooks (gbp_alert_webhooks). Best-effort — a broken
      // webhook must never break the sync, so failures are swallowed here.
      if (stars <= 1) {
        try {
          await dispatchReviewAlert(supabase, {
            tenantId,
            businessName: base.businessName,
            reviewerName: r.reviewer?.displayName ?? null,
            starRating: r.starRating ?? "FIVE",
            comment: r.comment ?? null,
            createTime: r.createTime ?? null,
          });
        } catch (err) {
          console.warn(
            "[gbp] alert webhook failed (continuing):",
            err instanceof Error ? err.message : err
          );
        }
      }
    }
    newReviews += toNotify.length;

    // Pre-draft Lana replies for new 1-2★ reviews so a response is already
    // waiting when the notification is opened. Best-effort: an AI or save
    // failure must never break the sync — the user can still draft by hand.
    const toPreDraft = newOnes.filter(
      (r) =>
        !r.reviewReply &&
        r.reviewId &&
        starNumber(r.starRating ?? "FIVE") <= 2 &&
        !existing.get(r.reviewId)?.reply_text
    );
    for (const r of toPreDraft) {
      try {
        const draft = await draftReviewReply(tenantId, {
          businessName: base.businessName,
          starRatingWord: r.starRating ?? "FIVE",
          reviewerName: r.reviewer?.displayName ?? null,
          comment: r.comment ?? null,
          brandContext,
        });
        if (draft.response?.trim()) {
          await supabase
            .from("gbp_reviews")
            .update({ reply_text: draft.response })
            .eq("tenant_id", tenantId)
            .eq("profile_id", profile.id)
            .eq("review_id", r.reviewId!);
        }
      } catch (err) {
        console.warn(
          "[gbp] pre-draft failed (continuing):",
          err instanceof Error ? err.message : err
        );
      }
    }

    // First sync for this listing done — history is snapshotted.
    if (isBaseline) {
      await supabase
        .from("google_business_profiles")
        .update({ baseline_synced: true })
        .eq("id", profile.id)
        .eq("tenant_id", tenantId);
    }

    listings.push({
      ...base,
      averageRating: typeof api.averageRating === "number" ? api.averageRating : null,
      totalReviewCount:
        typeof api.totalReviewCount === "number" ? api.totalReviewCount : null,
      reviews: apiReviews.map((r) => ({
        reviewId: r.reviewId ?? "",
        starRating: r.starRating ?? "FIVE",
        comment: r.comment ?? null,
        reviewerName: r.reviewer?.displayName ?? "Google user",
        createTime: r.createTime ?? null,
        replied: !!r.reviewReply,
        replyComment: r.reviewReply?.comment ?? null,
        draftedReply:
          (r.reviewId ? existing.get(r.reviewId)?.reply_text : null) ?? null,
        hasDraft:
          !r.reviewReply && !!r.reviewId && !!existing.get(r.reviewId)?.reply_text,
        internalNotes: [],
      })),
    });

    // Cache Google's own aggregate stats on the listing row so snapshot reads
    // can show the TRUE rating/count, not an average of the stored window.
    if (
      typeof api.averageRating === "number" ||
      typeof api.totalReviewCount === "number"
    ) {
      await supabase
        .from("google_business_profiles")
        .update({
          ...(typeof api.averageRating === "number"
            ? { average_rating: api.averageRating }
            : {}),
          ...(typeof api.totalReviewCount === "number"
            ? { total_review_count: api.totalReviewCount }
            : {}),
        })
        .eq("tenant_id", tenantId)
        .eq("id", profile.id);
    }
  }

  return { ok: true, listings, newReviews };
}
