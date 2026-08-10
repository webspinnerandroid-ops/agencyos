import { inngest } from "@/lib/inngest/client";
import { createClient } from "@supabase/supabase-js";

// ------------------------------------------------------------------
// Service client for background jobs (no cookies / no request context)
// ------------------------------------------------------------------

function createServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// ------------------------------------------------------------------
// Mock Analytics API — returns random sample data for a given post.
// Replace with real Facebook / Instagram Insights integration later.
// ------------------------------------------------------------------

interface MockAnalytics {
  likes: number;
  comments: number;
  shares: number;
  impressions: number;
  reach: number;
}

function fetchMockAnalytics(postId: string): MockAnalytics {
  // Deterministic-ish random based on post id so repeated calls vary
  const seed = postId.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const rng = (min: number, max: number, offset = 0) =>
    Math.floor(((seed * 16807 + offset) % 2147483647) / 2147483647) *
      (max - min) +
    min;

  return {
    likes: rng(5, 500, 1),
    comments: rng(0, 80, 2),
    shares: rng(0, 120, 3),
    impressions: rng(100, 8000, 4),
    reach: rng(50, 5000, 5),
  };
}

// ------------------------------------------------------------------
// Inngest function — fetch analytics every 6 hours
// ------------------------------------------------------------------

export const fetchAnalytics = inngest.createFunction(
  {
    id: "fetch-analytics",
    name: "Fetch Post Analytics",
    triggers: [
      {
        // Cron schedule: every 6 hours
        cron: "0 */6 * * *",
      },
    ],
  },
  async ({ step }) => {
    const supabase = createServiceSupabase();

    // ----------------------------------------------------------------
    // Step 1: Fetch all tenants
    // ----------------------------------------------------------------
    const tenants = await step.run("fetch-tenants", async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("id, name");

      if (error) {
        console.error("[fetchAnalytics] Failed to fetch tenants:", error);
        return [];
      }

      return data ?? [];
    });

    if (tenants.length === 0) {
      return { message: "No tenants found", count: 0 };
    }

    console.log(
      `[fetchAnalytics] Processing ${tenants.length} tenant(s)`
    );

    // ----------------------------------------------------------------
    // Step 2: For each tenant, fetch published posts in last 30 days
    // ----------------------------------------------------------------
    const results: Array<{
      tenantId: string;
      tenantName: string;
      postsProcessed: number;
      snapshotsCreated: number;
      error?: string;
    }> = [];

    for (const tenant of tenants) {
      const outcome = await step.run(
        `process-tenant-${tenant.id}`,
        async () => {
          try {
            const thirtyDaysAgo = new Date(
              Date.now() - 30 * 24 * 60 * 60 * 1000
            ).toISOString();

            // Fetch published posts for this tenant within the last 30 days.
            // The `scheduled_at` column is used as a proxy for publish date;
            // adjust if you add a dedicated `published_at` column later.
            const { data: posts, error: postsError } = await supabase
              .from("posts")
              .select("id, content, client_id, post_platforms(id, social_accounts(platform))")
              .eq("tenant_id", tenant.id)
              .eq("status", "published")
              .gte("scheduled_at", thirtyDaysAgo);

            if (postsError) {
              console.error(
                `[fetchAnalytics] Failed to fetch posts for tenant ${tenant.id}:`,
                postsError
              );
              return {
                tenantId: tenant.id,
                tenantName: tenant.name,
                postsProcessed: 0,
                snapshotsCreated: 0,
                error: postsError.message,
              };
            }

            if (!posts || posts.length === 0) {
              return {
                tenantId: tenant.id,
                tenantName: tenant.name,
                postsProcessed: 0,
                snapshotsCreated: 0,
              };
            }

            // ----------------------------------------------------------------
            // Step 2a: For each post, fetch mock analytics & insert snapshots
            // ----------------------------------------------------------------
            let snapshotsCreated = 0;
            const now = new Date().toISOString();

            for (const post of posts) {
              // Determine platform from post_platforms (default to "unknown")
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

              const platformList =
                platforms.length > 0 ? platforms : ["unknown"];

              for (const platform of platformList) {
                const metrics = fetchMockAnalytics(post.id);

                const { error: insertError } = await supabase
                  .from("analytics_snapshots")
                  .insert({
                    post_id: post.id,
                    platform,
                    likes: metrics.likes,
                    comments: metrics.comments,
                    shares: metrics.shares,
                    impressions: metrics.impressions,
                    reach: metrics.reach,
                    fetched_at: now,
                  });

                if (insertError) {
                  console.error(
                    `[fetchAnalytics] Failed to insert snapshot for post ${post.id} on ${platform}:`,
                    insertError
                  );
                } else {
                  snapshotsCreated++;
                }
              }
            }

            return {
              tenantId: tenant.id,
              tenantName: tenant.name,
              postsProcessed: posts.length,
              snapshotsCreated,
            };
          } catch (err) {
            const message =
              err instanceof Error ? err.message : "Unknown error";
            console.error(
              `[fetchAnalytics] Exception processing tenant ${tenant.id}:`,
              err
            );
            return {
              tenantId: tenant.id,
              tenantName: tenant.name,
              postsProcessed: 0,
              snapshotsCreated: 0,
              error: message,
            };
          }
        }
      );

      results.push(outcome);
    }

    const totalPosts = results.reduce(
      (sum, r) => sum + r.postsProcessed,
      0
    );
    const totalSnapshots = results.reduce(
      (sum, r) => sum + r.snapshotsCreated,
      0
    );
    const errors = results.filter((r) => r.error);

    return {
      message: `Processed ${totalPosts} post(s) across ${tenants.length} tenant(s), created ${totalSnapshots} snapshot(s)${
        errors.length > 0
          ? `, ${errors.length} tenant(s) had errors`
          : ""
      }`,
      count: totalPosts,
      snapshotCount: totalSnapshots,
      tenants: results,
    };
  }
);