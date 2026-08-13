import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { publishScheduledPosts } from "@/lib/inngest/functions/publishScheduledPosts";
import { monthlyBillingReset } from "@/lib/inngest/functions/monthlyBillingReset";
import { syncInboxes } from "@/lib/inngest/functions/syncInboxes";
import { syncSocialInbox } from "@/lib/inngest/functions/syncSocialInbox";
import { processSequences } from "@/lib/inngest/functions/processSequences";
import { teamChatTask } from "@/lib/inngest/functions/teamChatTask";
import { weeklyOpportunityScan } from "@/lib/inngest/functions/weeklyOpportunityScan";
import { autoRewritePost } from "@/lib/inngest/functions/autoRewritePost";
import { syncSiteMetrics } from "@/lib/inngest/functions/syncSiteMetrics";

/**
 * Inngest API handler — serves all registered functions.
 *
 * The /api/inngest endpoint is called by the Inngest platform (or the
 * local dev server) to discover and invoke functions.
 *
 * It is excluded from auth middleware via PUBLIC_ROUTES.
 */
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [publishScheduledPosts, monthlyBillingReset, syncInboxes, syncSocialInbox, processSequences, teamChatTask, weeklyOpportunityScan, autoRewritePost, syncSiteMetrics],
});
