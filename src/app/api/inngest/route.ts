import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { publishScheduledPosts } from "@/lib/inngest/functions/publishScheduledPosts";
import { fetchAnalytics } from "@/lib/inngest/functions/fetchAnalytics";
import { monthlyBillingReset } from "@/lib/inngest/functions/monthlyBillingReset";
import { syncInboxes } from "@/lib/inngest/functions/syncInboxes";
import { syncSocialInbox } from "@/lib/inngest/functions/syncSocialInbox";
import { processSequences } from "@/lib/inngest/functions/processSequences";

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
  functions: [publishScheduledPosts, fetchAnalytics, monthlyBillingReset, syncInboxes, syncSocialInbox, processSequences],
});
