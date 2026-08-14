// ============================================================================
// Stripe live pricing
//
// The public landing page and the page builder both read plan/hub prices from
// Stripe's live price objects instead of trusting the display copy stored in
// site_settings.landing_content. The stored `price` field is kept only as a
// fallback (when Stripe is unreachable or a product is missing) and to detect
// drift between what's stored and what Stripe actually charges.
//
// Server-only: this module talks to the Stripe API and is never imported by
// client components.
// ============================================================================

import Stripe from "stripe";
import type { LandingContent } from "@/lib/landing-content";

let _stripe: Stripe | null | undefined;

function getStripe(): Stripe | null {
  if (_stripe === undefined) {
    _stripe = process.env.STRIPE_SECRET_KEY
      ? new Stripe(process.env.STRIPE_SECRET_KEY)
      : null;
  }
  return _stripe;
}

/** Format a cent amount as a plain dollar string (no "$" — the landing page
 * prepends it). Whole dollars render without decimals, e.g. 4900 -> "49". */
export function formatCentsAsDollars(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2);
}

/** Normalize a stored display price ("49", "49.00", "$49", "1,299") to a
 * dollar number, or null when it can't be parsed. */
function normalizeStoredPrice(value: string): number | null {
  const n = parseFloat(String(value).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export interface LivePrice {
  /** Amount in the smallest currency unit (cents for USD). */
  unitAmount: number;
  currency: string;
  /** Formatted dollar string, e.g. "49" or "49.50". */
  price: string;
  priceId: string;
}

export interface PlanPriceStatus {
  planId: string;
  storedPrice: string;
  live: LivePrice | null;
  drift: boolean;
}

export interface HubPriceStatus {
  hubId: string;
  storedPrice: string;
  live: LivePrice | null;
  drift: boolean;
}

// ---------------------------------------------------------------------------
// Cached lookups — the landing page is public and re-rendered frequently, so
// avoid hammering Stripe on every request.
// ---------------------------------------------------------------------------

const cache = new Map<string, { at: number; value: LivePrice | null }>();
const TTL_MS = 60_000;

/** Invalidate all cached price lookups (called after creating a product). */
export function bustPricingCache(): void {
  cache.clear();
}

async function lookupMonthlyPrice(
  metaKey: "plan_id" | "hub_id",
  id: string
): Promise<LivePrice | null> {
  const stripe = getStripe();
  if (!stripe) return null;

  const cacheKey = `${metaKey}:${id}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  let value: LivePrice | null = null;
  try {
    const products = await stripe.products.search({
      query: `metadata["${metaKey}"]:"${id}"`,
    });
    if (products.data.length > 0) {
      const prices = await stripe.prices.list({
        product: products.data[0].id,
        type: "recurring",
        active: true,
        limit: 10,
      });
      const monthly = prices.data
        .filter(
          (p) =>
            p.recurring?.interval === "month" &&
            p.recurring?.usage_type !== "metered"
        )
        .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))[0];
      if (monthly && monthly.unit_amount != null) {
        value = {
          unitAmount: monthly.unit_amount,
          currency: monthly.currency,
          price: formatCentsAsDollars(monthly.unit_amount),
          priceId: monthly.id,
        };
      }
    }
  } catch {
    value = null;
  }

  cache.set(cacheKey, { at: Date.now(), value });
  return value;
}

/** True when the stored display price differs from the Stripe price. */
function hasDrift(storedPrice: string, live: LivePrice): boolean {
  const n = normalizeStoredPrice(storedPrice);
  if (n == null) return true;
  return Math.abs(n - live.unitAmount / 100) > 0.001;
}

/** Overlay Stripe's live prices onto the content (fallback: stored price). */
export async function withLivePrices(
  content: LandingContent
): Promise<LandingContent> {
  const [planPrices, hubPrices] = await Promise.all([
    Promise.all(content.plans.map((p) => lookupMonthlyPrice("plan_id", p.planId))),
    Promise.all(content.hubs.map((h) => lookupMonthlyPrice("hub_id", h.hubId))),
  ]);

  return {
    ...content,
    plans: content.plans.map((p, i) =>
      planPrices[i] ? { ...p, price: planPrices[i]!.price } : p
    ),
    hubs: content.hubs.map((h, i) =>
      hubPrices[i] ? { ...h, price: hubPrices[i]!.price } : h
    ),
  };
}

/** Live prices + drift flags for every plan/hub, for the page builder. */
export async function getPricingStatus(content: LandingContent): Promise<{
  plans: PlanPriceStatus[];
  hubs: HubPriceStatus[];
}> {
  const [plans, hubs] = await Promise.all([
    Promise.all(
      content.plans.map(async (p) => {
        const live = await lookupMonthlyPrice("plan_id", p.planId);
        return {
          planId: p.planId,
          storedPrice: p.price,
          live,
          drift: live != null && hasDrift(p.price, live),
        } satisfies PlanPriceStatus;
      })
    ),
    Promise.all(
      content.hubs.map(async (h) => {
        const live = await lookupMonthlyPrice("hub_id", h.hubId);
        return {
          hubId: h.hubId,
          storedPrice: h.price,
          live,
          drift: live != null && hasDrift(h.price, live),
        } satisfies HubPriceStatus;
      })
    ),
  ]);
  return { plans, hubs };
}
