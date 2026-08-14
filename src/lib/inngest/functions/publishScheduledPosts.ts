import { inngest } from "@/lib/inngest/client";
import { publishPost } from "@/lib/publishing/socialPublisher";
import { createClient } from "@supabase/supabase-js";
import { submitPostToIndexNow } from "@/lib/seo/indexnow";
import { createNotification } from "@/lib/in-app-notifications";

// ------------------------------------------------------------------
// Service client for background jobs (no cookies / no request context)
// ------------------------------------------------------------------

function createServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/** Best-effort title from a post's JSONB `content` column. */
function postTitle(content: unknown): string {
  if (content && typeof content === "object") {
    const c = content as Record<string, unknown>;
    if (typeof c.title === "string" && c.title) return c.title;
  }
  if (typeof content === "string") {
    try {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      if (typeof parsed.title === "string" && parsed.title) return parsed.title;
    } catch {
      // not JSON — fall through
    }
  }
  return "Scheduled post";
}

// ------------------------------------------------------------------
// Inngest function — publish scheduled posts
// ------------------------------------------------------------------

export const publishScheduledPosts = inngest.createFunction(
  {
    id: "publish-scheduled-posts",
    name: "Publish Scheduled Posts",
    triggers: [
      {
        // Cron schedule: every 5 minutes
        cron: "*/5 * * * *",
      },
    ],
  },
  async ({ step }) => {
    const supabase = createServiceSupabase();

    // ----------------------------------------------------------------
    // Step 1: Fetch all scheduled posts that are due (AT the tenant level)
    // ----------------------------------------------------------------
    const posts = await step.run("fetch-due-posts", async () => {
      const now = new Date().toISOString();

      const { data, error } = await supabase
        .from("posts")
        .select("id, tenant_id")
        .eq("status", "scheduled")
        .lte("scheduled_at", now);

      if (error) {
        console.error("[publishScheduledPosts] Failed to fetch due posts:", error);
        return [];
      }

      return data ?? [];
    });

    if (posts.length === 0) {
      return { message: "No posts due for publishing", count: 0 };
    }

    console.log(
      `[publishScheduledPosts] Found ${posts.length} due post(s) to publish`
    );

    // ----------------------------------------------------------------
    // Step 2: Publish each post (tenant-scoped). Post status updates
    //         and publishing_logs are handled inside publishPost().
    // ----------------------------------------------------------------
    const results: Array<{
      postId: string;
      tenantId: string;
      allSucceeded: boolean;
      error?: string;
    }> = [];

    for (const post of posts) {
      const outcome = await step.run(
        `publish-post-${post.id}`,
        async () => {
          try {
            const { data: titleRow } = await supabase
              .from("posts")
              .select("content")
              .eq("id", post.id)
              .single();
            const title = postTitle(titleRow?.content);

            // In-progress ping: the scheduled publish the AI team set up is
            // starting now. Publishing to the connected platforms can take a
            // while, so the bell shows it running before the result lands.
            void createNotification({
              tenantId: post.tenant_id,
              kind: "progress",
              title: "Publishing scheduled post…",
              body: `"${title}" is going live on the connected platforms.`,
              link: `/dashboard/posts?post=${post.id}`,
            });

            const { allSucceeded, results: platformResults } =
              await publishPost(post.id, post.tenant_id);

            // Update the post-level status based on platform outcomes
            if (allSucceeded) {
              await supabase
                .from("posts")
                .update({ status: "published" })
                .eq("id", post.id)
                .eq("tenant_id", post.tenant_id);

              // Ping the bell: the scheduled publish the AI team set up is live.
              void createNotification({
                tenantId: post.tenant_id,
                kind: "info",
                title: "Post published",
                body: `"${title}" went live on the connected platforms.`,
                link: `/dashboard/posts?post=${post.id}`,
              });

              // Auto-indexer: fire-and-forget IndexNow + sitemap ping.
              // Resolve the tenant's site URL for a correct canonical URL.
              const { data: blogPlatform } = await supabase
                .from("blog_platforms")
                .select("site_url")
                .eq("tenant_id", post.tenant_id)
                .limit(1)
                .maybeSingle();
              const { data: publishedPost } = await supabase
                .from("posts")
                .select("content, client_id")
                .eq("id", post.id)
                .single();
              let siteUrl = blogPlatform?.site_url ?? null;
              if (!siteUrl && publishedPost?.client_id) {
                const { data: client } = await supabase
                  .from("clients")
                  .select("website")
                  .eq("id", publishedPost.client_id)
                  .eq("tenant_id", post.tenant_id)
                  .maybeSingle();
                siteUrl = client?.website ?? null;
              }
              void submitPostToIndexNow({
                tenantId: post.tenant_id,
                siteUrl,
                content: publishedPost?.content,
              }).then((r) => {
                if (r.ok) {
                  console.log(`[indexnow] Submitted ${r.urls.join(", ")}`);
                } else if (r.error) {
                  console.warn(`[indexnow] Skipped: ${r.error}`);
                }
              });
            } else {
              // At least one platform failed — set post status to 'failed'
              const errorMessages = platformResults
                .filter((r) => !r.success)
                .map((r) => `${r.platform}: ${r.errorMessage ?? "unknown"}`)
                .join("; ");

              await supabase
                .from("posts")
                .update({
                  status: "failed",
                  // Optionally store error in a dedicated column if one exists
                })
                .eq("id", post.id)
                .eq("tenant_id", post.tenant_id);

              console.error(
                `[publishScheduledPosts] Post ${post.id} partially failed: ${errorMessages}`
              );

              void createNotification({
                tenantId: post.tenant_id,
                kind: "alert",
                title: "Post failed to publish",
                body: `"${title}" hit an error: ${errorMessages}`,
                link: `/dashboard/posts?post=${post.id}`,
              });
            }

            return {
              postId: post.id,
              tenantId: post.tenant_id,
              allSucceeded,
            };
          } catch (err) {
            const message =
              err instanceof Error ? err.message : "Unknown error";

            // Mark post as failed
            await supabase
              .from("posts")
              .update({ status: "failed" })
              .eq("id", post.id)
              .eq("tenant_id", post.tenant_id);

            console.error(
              `[publishScheduledPosts] Exception publishing post ${post.id}:`,
              err
            );

            void createNotification({
              tenantId: post.tenant_id,
              kind: "alert",
              title: "Post failed to publish",
              body: message,
              link: `/dashboard/posts?post=${post.id}`,
            });

            return {
              postId: post.id,
              tenantId: post.tenant_id,
              allSucceeded: false,
              error: message,
            };
          }
        }
      );

      results.push(outcome);
    }

    const succeeded = results.filter((r) => r.allSucceeded).length;
    const failed = results.filter((r) => !r.allSucceeded).length;

    return {
      message: `Published ${succeeded} post(s), ${failed} failed`,
      count: posts.length,
      succeeded,
      failed,
      results,
    };
  }
);