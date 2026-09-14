import { inngest } from "@/lib/inngest/client";
import { syncModelCatalogs } from "@/lib/ai/model-catalog";

/**
 * Twice-daily model catalog refresh.
 *
 * Model lineups change constantly — providers retire models, rename them,
 * and ship new ones with no announcement. This cron pulls each configured
 * provider's live model list (the same LIST endpoints their API keys can
 * already call) and upserts it into `ai_models`:
 *
 *   - new models appear in pickers automatically (no migration, no release)
 *   - models that vanished from the provider get flagged deprecated and
 *     disappear from selectors
 *   - task tags (blog_generation, social_caption, image_generation, …) are
 *     re-derived from the live ids so new models slot into the right jobs
 *
 * The admin "Sync model catalogs" button hits the same `syncModelCatalogs`
 * for on-demand refreshes between cron runs.
 */
export const refreshModelCatalog = inngest.createFunction(
  {
    id: "refresh-model-catalog",
    name: "Refresh AI model catalogs from providers",
    triggers: [{ cron: "0 3 * * *" }, { cron: "0 15 * * *" }], // 03:00 & 15:00 UTC — twice daily
  },
  async ({ step }) => {
    const { results, syncedAt } = await step.run("sync-all-providers", async () => {
      return await syncModelCatalogs();
    });

    const ok = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    return {
      syncedAt,
      providersSynced: ok.length,
      providersFailed: failed.length,
      modelsUpserted: ok.reduce((sum, r) => sum + r.upserted, 0),
      modelsDeprecated: ok.reduce((sum, r) => sum + r.deprecated, 0),
      errors: failed.map((r) => ({ provider: r.provider, error: r.error })),
    };
  }
);
