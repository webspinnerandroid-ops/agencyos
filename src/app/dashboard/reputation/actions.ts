"use server";

import { createServiceClient } from "@/lib/supabase/server";
import { getTenantId } from "@/lib/auth";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import { buildSparkline } from "@/lib/gbp/sparkline";

export interface ActionResponse<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface ReplyQueueItem {
  profileId: string;
  businessName: string;
  reviewId: string;
  starRating: string;
  reviewerName: string | null;
  comment: string | null;
  createTime: string | null;
  /** Lana's draft, waiting for approval or edits. */
  draft: string;
  /** Notes that arrived by replying to the digest email. */
  notes: string[];
}

export interface ReputationListing {
  profileId: string;
  businessName: string;
  /** Google's cached overall rating for the listing (from the last sync). */
  averageRating: number | null;
  /** Google's cached total review count (can exceed the stored window). */
  totalReviewCount: number | null;
  /** Reviews stored in gbp_reviews (latest snapshot window). */
  storedReviews: number;
  unanswered: number;
  draftsWaiting: number;
  /** Rating trend over time: counts of 1..5-star reviews in the snapshot. */
  starHistogram: number[];
  lastReviewAt: string | null;
  /** Weekly average rating, last 12 weeks (oldest first; null = no reviews that week). */
  sparkline: { week: string; avg: number | null; count: number }[];
  /** Count of digest-reply notes attached to this listing's reviews. */
  notesCount: number;
}

export interface ReputationOverview {
  listings: ReputationListing[];
  totalReviews: number;
  totalUnanswered: number;
  totalDraftsWaiting: number;
  /** Reviews per month for the last 6 months (oldest first), all listings. */
  monthly: { month: string; count: number; avgRating: number | null }[];
  /** Overall star histogram across all listings. */
  starHistogram: number[];
  weightedRating: number | null;
  /** Unanswered reviews with a Lana draft, oldest first (reply queue). */
  replyQueue: ReplyQueueItem[];
  /** Reviews carrying notes from digest email replies, newest review first. */
  digestNotes: { reviewId: string; businessName: string; reviewerName: string | null; notes: string[] }[];
  /** True when the local window looks truncated (older than ~50 reviews/listing). */
  windowTruncated: boolean;
}

interface RawProfile {
  id: string;
  account_name: string | null;
  average_rating: number | null;
  total_review_count: number | null;
}

interface RawReview {
  profile_id: string;
  review_id: string;
  star_rating: string;
  comment: string | null;
  reviewer_name: string | null;
  create_time: string | null;
  replied: boolean | null;
  reply_text: string | null;
  internal_notes: string[] | null;
}

const STAR_INDEX: Record<string, number> = { ONE: 0, TWO: 1, THREE: 2, FOUR: 3, FIVE: 4 };

function starBucket(word: string): number {
  return STAR_INDEX[word] ?? 0; // unknown -> treated as 1★ for the histogram
}

function monthKey(iso: string): string {
  return iso.slice(0, 7); // YYYY-MM
}

function lastMonthKeys(n: number): string[] {
  const keys: string[] = [];
  const d = new Date();
  d.setUTCDate(1);
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(d);
    m.setUTCMonth(m.getUTCMonth() - i);
    keys.push(m.toISOString().slice(0, 7));
  }
  return keys;
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  return `${MONTH_LABELS[Number(m) - 1] ?? m} ${y.slice(2)}`;
}



/**
 * Aggregate reputation metrics for every connected Business Profile listing in
 * this tenant/workspace. Everything is read from the local gbp_reviews
 * snapshots (kept fresh by the hourly sync) — this page never waits on Google.
 */
export async function getReputationOverview(): Promise<ActionResponse<ReputationOverview>> {
  try {
    const tenantId = await getTenantId();
    const workspaceId = await getCurrentWorkspaceId().catch(() => null);
    const supabase = await createServiceClient();

    let rowsQuery = supabase
      .from("google_business_profiles")
      .select("id, account_name, average_rating, total_review_count")
      .eq("tenant_id", tenantId)
      .eq("connected", true);
    if (workspaceId) {
      rowsQuery = rowsQuery.or(`workspace_id.is.null,workspace_id.eq.${workspaceId}`);
    }
    const { data: profileRows, error: profErr } = await rowsQuery;
    if (profErr) throw new Error(profErr.message);
    const profiles = ((profileRows ?? []) as RawProfile[]).filter((p) => p.id);
    if (profiles.length === 0) {
      return { success: true, data: emptyOverview() };
    }

    const { data: reviewRows, error: revErr } = await supabase
      .from("gbp_reviews")
      .select("profile_id, star_rating, create_time, replied, reply_text, review_id, comment, reviewer_name, internal_notes")
      .eq("tenant_id", tenantId)
      .in("profile_id", profiles.map((p) => p.id))
      .order("create_time", { ascending: false, nullsFirst: false })
      .limit(2000);
    if (revErr) throw new Error(revErr.message);
    const reviews = (reviewRows ?? []) as RawReview[];

    return {
      success: true,
      data: buildOverview(profiles, reviews),
    };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

function emptyOverview(): ReputationOverview {
  return {
    listings: [],
    totalReviews: 0,
    totalUnanswered: 0,
    totalDraftsWaiting: 0,
    monthly: [],
    starHistogram: [0, 0, 0, 0, 0],
    weightedRating: null,
    windowTruncated: false,
    replyQueue: [],
    digestNotes: [],
  };
}

function buildOverview(
  profiles: RawProfile[],
  reviews: RawReview[]
): ReputationOverview {
  const reviewsByProfile = new Map<string, RawReview[]>();
  for (const r of reviews) {
    const list = reviewsByProfile.get(r.profile_id);
    if (list) list.push(r);
    else reviewsByProfile.set(r.profile_id, [r]);
  }

  const listings: ReputationListing[] = profiles.map((p) => {
    const rows = reviewsByProfile.get(p.id) ?? [];
    const histogram = [0, 0, 0, 0, 0];
    for (const r of rows) histogram[starBucket(r.star_rating)] += 1;
    return {
      profileId: p.id,
      businessName: p.account_name ?? "Business Profile",
      averageRating: p.average_rating,
      totalReviewCount: p.total_review_count,
      storedReviews: rows.length,
      unanswered: rows.filter((r) => !r.replied).length,
      draftsWaiting: rows.filter((r) => !r.replied && !!r.reply_text).length,
      starHistogram: histogram,
      lastReviewAt: rows[0]?.create_time ?? null,
      sparkline: buildSparkline(rows, (w) => starBucket(w) + 1),
      notesCount: rows.reduce((s, r) => s + (r.internal_notes?.length ?? 0), 0),
    };
  });

  const monthlyKeys = lastMonthKeys(6);
  const monthlyBuckets = new Map<string, { count: number; stars: number; rated: number }>();
  for (const key of monthlyKeys) monthlyBuckets.set(key, { count: 0, stars: 0, rated: 0 });
  for (const r of reviews) {
    if (!r.create_time) continue;
    const bucket = monthlyBuckets.get(monthKey(r.create_time));
    if (!bucket) continue;
    const stars = starBucket(r.star_rating) + 1;
    bucket.count += 1;
    if (stars > 0) {
      bucket.stars += stars;
      bucket.rated += 1;
    }
  }
  const monthly = monthlyKeys.map((key) => {
    const b = monthlyBuckets.get(key)!;
    return {
      month: monthLabel(key),
      count: b.count,
      avgRating: b.rated > 0 ? Math.round((b.stars / b.rated) * 10) / 10 : null,
    };
  });

  const starHistogram = [0, 0, 0, 0, 0];
  let starSum = 0;
  for (const r of reviews) {
    starHistogram[starBucket(r.star_rating)] += 1;
    starSum += starBucket(r.star_rating) + 1;
  }

  // The sync stores the latest 50 reviews per listing; if any listing stores
  // that many, older reviews are missing and the monthly chart under-counts.
  const windowTruncated = listings.some((l) => l.storedReviews >= 50);

  // Reply queue: unanswered reviews with a waiting draft, oldest first so the
  // angriest customer waits the least. Posted replies are excluded.
  const byBusiness = new Map(profiles.map((p) => [p.id, p.account_name ?? "Business Profile"]));
  const replyQueue: ReplyQueueItem[] = reviews
    .filter((r) => !r.replied && !!r.reply_text)
    .sort((a, b) => (a.create_time ?? "").localeCompare(b.create_time ?? ""))
    .slice(0, 25)
    .map((r) => ({
      profileId: r.profile_id,
      businessName: byBusiness.get(r.profile_id) ?? "Business Profile",
      reviewId: r.review_id,
      starRating: r.star_rating,
      reviewerName: r.reviewer_name,
      comment: r.comment,
      createTime: r.create_time,
      draft: r.reply_text!,
      notes: r.internal_notes ?? [],
    }));

  return {
    listings,
    totalReviews: reviews.length,
    totalUnanswered: listings.reduce((s, l) => s + l.unanswered, 0),
    totalDraftsWaiting: listings.reduce((s, l) => s + l.draftsWaiting, 0),
    monthly,
    starHistogram,
    weightedRating:
      reviews.length > 0 ? Math.round((starSum / reviews.length) * 10) / 10 : null,
    windowTruncated,
    replyQueue,
    digestNotes: reviews
      .filter((r) => (r.internal_notes?.length ?? 0) > 0)
      .slice(0, 10)
      .map((r) => ({
        reviewId: r.review_id,
        businessName: byBusiness.get(r.profile_id) ?? "Business Profile",
        reviewerName: r.reviewer_name,
        notes: r.internal_notes ?? [],
      })),
  };
}
