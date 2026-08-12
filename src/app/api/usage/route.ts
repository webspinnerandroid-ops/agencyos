import { NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { getCurrentUsage } from "@/lib/usage";
import { isTrialTenant } from "@/lib/trial-limits";
import { getEffectiveLimits, usageMetricLabel } from "@/lib/plan-limits";

const METRICS = [
  "blog_posts",
  "social_posts",
  "image_generations",
  "video_generations",
  "ai_tokens",
  "social_profiles",
] as const;

/**
 * GET /api/usage
 *
 * Current billing-cycle usage for this tenant: counts per metric, the plan
 * limit (or the weekly trial cap), the percentage used, a warning flag at
 * >= 80%, and a per-platform social-post breakdown.
 */
export async function GET() {
  try {
    const tenantId = await getTenantId();
    if (!tenantId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const supabase = await createServiceClient();

    const trial = await isTrialTenant(tenantId);
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("plan_id, status, current_period_end")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    const planId = String(sub?.plan_id ?? "");
    const { limits: effectiveLimits, hubs } = await getEffectiveLimits(tenantId);
    const usage = await getCurrentUsage(tenantId);
    const usedMap = new Map(usage.map((u) => [u.metric, u.count]));

    const metrics = METRICS.map((metric) => {
      const used = usedMap.get(metric) ?? 0;
      // Trial: weekly caps of 1 per content type; otherwise the effective
      // limits (all-in-one tier OR the sum of purchased hubs).
      const limit = trial
        ? metric === "blog_posts" || metric === "image_generations" || metric === "video_generations"
          ? 1
          : null
        : (effectiveLimits[metric] ?? null);
      const percent = limit && limit > 0 ? Math.round((used / limit) * 100) : null;
      return {
        metric,
        label: usageMetricLabel(metric),
        used,
        limit,
        percent,
        warning: percent != null && percent >= 80,
        blocked: percent != null && percent >= 100,
      };
    });

    // Per-platform social breakdown for this cycle.
    const periodStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    // Blogs carry an empty-string platform (denormalized), so only count
    // rows with a real platform — keeps the breakdown aligned with the
    // social_posts metric above (no blank bucket).
    const { data: socialPosts } = await supabase
      .from("posts")
      .select("platform")
      .eq("tenant_id", tenantId)
      .gte("created_at", periodStart)
      .not("platform", "is", null);
    const byPlatform: Record<string, number> = {};
    for (const p of socialPosts ?? []) {
      const pf = String(p.platform ?? "").trim();
      if (!pf) continue;
      byPlatform[pf] = (byPlatform[pf] ?? 0) + 1;
    }

    return NextResponse.json({
      trial,
      planId,
      hubs,
      periodStart,
      periodEnd: sub?.current_period_end ?? null,
      metrics,
      socialByPlatform: byPlatform,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 });
  }
}
