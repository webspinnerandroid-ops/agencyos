import { createServiceClient } from "@/lib/supabase/server";
import { getCurrentUsage } from "@/lib/usage";
import { isTrialTenant } from "@/lib/trial-limits";

// ------------------------------------------------------------------
// Hub-and-spoke pricing model
// ------------------------------------------------------------------
// A tenant's effective monthly allowances come from EITHER:
//   • an all-in-one tier (foundation / growth / dominance) — every hub is
//     included at that tier's limits, or
//   • a-la-carte hubs — limits are the sum of the purchased hubs.
// Trials keep their weekly 1-per-type cap regardless.
//
// All numbers live here so repricing is a one-file change.

export const HUB_PRICES: Record<string, number> = {
  content: 29,
  social: 29,
  video: 29,
  website: 29,
  outreach: 29,
  ai_team: 49,
};

/** Any-3-hubs bundle price (cheaper than buying 3 separately). */
export const HUB_BUNDLE_3_PRICE = 69;

export interface HubInfo {
  id: string;
  name: string;
  tagline: string;
  features: string[];
  limits: { [k: string]: number };
}

export const HUBS: HubInfo[] = [
  {
    id: "content",
    name: "Content Hub",
    tagline: "Blogs, SEO scoring and the content pipeline.",
    features: [
      "Blog + SEO content generation with inline images",
      "Rank-Math-style SEO scoring and scoring gate",
      "CMS publish to your built website",
      "Content calendar and approvals",
    ],
    limits: { blog_posts: 4, image_generations: 10, ai_tokens: 50_000 },
  },
  {
    id: "social",
    name: "Social Hub",
    tagline: "Captions, scheduling and approval flows.",
    features: [
      "Platform-native captions (Instagram, TikTok, LinkedIn, X…)",
      "Scheduling + client approval workflow",
      "Up to 3 connected social profiles",
      "Per-platform posting analytics",
    ],
    limits: { social_posts: 40, social_profiles: 3, ai_tokens: 20_000 },
  },
  {
    id: "video",
    name: "Video Hub",
    tagline: "Text-to-video and image-to-video generation.",
    features: [
      "Wan / Runway / fal.ai video generation",
      "Poster-frame capture and video library",
      "Resolution & codec metadata, lightbox preview",
    ],
    limits: { video_generations: 8, ai_tokens: 20_000 },
  },
  {
    id: "website",
    name: "Website Hub",
    tagline: "The Web Builder — build and host client sites.",
    features: [
      "Elementor-style visual page builder",
      "Site-wide headers/footers and global stylesheets",
      "Blog archive + blog publishing to the site",
      "Published pages at your domain",
    ],
    limits: { ai_tokens: 10_000 },
  },
  {
    id: "outreach",
    name: "Outreach Hub",
    tagline: "Guest posts, replies and opportunity discovery.",
    features: [
      "Discover guest-post targets from campaign plans",
      "Draft, send and track outreach with reply watching",
      "Weekly Reddit / LinkedIn / Quora opportunity picks",
      "Inbound replies surfaced on the dashboard",
    ],
    limits: { ai_tokens: 20_000 },
  },
  {
    id: "ai_team",
    name: "AI Team",
    tagline: "The full employee roster, chat and campaign flows.",
    features: [
      "Chat with Cheryl, Malory, Pam, Ray, Cyril, Lana and more",
      "Concurrent background tasks (Inngest worker)",
      "Campaign mapping, website builds and approvals",
      "Per-workspace memory and chat history",
    ],
    limits: { blog_posts: 4, social_posts: 20, ai_tokens: 150_000 },
  },
];

export const HUB_BY_ID: Record<string, HubInfo> = Object.fromEntries(
  HUBS.map((h) => [h.id, h])
);

/**
 * Per-tier MONTHLY usage limits. Stripe product metadata can override these
 * (see /api/billing) — this is the built-in default when metadata is absent.
 * On a tier every hub is included.
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
  // Legacy / custom tiers retained so the billing page renders their names
  // and defaults correctly instead of falling back to raw lowercase ids.
  enterprise: {
    blog_posts: 100,
    social_posts: 1000,
    image_generations: 1000,
    video_generations: 250,
    ai_tokens: 5_000_000,
    social_profiles: 60,
  },
};

/** Friendly display names for plan ids, including legacy/custom tiers. */
export const PLAN_NAMES: Record<string, string> = {
  foundation: "Foundation",
  growth: "Growth",
  dominance: "Dominance",
  starter: "Starter",
  premium: "Premium",
  enterprise: "Enterprise",
};

/**
 * Default feature bullets for the billing page, used when a subscription has
 * no Stripe product metadata to read features from (e.g. locally-assigned
 * plans like "enterprise").
 */
export const PLAN_FEATURES: Record<string, string[]> = {
  enterprise: [
    "All six hubs included — content, social, video, website, outreach, AI team",
    "Highest usage limits across every hub",
    "Priority support",
  ],
  dominance: [
    "All six hubs included",
    "40 blog posts, 500 social posts and 120 videos per month",
    "2.5M AI tokens per month",
  ],
  growth: [
    "All six hubs included",
    "12 blog posts, 150 social posts and 30 videos per month",
    "750K AI tokens per month",
  ],
  foundation: [
    "All six hubs included",
    "4 blog posts, 40 social posts and 8 videos per month",
    "200K AI tokens per month",
  ],
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

/** The tenant's purchased a-la-carte hubs (from tenant_settings.settings.hubs). */
export async function getTenantHubs(tenantId: string): Promise<string[]> {
  const supabase = await createServiceClient();
  const { data } = await supabase
    .from("tenant_settings")
    .select("settings")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const hubs = (data?.settings as any)?.hubs;
  return Array.isArray(hubs) ? hubs.filter((h: unknown) => typeof h === "string") : [];
}

export async function setTenantHubs(
  tenantId: string,
  hubs: string[]
): Promise<void> {
  const supabase = await createServiceClient();
  const { data: existing } = await supabase
    .from("tenant_settings")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const settings = existing
    ? { ...(((existing as any)?.settings as object) ?? {}), hubs }
    : { hubs };
  if (existing) {
    await supabase
      .from("tenant_settings")
      .update({ settings, updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId);
  } else {
    await supabase.from("tenant_settings").insert({ tenant_id: tenantId, settings });
  }
}

/**
 * Effective monthly limits for a tenant: tier limits when subscribed to an
 * all-in-one tier (hubs included), otherwise the sum of purchased hubs.
 * Trial tenants get no plan cap here — the weekly trial cap applies instead.
 */
export async function getEffectiveLimits(
  tenantId: string
): Promise<{ limits: { [k: string]: number }; source: "tier" | "hubs"; planId: string | null; hubs: string[] }> {
  const supabase = await createServiceClient();
  const trial = await isTrialTenant(tenantId);
  if (trial) return { limits: {}, source: "hubs", planId: null, hubs: [] };

  const { data: sub } = await supabase
    .from("subscriptions")
    .select("plan_id, status")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const planId = String(sub?.plan_id ?? "");
  if (PLAN_LIMITS[planId]) {
    return { limits: PLAN_LIMITS[planId], source: "tier", planId, hubs: [] };
  }

  const hubs = await getTenantHubs(tenantId);
  const limits: { [k: string]: number } = {};
  for (const hubId of hubs) {
    const hub = HUB_BY_ID[hubId];
    if (!hub) continue;
    for (const [metric, amount] of Object.entries(hub.limits)) {
      limits[metric] = (limits[metric] ?? 0) + amount;
    }
  }
  return { limits, source: "hubs", planId: null, hubs };
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

  const { limits, source, hubs } = await getEffectiveLimits(tenantId);
  const limit: number | null = limits[metric] ?? null;

  if (limit == null) {
    // Unknown metric or no entitlements — default to allowing (don't break
    // features) but tell the caller there's no entitlement.
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
      : `You've used your monthly ${usageMetricLabel(metric)} limit (${used} of ${limit}). ${
          source === "hubs" && hubs.length > 0
            ? "Add a hub or upgrade to an all-in-one tier to raise it."
            : "Upgrade your plan or wait for the next billing cycle."
        }`,
  };
}
