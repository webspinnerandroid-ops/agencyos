import { inngest } from "@/lib/inngest/client";
import { createServiceClient } from "@/lib/supabase/server";
import { regenerateBlogPost } from "@/lib/ai/team-task";
import { createNotification } from "@/lib/in-app-notifications";

/**
 * AI Team — auto-rewrite a below-threshold blog post (background).
 *
 * Fired by the publish gate when a blog's combined SEO/AEO-GEO score is below
 * the publish minimum. Runs Cheryl's real generation pipeline and overwrites
 * the post in place (status preserved, images included). The publish attempt
 * that triggered it already returned `score_gate` with `autoRewriting: true`,
 * so the UI can tell the user the rewrite is in flight; they retry publishing
 * once it lands.
 */
export const autoRewritePost = inngest.createFunction(
  {
    id: "content-auto-rewrite-post",
    name: "Auto-Rewrite Below-Threshold Post",
    retries: 2,
    triggers: [
      {
        event: "content/auto-rewrite",
      },
    ],
  },
  async ({ event }) => {
    const { postId, tenantId } = event.data as {
      postId: string;
      tenantId: string;
    };

    if (!postId || !tenantId) {
      console.error("[autoRewritePost] Malformed payload:", event.data);
      return { status: "rejected", reason: "malformed payload" };
    }

    const supabase = await createServiceClient();
    const { data: post } = await supabase
      .from("posts")
      .select("workspace_id")
      .eq("id", postId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    // Progress ping so the owner knows the background rewrite is running.
    void createNotification({
      tenantId,
      kind: "progress",
      title: "Rewriting your post…",
      body: "A post scored below the publish threshold, so Cheryl is regenerating it in the background. You can retry publishing once it lands.",
      link: `/dashboard/posts?post=${postId}`,
    });

    const result = await regenerateBlogPost(
      tenantId,
      postId,
      post?.workspace_id ?? null
    );

    console.log(
      `[autoRewritePost] Rewrote post ${postId} (${result.title}) for tenant ${tenantId}`
    );
    void createNotification({
      tenantId,
      kind: "info",
      title: "Post rewritten",
      body: `"${result.title}" was regenerated and is ready for you to review and publish.`,
      link: `/dashboard/posts?post=${postId}`,
    });
    return { status: "completed", postId, title: result.title };
  }
);
