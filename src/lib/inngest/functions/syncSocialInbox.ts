import { inngest } from "@/lib/inngest/client";
import { syncSocialComments } from "@/lib/inbox/echo";
import { createClient } from "@supabase/supabase-js";

function createServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export const syncSocialInbox = inngest.createFunction(
  {
    id: "sync-social-inbox",
    name: "Sync Social Inbox",
    retries: 2,
    triggers: [
      {
        cron: "*/15 * * * *",
      },
    ],
  },
  async ({ step }) => {
    const supabase = createServiceSupabase();

    // Fetch recent published posts (last 30 days) with social accounts
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

    const { data: posts, error } = await supabase
      .from("posts")
      .select(
        `
        id,
        tenant_id,
        post_platforms (
          social_accounts ( platform )
        )
      `
      )
      .eq("status", "published")
      .gte("scheduled_at", thirtyDaysAgo)
      .not("post_platforms", "is", null);

    if (error) {
      console.error("[syncSocialInbox] Failed to fetch posts:", error);
      return { status: "error", message: error.message };
    }

    if (!posts || posts.length === 0) {
      return { status: "skipped", message: "No published posts with social accounts" };
    }

    const results: Array<{ postId: string; platforms: string[]; synced: number; error?: string }> = [];

    for (const post of posts) {
      const pp = (post.post_platforms as any[])?.[0];
      if (!pp?.social_accounts?.platform) continue;

      const result = await step.run(
        `sync-comments-${post.id}`,
        async () => {
          try {
            const syncResults = await syncSocialComments(post.tenant_id, post.id);
            const totalSynced = syncResults.reduce((sum: number, r: any) => sum + r.commentsImported, 0);
            const platforms: string[] = syncResults.map((r: any) => r.platform);
            return {
              postId: post.id as string,
              platforms,
              synced: totalSynced,
            };
          } catch (err: any) {
            console.error(`[syncSocialInbox] Error syncing post ${post.id}:`, err.message);
            return {
              postId: post.id as string,
              platforms: [] as string[],
              synced: 0,
              error: err.message,
            };
          }
        }
      );

      results.push(result);
    }

    const totalComments = results.reduce((sum: number, r: any) => sum + r.synced, 0);

    return {
      status: "completed",
      postsProcessed: results.length,
      totalCommentsSynced: totalComments,
      results,
    };
  }
);