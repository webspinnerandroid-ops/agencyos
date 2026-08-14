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
 */
export async function getLandingContent(): Promise<LandingContent> {
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
      return await withLivePrices(merged);
    } catch {
      return merged;
    }
  } catch {
    return DEFAULT_LANDING_CONTENT;
  }
}
