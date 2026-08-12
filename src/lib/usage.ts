import { createServiceClient } from "@/lib/supabase/server";

// ------------------------------------------------------------------
// Known usage metrics
// ------------------------------------------------------------------
export type UsageMetric =
  | "ai_tokens"
  | "social_profiles"
  | "blog_posts"
  | "social_posts"
  | "image_generations"
  | "video_generations";

// ------------------------------------------------------------------
// incrementUsage
// Increments a usage counter for the given tenant + metric in the
// current billing period. Upserts so that the first call creates the
// row with count = 1 and subsequent calls increment it atomically.
//
// Call this after each AI generation or action that consumes billable
// resources.
// ------------------------------------------------------------------
export async function incrementUsage(
  tenantId: string,
  metric: UsageMetric,
  amount = 1
): Promise<void> {
  const supabase = await createServiceClient();

  const { error } = await supabase.rpc("increment_usage", {
    p_tenant_id: tenantId,
    p_metric: metric,
    p_amount: amount,
  });

  if (error) {
    // Fallback: perform upsert at the application layer when the RPC
    // function doesn't exist yet (first deploy before migration runs).
    await applicationLayerIncrement(supabase, tenantId, metric, amount);
  }
}

// ------------------------------------------------------------------
// getCurrentUsage
// Returns usage counts for the current billing period (this month).
//
// Row-backed metrics (blogs, socials, images, videos, connected profiles)
// are counted straight from the real tables — the increment counters were
// only introduced recently, so relying on them alone undercounted anything
// generated before they existed (and the Profile page boxes looked wrong
// while the per-platform breakdown, which counts posts directly, looked
// right). The counter remains the source only for ai_tokens, which has no
// row-level equivalent.
// ------------------------------------------------------------------
export async function getCurrentUsage(
  tenantId: string
): Promise<{ metric: string; count: number }[]> {
  const supabase = await createServiceClient();
  const periodStart = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1
  ).toISOString();

  const [counters, blogs, socials, images, videos, profiles] =
    await Promise.all([
      supabase
        .from("tenant_usage")
        .select("metric, count")
        .eq("tenant_id", tenantId)
        .gte("period_start", periodStart),
      supabase
        .from("posts")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("content->>type", "blog")
        .gte("created_at", periodStart),
      supabase
        .from("posts")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("content->>type", "social")
        .gte("created_at", periodStart),
      supabase
        .from("media_assets")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("type", "image")
        .gte("created_at", periodStart),
      supabase
        .from("media_assets")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("type", "video")
        .gte("created_at", periodStart),
      supabase
        .from("social_accounts")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId),
    ]);

  const counterMap = new Map<string, number>();
  for (const row of (counters.data ?? []) as { metric: string; count: number }[]) {
    counterMap.set(row.metric, row.count);
  }

  const result = [
    { metric: "blog_posts", count: blogs.count ?? 0 },
    { metric: "social_posts", count: socials.count ?? 0 },
    { metric: "image_generations", count: images.count ?? 0 },
    { metric: "video_generations", count: videos.count ?? 0 },
    { metric: "ai_tokens", count: counterMap.get("ai_tokens") ?? 0 },
    { metric: "social_profiles", count: profiles.count ?? 0 },
  ];

  return result;
}

// ------------------------------------------------------------------
// resetMonthlyUsage
// Should be called at month-end (via Inngest cron or similar). Sets
// all usage counters back to 0 for the previous period.
//
// In a Stripe metered-billing setup you would FIRST report the usage
// to Stripe via the usage record API, then reset.
// ------------------------------------------------------------------
export async function resetMonthlyUsage(tenantId: string): Promise<void> {
  const supabase = await createServiceClient();

  const periodStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

  const { error } = await supabase
    .from("tenant_usage")
    .delete()
    .eq("tenant_id", tenantId)
    .lt("period_start", periodStart);

  if (error) {
    console.error("[usage] Error resetting monthly usage:", error);
  }
}

// ------------------------------------------------------------------
// reportUsageToStripe
// Sends usage counts to Stripe for metered billing. Call at month-end
// before resetting counters.
// ------------------------------------------------------------------
export async function reportUsageToStripe(
  stripeSubscriptionId: string,
  metricPrices: Record<string, string>, // metric -> stripe price id (metered)
  usage: { metric: string; count: number }[]
): Promise<void> {
  const Stripe = await import("stripe").then((m) => m.default);
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

  for (const { metric, count } of usage) {
    const priceId = metricPrices[metric];
    if (!priceId) continue;

    // Stripe metered billing: create a usage_record for the subscription item
    // We need to find the subscription item id for this price
    const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
    const item = subscription.items.data.find(
      (subItem) => subItem.price.id === priceId
    );

    if (item) {
      await (stripe as any).subscriptionItems.createUsageRecord(item.id, {
        quantity: count,
        timestamp: Math.floor(Date.now() / 1000),
        action: "set", // "set" resets the usage to this value for the period
      });
    }
  }
}

// ------------------------------------------------------------------
// Helpers (internal)
// ------------------------------------------------------------------

async function applicationLayerIncrement(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  tenantId: string,
  metric: string,
  amount: number
) {
  const periodStart = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1
  ).toISOString();

  // Try to upsert
  const { data: existing } = await supabase
    .from("tenant_usage")
    .select("id, count")
    .eq("tenant_id", tenantId)
    .eq("metric", metric)
    .eq("period_start", periodStart)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("tenant_usage")
      .update({ count: (existing.count ?? 0) + amount })
      .eq("id", existing.id);
  } else {
    await supabase.from("tenant_usage").insert({
      tenant_id: tenantId,
      metric,
      count: amount,
      period_start: periodStart,
    });
  }
}