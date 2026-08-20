import { createServiceClient } from "@/lib/supabase/server";
import {
  DEFAULT_LANDING_CONTENT,
  mergeLandingContent,
  type LandingContent,
} from "@/lib/landing-content";
import { withLivePrices } from "@/lib/stripe-pricing";

/**
 * Server-side loader for the public landing page. Never throws — on any error
 * it returns the compiled defaults so the marketing site always renders.
 *
 * Lives in its own module so the client-safe landing-content.ts (imported by
 * the page-builder client component) never pulls in the server-only Supabase
 * client.
 *
 * The public page is force-dynamic, so without a cache every visit would hit
 * Stripe's live API. A short-TTL module cache serves the last-known content
 * (prices included) instantly between refreshes, and keeps the page render
 * fast even while Stripe is briefly unreachable — the 5s Stripe timeout only
 * fires once per TTL window instead of once per request.
 */
const CONTENT_TTL_MS = 60_000;

let cached: { at: number; content: LandingContent } | null = null;

/** Drop the cached landing content (called after the builder saves). */
export function bustLandingContentCache(): void {
  cached = null;
}

export async function getLandingContent(): Promise<LandingContent> {
  if (cached && Date.now() - cached.at < CONTENT_TTL_MS) {
    return cached.content;
  }

  let content: LandingContent;
  try {
    const supabase = await createServiceClient();
    const { data } = await supabase
      .from("site_settings")
      .select("landing_content")
      .eq("id", 1)
      .maybeSingle();
    const merged = mergeLandingContent(data?.landing_content);
    // Prices come from Stripe's live price objects so the marketing page can
    // never drift from what checkout actually charges. Falls back to the
    // stored copy when Stripe is unreachable or a product is missing.
    try {
      content = await withLivePrices(merged);
    } catch {
      content = merged;
    }
  } catch {
    content = DEFAULT_LANDING_CONTENT;
  }

  cached = { at: Date.now(), content };
  return content;
}
