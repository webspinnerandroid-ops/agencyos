import { createServiceClient } from "@/lib/supabase/server";
import { getCurrentUsage } from "@/lib/usage";
import { isTrialTenant } from "@/lib/trial-limits";

/**
 * Per-tier MONTHLY usage limits. Stripe product metadata can override these
 * (see /api/billing) — this is the built-in default when metadata is absent.
 *
 * Trial tenants are NOT governed by these: they keep the weekly 1-per-type
 * cap from trial-limits.ts.
 */
export const PLAN_LIMITS: Record<string, { [k: string]: number }> = {
  foundation: {
    blog_posts: 4,
    social_posts: 40,
    image_generations: 40,
    video_generations: 8,
    ai_tokens: 200_000,
    social_profiles: 3,
  },
  growth: {
    blog_posts: 12,
    social_posts: 150,
    image_generations: 150,
    video_generations: 30,
    ai_tokens: 750_000,
    social_profiles: 10,
  },
  dominance: {
    blog_posts: 40,
    social_posts: 500,
    image_generations: 500,
    video_generations: 120,
    ai_tokens: 2_500_000,
    social_profiles: 30,
  },
};

/** Friendly label for a usage metric shown to users. */
export function usageMetricLabel(metric: string): string {
  switch (metric) {
    case "blog_posts":
      return "Blog posts";
    case "social_posts":
      return "Social posts";
    case "image_generations":
      return "Images generated";
    case "video_generations":
      return "Videos generated";
    case "ai_tokens":
      return "AI tokens";
    case "social_profiles":
      return "Social profiles";
    default:
      return metric.replace(/_/g, " ");
  }
}

export interface UsageCheckResult {
  allowed: boolean;
  used: number;
  limit: number | null;
  metric: string;
  reason?: string;
  percent: number | null;
}

/**
 * Check whether this tenant may consume one more unit of `metric` in the
 * current billing cycle. Trial tenants get { allowed: true, limit: null }
 * here — their weekly per-type cap is enforced separately.
 */
export async function checkUsageLimit(
  tenantId: string,
  metric: string
): Promise<UsageCheckResult> {
  const supabase = await createServiceClient();

  // Trial tenants: no monthly plan cap (weekly trial cap applies instead).
  const trial = await isTrialTenant(tenantId);
  if (trial) {
    return { allowed: true, used: 0, limit: null, metric, percent: null };
  }

  // Plan for this tenant.
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("plan_id, status")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const planId = String(sub?.plan_id ?? "foundation");
  let limit: number | null = PLAN_LIMITS[planId]?.[metric] ?? null;

  // Stripe product metadata can raise/lower limits — check tenant_settings
  // overrides written by the billing sync (metadata lives on the Stripe
  // product; we cache it here when the checkout completes).
  if (limit == null) {
    // Unknown metric or plan — default to allowing (don't break features).
    return { allowed: true, used: 0, limit: null, metric, percent: null };
  }

  const usage = await getCurrentUsage(tenantId);
  const used = usage.find((u) => u.metric === metric)?.count ?? 0;
  const allowed = used < limit;
  return {
    allowed,
    used,
    limit,
    metric,
    percent: limit > 0 ? Math.round((used / limit) * 100) : null,
    reason: allowed
      ? undefined
      : `You've used your monthly ${usageMetricLabel(metric)} limit (${used} of ${limit}). Upgrade your plan or wait for the next billing cycle.`,
  };
}
