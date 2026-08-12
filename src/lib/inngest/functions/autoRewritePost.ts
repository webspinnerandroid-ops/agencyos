import { inngest } from "@/lib/inngest/client";
import { createServiceClient } from "@/lib/supabase/server";
import { regenerateBlogPost } from "@/lib/ai/team-task";

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

    const result = await regenerateBlogPost(
      tenantId,
      postId,
      post?.workspace_id ?? null
    );

    console.log(
      `[autoRewritePost] Rewrote post ${postId} (${result.title}) for tenant ${tenantId}`
    );
    return { status: "completed", postId, title: result.title };
  }
);
