import { inngest } from "@/lib/inngest/client";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

// ------------------------------------------------------------------
// Service clients (no request context for background jobs)
// ------------------------------------------------------------------

function createServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function createStripeClient() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!);
}

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

interface UsageRow {
  id: string;
  tenant_id: string;
  metric: string;
  count: number;
  period_start: string;
}

interface SubscriptionRow {
  id: string;
  tenant_id: string;
  stripe_subscription_id: string | null;
  status: string | null;
}

// ------------------------------------------------------------------
// Inngest function: runs at midnight on the 1st of every month
// ------------------------------------------------------------------

export const monthlyBillingReset = inngest.createFunction(
  {
    id: "monthly-billing-reset",
    name: "Monthly Billing Reset & Stripe Usage Report",
    triggers: [
      {
        // Cron: At 00:05 on the 1st day of each month
        cron: "5 0 1 * *",
      },
    ],
  },
  async ({ step }) => {
    const supabase = createServiceSupabase();
    const stripe = createStripeClient();

    // ----------------------------------------------------------------
    // Step 1: Fetch all active subscriptions with Stripe IDs
    // ----------------------------------------------------------------
    const subscriptions = await step.run("fetch-active-subscriptions", async () => {
      const { data, error } = await supabase
        .from("subscriptions")
        .select("id, tenant_id, stripe_subscription_id, status")
        .eq("status", "active")
        .not("stripe_subscription_id", "is", null);

      if (error) {
        console.error("[monthlyBillingReset] Failed to fetch subscriptions:", error);
        return [];
      }

      return (data ?? []) as SubscriptionRow[];
    });

    if (subscriptions.length === 0) {
      return { message: "No active subscriptions to process", processed: 0 };
    }

    console.log(
      `[monthlyBillingReset] Processing ${subscriptions.length} active subscription(s)`
    );

    // ----------------------------------------------------------------
    // Step 2: For each subscription, report usage to Stripe and reset
    // ----------------------------------------------------------------
    const results: Array<{
      tenantId: string;
      stripeSubscriptionId: string;
      usageReported: number;
      reset: boolean;
      error?: string;
    }> = [];

    for (const sub of subscriptions) {
      const outcome = await step.run(
        `process-tenant-${sub.tenant_id}`,
        async () => {
          try {
            // 2a. Fetch current month's usage
            const { data: usageRows, error: usageError } = await supabase
              .from("tenant_usage")
              .select("id, tenant_id, metric, count, period_start")
              .eq("tenant_id", sub.tenant_id)
              .order("metric");

            if (usageError) {
              console.error(
                `[monthlyBillingReset] Failed to fetch usage for tenant ${sub.tenant_id}:`,
                usageError
              );
              return {
                tenantId: sub.tenant_id,
                stripeSubscriptionId: sub.stripe_subscription_id!,
                usageReported: 0,
                reset: false,
                error: usageError.message,
              };
            }

            const usage = (usageRows ?? []) as UsageRow[];

            // 2b. Report usage to Stripe (metered billing)
            let usageReported = 0;
            if (sub.stripe_subscription_id && usage.length > 0) {
              // Find the metered subscription items for this subscription
              const stripeSub = await stripe.subscriptions.retrieve(
                sub.stripe_subscription_id
              );

              for (const usageRow of usage) {
                // Look for a metered price on this subscription matching the metric
                const metricPriceMap: Record<string, string> = {
                  // These price IDs are created by setup-stripe.ts; replace with
                  // actual IDs from your Stripe dashboard after running the script.
                  ai_tokens: process.env.STRIPE_PRICE_AI_TOKENS ?? "",
                  social_profiles: process.env.STRIPE_PRICE_SOCIAL_PROFILES ?? "",
                  blog_posts: process.env.STRIPE_PRICE_BLOG_POSTS ?? "",
                  social_posts: process.env.STRIPE_PRICE_SOCIAL_POSTS ?? "",
                };

                const priceId = metricPriceMap[usageRow.metric];
                if (!priceId) continue;

                const item = stripeSub.items.data.find(
                  (si) => si.price.id === priceId
                );

                if (item) {
                  await (stripe as any).subscriptionItems.createUsageRecord(item.id, {
                    quantity: usageRow.count,
                    timestamp: Math.floor(Date.now() / 1000),
                    action: "set",
                  });
                  usageReported++;
                }
              }
            }

            // 2c. Reset usage counters for the previous period
            const { error: resetError } = await supabase
              .from("tenant_usage")
              .delete()
              .eq("tenant_id", sub.tenant_id);

            if (resetError) {
              console.error(
                `[monthlyBillingReset] Failed to reset usage for tenant ${sub.tenant_id}:`,
                resetError
              );
              return {
                tenantId: sub.tenant_id,
                stripeSubscriptionId: sub.stripe_subscription_id!,
                usageReported,
                reset: false,
                error: resetError.message,
              };
            }

            return {
              tenantId: sub.tenant_id,
              stripeSubscriptionId: sub.stripe_subscription_id!,
              usageReported,
              reset: true,
            };
          } catch (err) {
            const message =
              err instanceof Error ? err.message : "Unknown error";
            console.error(
              `[monthlyBillingReset] Exception processing tenant ${sub.tenant_id}:`,
              err
            );
            return {
              tenantId: sub.tenant_id,
              stripeSubscriptionId: sub.stripe_subscription_id ?? "unknown",
              usageReported: 0,
              reset: false,
              error: message,
            };
          }
        }
      );

      results.push(outcome);
    }

    const totalProcessed = results.filter((r) => r.reset).length;
    const errors = results.filter((r) => r.error);

    return {
      message: `Processed ${totalProcessed}/${subscriptions.length} subscription(s)${
        errors.length > 0 ? `, ${errors.length} had errors` : ""
      }`,
      processed: totalProcessed,
      results,
    };
  }
);