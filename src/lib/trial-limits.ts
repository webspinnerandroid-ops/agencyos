import { createServiceClient } from "@/lib/supabase/server";

/**
 * Free-trial content limits.
 *
 * Trial tenants (license metadata.is_trial, or a "trialing" subscription)
 * get a taste of the product — NOT unlimited use. They are capped at
 * ONE piece of generated content per week per type:
 *
 *   blog   → posts with type 'blog' created in the last 7 days
 *   image  → media_assets type 'image' created in the last 7 days
 *   video  → media_assets type 'video' created in the last 7 days
 *
 * Paid tenants are never limited here (their Stripe plan limits apply).
 */

export type TrialContentKind = "blog" | "image" | "video";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Returns true when the tenant is still in its 14-day free trial. */
export async function isTrialTenant(tenantId: string): Promise<boolean> {
  const supabase = await createServiceClient();

  // License flag (register route sets metadata.is_trial = true).
  const { data: license } = await supabase
    .from("licenses")
    .select("status, expires_at, metadata")
    .eq("tenant_id", tenantId)
    .limit(1)
    .maybeSingle();

  if (license) {
    const meta = (license.metadata ?? {}) as { is_trial?: boolean };
    if (meta.is_trial === true) {
      // Still within the 14-day window?
      if (license.expires_at && new Date(license.expires_at).getTime() > Date.now()) {
        return true;
      }
    }
  }

  // Fallback: a "trialing" subscription also marks the trial period.
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("status")
    .eq("tenant_id", tenantId)
    .limit(1)
    .maybeSingle();

  return sub?.status === "trialing";
}

/**
 * Returns { allowed: false, reason } when the tenant is on trial and has
 * already generated its one piece of this kind this week.
 */
export async function checkTrialContentLimit(
  tenantId: string,
  kind: TrialContentKind
): Promise<{ allowed: boolean; reason?: string }> {
  const trial = await isTrialTenant(tenantId);
  if (!trial) return { allowed: true };

  const supabase = await createServiceClient();
  const since = new Date(Date.now() - WEEK_MS).toISOString();

  let count = 0;
  if (kind === "blog") {
    const { count: c } = await supabase
      .from("posts")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("type", "blog")
      .gte("created_at", since);
    count = c ?? 0;
  } else {
    const { count: c } = await supabase
      .from("media_assets")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("type", kind)
      .gte("created_at", since);
    count = c ?? 0;
  }

  if (count >= 1) {
    return {
      allowed: false,
      reason: `Your free trial is limited to one ${kind} per week. You've used your ${kind} for this week — upgrade to a paid plan to keep creating.`,
    };
  }

  return { allowed: true };
}
