// scripts/check-price-drift.ts
// Nightly drift check: compares the display prices stored in
// site_settings.landing_content against Stripe's live monthly price for every
// plan and hub. Uses the app's own mergeLandingContent defaults (so an empty
// or partial DB column still checks the compiled copy) and mirrors the
// resolution logic in src/lib/stripe-pricing.ts (metadata search + first
// active recurring monthly price).
//
// Exits non-zero when any plan/hub is DRIFTED (stored != live) or has NO
// Stripe price (missing product / no active monthly price), so it can gate a
// scheduled CI job. When PRICE_DRIFT_WEBHOOK_URL is set (Slack or Discord
// incoming webhook), the full result summary is posted there too, so a
// failing nightly run is noticed even if nobody watches the Actions tab.
//
// Build:  node_modules/.bin/esbuild scripts/check-price-drift.ts \
//           --bundle --platform=node --format=cjs --outfile=scripts/check-price-drift.cjs \
//           --external:stripe --external:@supabase/supabase-js
// Usage:  NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... STRIPE_SECRET_KEY=... \
//           [PRICE_DRIFT_WEBHOOK_URL=...] node scripts/check-price-drift.cjs

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { mergeLandingContent } from "../src/lib/landing-content";
import {
  normalizeStoredPrice,
  classifyDrift,
  fmt,
  buildWebhookPayload,
  detectWebhookService,
  type DriftEntry,
  type DriftSummary,
} from "../src/lib/price-drift";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
const WEBHOOK_URL = process.env.PRICE_DRIFT_WEBHOOK_URL;

let failures = 0;
const entries: DriftEntry[] = [];

async function lookupMonthlyPrice(
  stripe: Stripe,
  metaKey: "plan_id" | "hub_id",
  id: string
): Promise<{ cents: number; priceId: string; productId: string } | null> {
  try {
    const products = await stripe.products.search({
      query: `metadata["${metaKey}"]:"${id}"`,
    });
    if (products.data.length === 0) return null;
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
    return monthly && monthly.unit_amount != null
      ? {
          cents: monthly.unit_amount,
          priceId: monthly.id,
          productId: products.data[0].id,
        }
      : null;
  } catch (err) {
    console.error(
      `  lookup error for ${metaKey}=${id}: ${(err as Error).message}`
    );
    return null;
  }
}

function checkEntry(
  kind: "plan" | "hub",
  id: string,
  storedPrice: string,
  live: { cents: number; priceId: string } | null
): void {
  const stored = normalizeStoredPrice(storedPrice);
  const status = classifyDrift(stored, live?.cents ?? null);
  const liveStr = live ? `$${fmt(live.cents)}/mo (${live.priceId})` : "(missing)";
  const storedStr = stored != null ? `$${stored}/mo` : "(none)";
  const flag = status === "SYNCED" ? "  " : "✗ ";
  console.log(
    `${flag}${kind.padEnd(6)} ${id.padEnd(12)} stored=${storedStr.padEnd(10)} live=${liveStr}  -> ${status}`
  );
  entries.push({ kind, id, status, storedStr, liveStr });
  if (status !== "SYNCED") failures += 1;
}

async function sendWebhook(url: string, payload: unknown): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`webhook returned HTTP ${res.status} ${res.statusText}`);
  }
}

async function main(): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY || !STRIPE_KEY) {
    console.error(
      "Missing env: need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY"
    );
    process.exit(2);
  }

  const stripe = new Stripe(STRIPE_KEY);
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await sb
    .from("site_settings")
    .select("landing_content")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    console.error("Failed to load site_settings:", error.message);
    process.exit(2);
  }

  // Merge over the compiled defaults exactly like getLandingContent() so an
  // empty column (fresh install / builder never saved) still gets checked.
  const content = mergeLandingContent(data?.landing_content);

  console.log("=== PLAN PRICES (stored vs live Stripe) ===");
  for (const p of content.plans) {
    const live = await lookupMonthlyPrice(stripe, "plan_id", p.planId);
    checkEntry("plan", p.planId, p.price, live);
  }

  console.log("\n=== HUB PRICES (stored vs live Stripe) ===");
  for (const h of content.hubs) {
    const live = await lookupMonthlyPrice(stripe, "hub_id", h.hubId);
    checkEntry("hub", h.hubId, h.price, live);
  }

  const summary: DriftSummary = {
    total: entries.length,
    failures,
    ok: failures === 0,
    entries,
  };
  console.log(
    `\n${summary.ok ? "ALL SYNCED" : `${failures} item(s) out of sync`}`
  );

  if (WEBHOOK_URL) {
    const service = detectWebhookService(WEBHOOK_URL);
    const payload = buildWebhookPayload(
      service,
      summary,
      process.env.GITHUB_RUN_ID
    );
    try {
      await sendWebhook(WEBHOOK_URL, payload);
      console.log(`Results posted to ${service} webhook.`);
    } catch (err) {
      // A failed delivery must surface, or the whole point of the webhook
      // (noticing broken prices without watching Actions) is defeated.
      console.error(`Failed to post results to webhook: ${(err as Error).message}`);
      failures += 1;
    }
  }

  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
