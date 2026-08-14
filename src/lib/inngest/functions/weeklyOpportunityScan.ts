import { inngest } from "@/lib/inngest/client";
import { scanOpportunitiesForTenant, createScanSupabase, currentWeekStart } from "@/lib/opportunity-scan";
import { createNotification } from "@/lib/in-app-notifications";

/**
 * Weekly opportunity scan — every Monday at 08:00 UTC.
 * For every tenant with an active license, asks the tenant's configured text
 * model to surface Reddit/LinkedIn/Quora opportunities and stores them in
 * content_opportunities with this week's week_start. Each tenant's scan runs
 * under its own API key (generateStructuredOutput resolves per tenant).
 */
export const weeklyOpportunityScan = inngest.createFunction(
  {
    id: "weekly-opportunity-scan",
    name: "Weekly Reddit/LinkedIn/Quora Opportunity Scan",
    triggers: [{ cron: "0 8 * * 1" }], // Mondays 08:00 UTC
  },
  async ({ step }) => {
    const supabase = createScanSupabase();
    const weekStart = currentWeekStart();

    const tenants = await step.run("fetch-active-tenants", async () => {
      const { data, error } = await supabase
        .from("licenses")
        .select("tenant_id")
        .eq("is_active", true)
        .limit(500);
      if (error) {
        console.error("[weeklyOpportunityScan] fetch tenants:", error.message);
        return [];
      }
      return (data ?? []) as { tenant_id: string }[];
    });

    let total = 0;
    for (const t of tenants) {
      // First workspace of the tenant is used as the scan target.
      const workspaceId = await step.run(`workspace-${t.tenant_id}`, async () => {
        const { data } = await supabase
          .from("workspaces")
          .select("id")
          .eq("tenant_id", t.tenant_id)
          .limit(1)
          .maybeSingle();
        return (data?.id as string | undefined) ?? null;
      });

      // Progress ping before the scan, so the owner knows the weekly run is
      // happening in the background.
      void createNotification({
        tenantId: t.tenant_id,
        kind: "progress",
        title: "Scanning for content opportunities…",
        body: "The weekly scan is looking for Reddit/LinkedIn/Quora conversations to turn into content.",
        link: "/dashboard/seo/opportunities",
      });

      const result = await step.run(`scan-${t.tenant_id}`, async () => {
        // No topics configured for the batch — the model works from the
        // workspace context available to it in the prompt.
        return scanOpportunitiesForTenant(
          t.tenant_id,
          workspaceId,
          { brandName: "the workspace owner", topics: [], targetAudience: "their niche" },
          weekStart
        );
      });
      total += result.inserted;

      void createNotification({
        tenantId: t.tenant_id,
        kind: "info",
        title:
          result.inserted > 0
            ? `${result.inserted} new content opportunities found`
            : "Opportunity scan finished",
        body:
          result.inserted > 0
            ? "Review and approve the fresh content ideas from this week's scan."
            : "No new conversations matched this week — check again next Monday.",
        link: "/dashboard/seo/opportunities",
      });
    }

    return { weekStart, tenants: tenants.length, inserted: total };
  }
);
