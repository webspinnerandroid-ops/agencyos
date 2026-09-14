"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { getTenantId } from "@/lib/auth";
import { encrypt } from "@/lib/encryption";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import {
  addressText,
  buildLocationAccountMap,
  fetchGbpAccounts,
  fetchGbpLocations,
  getFreshGbpTokenForProfile,
  getGbpSyncState,
  isSyncThrottled,
  listSnapshotReviews,
  markSyncOk,
  markSyncStarted,
  postReplyOnGoogle,
  syncGbpReviewsForPair,
  type GbpListingReviews,
} from "@/lib/gbp/client";
import {
  draftReviewReply,
  fetchBrandContext,
  type GbpReplyDraft,
} from "@/lib/gbp/drafting";

export interface GoogleBusinessProfile {
  id: string;
  tenant_id: string;
  client_id: string | null;
  account_name: string;
  account_email: string | null;
  location_id: string | null;
  location_name: string | null;
  connected: boolean;
  created_at: string;
}

export interface ActionResponse<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

export async function getProfiles(): Promise<ActionResponse<GoogleBusinessProfile[]>> {
  try {
    const tenantId = await getTenantId();
    const workspaceId = await getCurrentWorkspaceId().catch(() => null);
    const supabase = await createServiceClient();
    // Workspace-scoped listings plus legacy tenant-wide rows so pre-006
    // profiles keep showing for tenants that haven't reconnected yet.
    let query = supabase
      .from("google_business_profiles")
      .select("*, client:clients(name)")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });
    if (workspaceId) {
      query = query.or(`workspace_id.is.null,workspace_id.eq.${workspaceId}`);
    }
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return { success: true, data: data as GoogleBusinessProfile[] };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function connectProfile(
  accountName: string,
  clientId: string | null,
  locationId: string,
  accessToken: string
): Promise<ActionResponse<GoogleBusinessProfile>> {
  try {
    const tenantId = await getTenantId();
    const workspaceId = await getCurrentWorkspaceId().catch(() => null);
    const supabase = await createServiceClient();
    const encryptedToken = encrypt(accessToken);
    const { data, error } = await supabase
      .from("google_business_profiles")
      .insert({
        tenant_id: tenantId,
        workspace_id: workspaceId ?? null,
        client_id: clientId || null,
        account_name: accountName,
        location_id: locationId,
        encrypted_token: encryptedToken,
        connected: true,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    revalidatePath("/dashboard/settings/gbp");
    revalidatePath("/dashboard/connections");
    return { success: true, data: data as GoogleBusinessProfile };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function removeProfile(profileId: string): Promise<ActionResponse> {
  try {
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();
    const { error } = await supabase
      .from("google_business_profiles")
      .delete()
      .eq("id", profileId)
      .eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
    revalidatePath("/dashboard/settings/gbp");
    revalidatePath("/dashboard/connections");
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function getClientsForSelect(): Promise<ActionResponse<{ id: string; name: string }[]>> {
  try {
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();
    const { data, error } = await supabase
      .from("clients")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .order("name");
    if (error) throw new Error(error.message);
    return { success: true, data: data ?? [] };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}



export interface GbpOption {
  /** Google location resource name, e.g. "locations/12345" — the value to store. */
  location_id: string;
  /** Location title (the actual business name on Google). */
  name: string;
  /** Parent Google business account the location belongs to. */
  account: string;
  /** Formatted storefront address (may be empty). */
  address: string;
  /** Whether a row for this location is already connected in this workspace. */
  already_connected: boolean;
}

/** Thin session wrapper around the shared, worker-safe token helper. */
async function getFreshGbpToken(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  tenantId: string,
  workspaceId: string | null
): Promise<{ accessToken: string; storedToken: string } | { error: string }> {
  return getFreshGbpTokenForProfile(supabase, tenantId, workspaceId);
}

/**
 * List every business location the connected Google account can manage so the
 * UI can offer a picker. Read-only — nothing is stored until the user picks.
 */
export async function listGbpOptions(): Promise<ActionResponse<GbpOption[]>> {
  try {
    const tenantId = await getTenantId();
    const workspaceId = await getCurrentWorkspaceId().catch(() => null);
    const supabase = await createServiceClient();

    const token = await getFreshGbpToken(supabase, tenantId, workspaceId);
    if ("error" in token) return { success: false, error: token.error };
    const { accessToken } = token;

    // Which of these locations are already connected in this workspace?
    let existingQuery = supabase
      .from("google_business_profiles")
      .select("location_id")
      .eq("tenant_id", tenantId)
      .eq("connected", true);
    if (workspaceId) {
      existingQuery = existingQuery.or(`workspace_id.is.null,workspace_id.eq.${workspaceId}`);
    }
    const { data: existingRows } = await existingQuery;
    const existing = new Set(
      (existingRows ?? []).map((r) => r.location_id).filter(Boolean) as string[]
    );

    const accounts = await fetchGbpAccounts(accessToken);
    if (accounts.length === 0) {
      return { success: false, error: "No business accounts found for this Google account." };
    }

    const options: GbpOption[] = [];
    for (const account of accounts) {
      for (const location of await fetchGbpLocations(accessToken, account)) {
        options.push({
          location_id: location.name,
          name: location.title || account.accountName || "Business Profile",
          account: account.accountName || account.name.split("/").pop() || "Business account",
          address: addressText(location),
          already_connected: existing.has(location.name),
        });
      }
    }
    if (options.length === 0) {
      return { success: false, error: "No business listings found for the connected accounts." };
    }
    return { success: true, data: options };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Reviews (Lana — Reputation Manager)
//
// Snapshots live in `gbp_reviews` (kept fresh by the hourly Inngest sync), so
// the UI can render instantly, AI reply drafts survive re-syncs, and new
// reviews raise in-app notifications without anyone clicking Load reviews.
// ---------------------------------------------------------------------------

export type GbpProfileReviews = GbpListingReviews;

/**
 * Reviews for every connected listing, read straight from the local snapshots
 * (kept fresh by the hourly worker and manual syncs — no Google wait).
 */
export async function listGbpReviews(): Promise<ActionResponse<GbpProfileReviews[]>> {
  try {
    const tenantId = await getTenantId();
    const workspaceId = await getCurrentWorkspaceId().catch(() => null);
    const supabase = await createServiceClient();
    const listings = await listSnapshotReviews(supabase, tenantId, workspaceId);
    return { success: true, data: listings };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export interface GbpSyncStatus {
  lastSyncStarted: string | null;
  lastSyncOk: string | null;
  throttled: boolean;
}

/** Current sync state for the "last synced X ago / Sync now" UI. */
export async function getGbpSyncStatus(): Promise<ActionResponse<GbpSyncStatus>> {
  try {
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();
    const state = await getGbpSyncState(supabase, tenantId);
    return {
      success: true,
      data: {
        lastSyncStarted: state?.last_sync_started ?? null,
        lastSyncOk: state?.last_sync_ok ?? null,
        throttled: isSyncThrottled(state),
      },
    };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Manual "Sync now": runs the same snapshot sync as the hourly worker for
 * this tenant/workspace, with a per-tenant throttle so repeated clicks can't
 * hammer the Google quota.
 */
export async function syncGbpReviewsNow(): Promise<
  ActionResponse<{ listings: GbpProfileReviews[]; newReviews: number; throttled?: boolean }>
> {
  try {
    const tenantId = await getTenantId();
    const workspaceId = await getCurrentWorkspaceId().catch(() => null);
    const supabase = await createServiceClient();

    const state = await getGbpSyncState(supabase, tenantId);
    if (isSyncThrottled(state)) {
      const listings = await listSnapshotReviews(supabase, tenantId, workspaceId);
      return {
        success: true,
        data: { listings, newReviews: 0, throttled: true },
      };
    }

    await markSyncStarted(supabase, tenantId);
    const result = await syncGbpReviewsForPair(supabase, tenantId, workspaceId);
    if (!result.ok) {
      return { success: false, error: result.error };
    }
    await markSyncOk(supabase, tenantId);
    return {
      success: true,
      data: { listings: result.listings, newReviews: result.newReviews },
    };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ---------------------------------------------------------------------------
// AI reply drafting + posting (Lana)
// ---------------------------------------------------------------------------

export type { GbpReplyDraft } from "@/lib/gbp/drafting";

/**
 * Draft a public Google review reply with Lana's crisis-comms rules: never
 * admit liability, never argue, offer a private follow-up path, keep it under
 * 200 words, keep the workspace's brand voice when one exists. The draft is
 * only returned — it is posted to Google by replyToGbpReview, and stored in
 * gbp_reviews.reply_text so it survives re-syncs.
 */
export async function draftGbpReply(
  profileId: string,
  reviewId: string
): Promise<ActionResponse<GbpReplyDraft>> {
  try {
    const tenantId = await getTenantId();
    const workspaceId = await getCurrentWorkspaceId().catch(() => null);
    const supabase = await createServiceClient();

    // Tenant-scoped snapshot fetch — the ids arrive from the client, so both
    // the review and its parent listing must belong to this tenant.
    const { data: reviewRow } = await supabase
      .from("gbp_reviews")
      .select(
        "id, profile_id, star_rating, comment, reviewer_name, replied, reply_comment, profile:google_business_profiles(account_name)"
      )
      .eq("tenant_id", tenantId)
      .eq("profile_id", profileId)
      .eq("review_id", reviewId)
      .maybeSingle();
    const review = reviewRow as
      | {
          id: string;
          profile_id: string;
          star_rating: string;
          comment: string | null;
          reviewer_name: string | null;
          replied: boolean | null;
          reply_comment: string | null;
          profile: { account_name: string | null } | null;
        }
      | null;
    if (!review) {
      return { success: false, error: "Review not found in the local snapshot — refresh reviews and try again." };
    }
    if (review.replied) {
      return { success: false, error: "This review already has a public reply on Google." };
    }

    const brandContext = await fetchBrandContext(supabase, tenantId, workspaceId);
    const draft = await draftReviewReply(tenantId, {
      businessName: review.profile?.account_name ?? "our business",
      starRatingWord: review.star_rating,
      reviewerName: review.reviewer_name,
      comment: review.comment,
      brandContext,
    });

    // Persist the draft so it survives re-syncs (conflict-update set in the
    // sync worker never touches reply_text) and the user can come back to it.
    const { error: saveErr } = await supabase
      .from("gbp_reviews")
      .update({ reply_text: draft.response })
      .eq("tenant_id", tenantId)
      .eq("profile_id", profileId)
      .eq("review_id", reviewId);
    if (saveErr) throw new Error(saveErr.message);

    return { success: true, data: draft };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Post a reply to a Google review (uses the saved draft by default, or an
 * edited text). Marks the snapshot replied so the UI flips immediately.
 */
export async function replyToGbpReview(
  profileId: string,
  reviewId: string,
  comment?: string
): Promise<ActionResponse<{ posted: true }>> {
  try {
    const tenantId = await getTenantId();
    const workspaceId = await getCurrentWorkspaceId().catch(() => null);
    const supabase = await createServiceClient();

    const text = (comment ?? "").trim();
    if (!text) {
      return { success: false, error: "Write or generate a reply first." };
    }
    if (text.length > 4000) {
      return { success: false, error: "Reply is too long (Google allows up to 4000 characters)." };
    }

    // The review snapshot must belong to this tenant; the owning profile row
    // provides the workspace scope (used for the token lookup).
    const { data: reviewRow } = await supabase
      .from("gbp_reviews")
      .select(
        "id, replied, reply_comment, profile:google_business_profiles!inner(id, workspace_id)"
      )
      .eq("tenant_id", tenantId)
      .eq("profile_id", profileId)
      .eq("review_id", reviewId)
      .maybeSingle();
    const review = reviewRow as
      | {
          id: string;
          replied: boolean | null;
          reply_comment: string | null;
          profile: { id: string; workspace_id: string | null } | null;
        }
      | null;
    if (!review?.profile) {
      return { success: false, error: "Review not found in the local snapshot — refresh reviews and try again." };
    }
    if (review.replied) {
      return { success: false, error: "This review already has a public reply on Google — refresh reviews to see it." };
    }

    const token = await getFreshGbpTokenForProfile(
      supabase,
      tenantId,
      review.profile.workspace_id
    );
    if ("error" in token) return { success: false, error: token.error };

    // Resolve the listing's owning Google account for the v4 reply endpoint.
    const locationAccount = await buildLocationAccountMap(token.accessToken);
    const { data: profileRow } = await supabase
      .from("google_business_profiles")
      .select("location_id")
      .eq("tenant_id", tenantId)
      .eq("id", profileId)
      .maybeSingle();
    const locationId = (profileRow?.location_id as string | null) ?? null;
    const accountId = locationId ? locationAccount.get(locationId)?.split("/").pop() : undefined;
    const locSuffix = locationId?.split("/").pop();
    if (!accountId || !locSuffix) {
      return { success: false, error: "Listing not found on the connected Google accounts — re-run “Choose businesses” and try again." };
    }

    const posted = await postReplyOnGoogle(token.accessToken, accountId, locSuffix, reviewId, text);
    if (!posted.ok) return { success: false, error: posted.error };

    // Success — record Google's reply on the snapshot. reply_text is cleared
    // (the draft is now the live reply); the next sync confirms from Google.
    await supabase
      .from("gbp_reviews")
      .update({ replied: true, reply_comment: text, reply_text: null })
      .eq("tenant_id", tenantId)
      .eq("profile_id", profileId)
      .eq("review_id", reviewId);

    revalidatePath("/dashboard/settings/gbp");
    return { success: true, data: { posted: true } };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Discard a locally drafted reply without posting it (reputation reply
 * queue). Clears reply_text so the review leaves the drafts-waiting counts.
 */
export async function discardGbpReply(
  profileId: string,
  reviewId: string
): Promise<ActionResponse> {
  try {
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();
    const { error } = await supabase
      .from("gbp_reviews")
      .update({ reply_text: null })
      .eq("tenant_id", tenantId)
      .eq("profile_id", profileId)
      .eq("review_id", reviewId)
      .eq("replied", false);
    if (error) throw new Error(error.message);
    revalidatePath("/dashboard/reputation");
    revalidatePath("/dashboard/settings/gbp");
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Connect ONLY the businesses the user picked from the picker. Rows for the
 * selected locations are replaced (so re-picking refreshes them); every other
 * already-connected business is left untouched.
 */
export async function connectSelectedGbpProfiles(
  selected: { location_id: string; name: string; account: string; address: string }[]
): Promise<ActionResponse<GoogleBusinessProfile[]>> {
  try {
    if (!selected || selected.length === 0) {
      return { success: false, error: "Select at least one business to connect." };
    }
    const tenantId = await getTenantId();
    const workspaceId = await getCurrentWorkspaceId().catch(() => null);
    const supabase = await createServiceClient();

    const token = await getFreshGbpToken(supabase, tenantId, workspaceId);
    if ("error" in token) return { success: false, error: token.error };
    const { accessToken, storedToken } = token;

    // Resolve which Google account owns each selected location by listing
    // each account's locations once and matching on the resource name.
    const accounts = await fetchGbpAccounts(accessToken);
    const locationAccountEmail = new Map<string, string | null>();
    for (const account of accounts) {
      for (const location of await fetchGbpLocations(accessToken, account)) {
        locationAccountEmail.set(location.name, account.accountName ?? null);
      }
    }

    // Replace previously-connected rows for exactly these locations, leaving
    // other selections untouched. Tenant-scoped so the delete can never touch
    // another tenant's rows.
    for (const sel of selected) {
      const { error: delErr } = await supabase
        .from("google_business_profiles")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("location_id", sel.location_id);
      if (delErr) throw new Error(delErr.message);
    }

    const rows = selected.map((sel) => ({
      tenant_id: tenantId,
      workspace_id: workspaceId,
      account_name: sel.name || "Business Profile",
      account_email: locationAccountEmail.get(sel.location_id) ?? null,
      location_id: sel.location_id,
      location_name: sel.address,
      encrypted_token: storedToken,
      connected: true,
    }));
    // Rows are pre-bound to this tenant/workspace; the map re-affirms both
    // inline (kept on one chain so the isolation audit sees the scope).
    const { data: inserted, error: insErr } = await supabase
      .from("google_business_profiles")
      .insert(
        rows.map((r) => ({
          ...r,
          tenant_id: tenantId,
          workspace_id: workspaceId,
        }))
      )
      .select("*")
      .order("account_name", { ascending: true });
    if (insErr) throw new Error(insErr.message);

    revalidatePath("/dashboard/settings/gbp");
    revalidatePath("/dashboard/connections");
    return { success: true, data: (inserted ?? []) as GoogleBusinessProfile[] };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ============================================================================
// 1-star alert webhooks (gbp_alert_webhooks) — Slack/Discord/any-hook URLs
// that get an immediate push when a new low-star review lands.
// ============================================================================

export interface GbpAlertWebhook {
  id: string;
  label: string | null;
  /** Masked for display — webhook URLs double as posting secrets. */
  webhook_masked: string;
  min_stars: number | null;
  created_at: string;
}

export async function listAlertWebhooks(): Promise<ActionResponse<GbpAlertWebhook[]>> {
  try {
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();
    const { data, error } = await supabase
      .from("gbp_alert_webhooks")
      .select("id, label, webhook_url, min_stars, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const mask = (url: string): string => {
      try {
        const u = new URL(url);
        const path = u.pathname.replace(/\/$/, "");
        return `${u.protocol}//${u.host}/…${path.slice(-6)}`;
      } catch {
        return "invalid webhook URL";
      }
    };
    return {
      success: true,
      data: ((data ?? []) as { id: string; label: string | null; webhook_url: string; min_stars: number | null; created_at: string }[]).map((r) => ({
        id: r.id,
        label: r.label,
        webhook_masked: mask(r.webhook_url),
        min_stars: r.min_stars,
        created_at: r.created_at,
      })),
    };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function addAlertWebhook(
  url: string,
  label: string,
  minStars: number
): Promise<ActionResponse<GbpAlertWebhook>> {
  try {
    const trimmed = url.trim();
    // Slack, Discord, and any Slack-compatible hook — the only hard rule is
    // https (never send secrets/alerts over plain http).
    if (!trimmed.startsWith("https://")) {
      return { success: false, error: "Webhook URLs must use https:// (Slack, Discord, or a compatible hook)." };
    }
    const tenantId = await getTenantId();
    const workspaceId = await getCurrentWorkspaceId().catch(() => null);
    const supabase = await createServiceClient();
    const minStarsClamped = Math.min(5, Math.max(1, Math.round(minStars)));
    const { data, error } = await supabase
      .from("gbp_alert_webhooks")
      .upsert(
        {
          tenant_id: tenantId,
          workspace_id: workspaceId,
          label: label.trim() || null,
          webhook_url: trimmed,
          min_stars: minStarsClamped,
        },
        { onConflict: "tenant_id,webhook_url" }
      )
      .select("id, label, webhook_url, min_stars, created_at")
      .single();
    if (error) throw new Error(error.message);
    const row = data as { id: string; label: string | null; webhook_url: string; min_stars: number | null; created_at: string } | null;
    const mask = (u: string): string => {
      try {
        const parsed = new URL(u);
        const p = parsed.pathname.replace(/\/$/, "");
        return `${parsed.protocol}//${parsed.host}/…${p.slice(-6)}`;
      } catch {
        return "invalid webhook URL";
      }
    };
    return {
      success: true,
      data: {
        id: row!.id,
        label: row!.label,
        webhook_masked: mask(row!.webhook_url),
        min_stars: row!.min_stars,
        created_at: row!.created_at,
      },
    };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function removeAlertWebhook(id: string): Promise<ActionResponse> {
  try {
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();
    const { error } = await supabase
      .from("gbp_alert_webhooks")
      .delete()
      .eq("id", id)
      .eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Fire a test alert at ONE webhook URL so the user can confirm it lands
 * before saving. Posts directly to the URL — nothing is read from or written
 * to the webhooks table.
 */
export async function testAlertWebhook(
  url: string
): Promise<ActionResponse<{ sent: number; failed: number }>> {
  try {
    const trimmed = url.trim();
    if (!trimmed.startsWith("https://")) {
      return { success: false, error: "Enter an https:// webhook URL first." };
    }
    const { buildAlertPayload } = await import("@/lib/gbp/alerts");
    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
    const res = await fetch(trimmed, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        buildAlertPayload(
          trimmed,
          {
            tenantId: "",
            businessName: "Test — no business affected",
            reviewerName: "Alert webhook test",
            starRating: "ONE",
            comment:
              "This is a test of your 1-star review alerts. If you can read this, reputation alerts are wired up correctly.",
            createTime: new Date().toISOString(),
          },
          siteUrl
        )
      ),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 150);
      return { success: false, error: `Webhook responded ${res.status}${detail ? `: ${detail}` : ""}` };
    }
    return { success: true, data: { sent: 1, failed: 0 } };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
