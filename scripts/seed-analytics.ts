/**
 * Seed script: Populate analytics_snapshots with dummy data for testing.
 *
 * Usage:
 *   Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY as env vars, then run:
 *   npx tsx scripts/seed-analytics.ts
 *
 * This script:
 *   1. Fetches all published posts across all tenants
 *   2. For each post, generates random analytics snapshots for the
 *      past 7 days (one per day per platform)
 *   3. Inserts them into analytics_snapshots
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ------------------------------------------------------------------
// Mock analytics — deterministic random per post + day offset
// ------------------------------------------------------------------

interface MockMetrics {
  likes: number;
  comments: number;
  shares: number;
  impressions: number;
  reach: number;
}

function mockAnalytics(postId: string, dayOffset: number): MockMetrics {
  const seed =
    postId.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) +
    dayOffset * 7;
  const rng = (min: number, max: number, offset = 0) =>
    Math.floor(
      ((((seed * 16807 + offset) % 2147483647) / 2147483647) * (max - min) + min)
    );

  return {
    likes: rng(5, 500, 1),
    comments: rng(0, 80, 2),
    shares: rng(0, 120, 3),
    impressions: rng(100, 8000, 4),
    reach: rng(50, 5000, 5),
  };
}

// ------------------------------------------------------------------
// Main
// ------------------------------------------------------------------

async function seed() {
  console.log("🌱 Seeding analytics snapshots...\n");

  // 1. Fetch all published posts
  const { data: posts, error: postsError } = await supabase
    .from("posts")
    .select(
      "id, tenant_id, content, scheduled_at, post_platforms(id, social_accounts(platform))"
    )
    .eq("status", "published");

  if (postsError) {
    console.error("❌ Failed to fetch posts:", postsError);
    return;
  }

  if (!posts || posts.length === 0) {
    console.log("⚠️  No published posts found. Seed some posts first.");
    return;
  }

  console.log(`Found ${posts.length} published post(s)\n`);

  let totalSnapshots = 0;

  // 2. For each post, generate snapshots for the past 7 days
  for (const post of posts) {
    // Determine platforms for this post
    const platforms: string[] = [];
    if (post.post_platforms && Array.isArray(post.post_platforms)) {
      for (const pp of post.post_platforms as unknown as Array<{
        social_accounts: { platform: string } | null;
      }>) {
        if (pp.social_accounts?.platform) {
          platforms.push(pp.social_accounts.platform);
        }
      }
    }
    const platformList = platforms.length > 0 ? platforms : ["instagram"];

    const snapshots: Array<{
      post_id: string;
      platform: string;
      likes: number;
      comments: number;
      shares: number;
      impressions: number;
      reach: number;
      fetched_at: string;
    }> = [];

    for (let day = 0; day < 7; day++) {
      const fetchedAt = new Date(Date.now() - day * 24 * 60 * 60 * 1000).toISOString();
      for (const platform of platformList) {
        const metrics = mockAnalytics(post.id, day);
        snapshots.push({
          post_id: post.id,
          platform,
          likes: metrics.likes,
          comments: metrics.comments,
          shares: metrics.shares,
          impressions: metrics.impressions,
          reach: metrics.reach,
          fetched_at: fetchedAt,
        });
      }
    }

    // 3. Insert into analytics_snapshots
    const { error: insertError } = await supabase
      .from("analytics_snapshots")
      .insert(snapshots);

    if (insertError) {
      console.error(
        `❌ Failed to insert snapshots for post ${post.id}:`,
        insertError
      );
    } else {
      totalSnapshots += snapshots.length;
      const contentPreview = (post.content ?? "").slice(0, 50);
      console.log(
        `✅ Post ${
          post.id
        }: ${snapshots.length} snapshot(s) — "${contentPreview}…"`
      );
    }
  }

  console.log(`\n🎉 Done! Created ${totalSnapshots} total snapshot(s).`);
}

seed().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});