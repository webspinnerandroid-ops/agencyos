/**
 * setup-stripe.ts
 *
 * Creates four plan products in Stripe: Starter, Growth, Dominance, Premium.
 *
 * Each plan has:
 *   - A product with metadata describing plan features
 *   - A monthly flat-fee price (recurring)
 *   - Optional metered prices for usage-based billing (AI tokens, social profiles)
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_xxx npx tsx src/scripts/setup-stripe.ts
 *
 * The script is idempotent — it searches for existing products by a known
 * metadata key ("plan_id") and updates them instead of creating duplicates.
 */

import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// ------------------------------------------------------------------
// Plan definitions
// ------------------------------------------------------------------

interface PlanDefinition {
  planId: string;
  name: string;
  description: string;
  monthlyPriceCents: number;
  features: string[];
  aiTokenLimit?: number;
  socialProfileLimit?: number;
  meteredPrices?: {
    aiTokensCentsPerUnit: number;
    socialProfilesCentsPerUnit: number;
  };
}

const PLANS: PlanDefinition[] = [
  {
    planId: "starter",
    name: "Starter",
    description:
      "Essential content generation and social media management for small agencies.",
    monthlyPriceCents: 4_900, // $49.00 / month
    features: [
      "10 blog posts / month",
      "3 social profiles",
      "Basic AI content generation",
      "Content calendar",
      "Analytics dashboard",
      "Email support",
    ],
    aiTokenLimit: 50_000,
    socialProfileLimit: 3,
    meteredPrices: {
      aiTokensCentsPerUnit: 1,
      socialProfilesCentsPerUnit: 500,
    },
  },
  {
    planId: "growth",
    name: "Growth",
    description:
      "Advanced content engine with more profiles and priority AI generation.",
    monthlyPriceCents: 9_900, // $99.00 / month
    features: [
      "50 blog posts / month",
      "10 social profiles",
      "Advanced AI content generation",
      "Content calendar",
      "Analytics dashboard",
      "Priority support",
      "SEO campaign automation",
      "Competitor analysis",
    ],
    aiTokenLimit: 250_000,
    socialProfileLimit: 10,
    meteredPrices: {
      aiTokensCentsPerUnit: 1,
      socialProfilesCentsPerUnit: 1_000,
    },
  },
  {
    planId: "dominance",
    name: "Dominance",
    description:
      "Full content engine with white-label capabilities and dedicated support.",
    monthlyPriceCents: 19_900, // $199.00 / month
    features: [
      "Unlimited blog posts",
      "Unlimited social profiles",
      "Elite AI content generation",
      "Content calendar",
      "Analytics dashboard",
      "Dedicated account manager",
      "White-label portal",
      "Custom integrations",
      "24/7 phone support",
    ],
    aiTokenLimit: 1_000_000,
    socialProfileLimit: 50,
    meteredPrices: {
      aiTokensCentsPerUnit: 1,
      socialProfilesCentsPerUnit: 2_000,
    },
  },
  {
    planId: "premium",
    name: "Premium",
    description:
      "Full-suite agency platform with unlimited scale, link building, and dedicated strategy sessions.",
    monthlyPriceCents: 29_900, // $299.00 / month
    features: [
      "Unlimited everything",
      "Unlimited AI tokens",
      "Unlimited social profiles",
      "Link building & outreach tools",
      "Content calendar",
      "Analytics dashboard",
      "Dedicated account manager",
      "White-label portal",
      "Custom integrations",
      "Quarterly strategy sessions",
      "24/7 priority support",
    ],
    aiTokenLimit: undefined, // unlimited
    socialProfileLimit: undefined, // unlimited
    meteredPrices: {
      aiTokensCentsPerUnit: 0.5,
      socialProfilesCentsPerUnit: 2_000,
    },
  },
];

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

async function findOrCreateProduct(plan: PlanDefinition): Promise<Stripe.Product> {
  // Check for an existing product by metadata plan_id
  const existing = await stripe.products.search({
    query: `metadata["plan_id"]:"${plan.planId}"`,
  });

  if (existing.data.length > 0) {
    const product = existing.data[0];
    console.log(`  ↳ Found existing product: ${product.name} (${product.id})`);

    // Update metadata (features are re-serialised)
    await stripe.products.update(product.id, {
      name: plan.name,
      description: plan.description,
      metadata: {
        plan_id: plan.planId,
        features: JSON.stringify(plan.features),
        ai_token_limit: String(plan.aiTokenLimit ?? ""),
        social_profile_limit: String(plan.socialProfileLimit ?? ""),
      },
    });

    return product;
  }

  // Create new product
  const product = await stripe.products.create({
    name: plan.name,
    description: plan.description,
    metadata: {
      plan_id: plan.planId,
      features: JSON.stringify(plan.features),
      ai_token_limit: String(plan.aiTokenLimit ?? ""),
      social_profile_limit: String(plan.socialProfileLimit ?? ""),
    },
  });

  console.log(`  ↳ Created product: ${product.name} (${product.id})`);
  return product;
}

async function ensureRecurringPrice(
  product: Stripe.Product,
  plan: PlanDefinition
): Promise<Stripe.Price | null> {
  // Check if a recurring price already exists for this product
  const existingPrices = await stripe.prices.list({
    product: product.id,
    type: "recurring",
    active: true,
    limit: 5,
  });

  const matchingPrice = existingPrices.data.find(
    (p) =>
      p.recurring?.interval === "month" &&
      p.unit_amount === plan.monthlyPriceCents
  );

  if (matchingPrice) {
    console.log(
      `     Recurring price (existing): ${formatCents(plan.monthlyPriceCents)}/month (${matchingPrice.id})`
    );
    return matchingPrice;
  }

  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: plan.monthlyPriceCents,
    currency: "usd",
    recurring: { interval: "month" },
    metadata: {
      plan_id: plan.planId,
      price_type: "flat_monthly",
    },
  });

  console.log(
    `     Recurring price (new): ${formatCents(plan.monthlyPriceCents)}/month (${price.id})`
  );
  return price;
}

async function ensureMeteredPrice(
  product: Stripe.Product,
  plan: PlanDefinition,
  metric: string,
  unitLabel: string,
  centsPerUnit: number
): Promise<Stripe.Price | null> {
  // Search for an existing metered price for this metric
  const existingPrices = await stripe.prices.list({
    product: product.id,
    type: "recurring",
    active: true,
    limit: 10,
  });

  const matchingPrice = existingPrices.data.find(
    (p) =>
      p.recurring?.usage_type === "metered" &&
      (p.recurring as any)?.aggregate_usage === "sum" &&
      p.metadata?.metric === metric
  );

  if (matchingPrice) {
    console.log(
      `     Metered (${unitLabel}): ${formatCents(centsPerUnit)}/unit (${matchingPrice.id})`
    );
    return matchingPrice;
  }

  const price = await (stripe.prices as any).create({
    product: product.id,
    unit_amount: centsPerUnit,
    currency: "usd",
    recurring: {
      interval: "month",
      usage_type: "metered",
      aggregate_usage: "sum",
    },
    metadata: {
      plan_id: plan.planId,
      price_type: "metered",
      metric,
    },
  });

  console.log(
    `     Metered (${unitLabel}): ${formatCents(centsPerUnit)}/unit (${price.id})`
  );
  return price;
}

// ------------------------------------------------------------------
// Main
// ------------------------------------------------------------------

async function main() {
  if (!process.env.STRIPE_SECRET_KEY) {
    console.error("❌ STRIPE_SECRET_KEY environment variable is required.");
    console.error(
      "   Usage: STRIPE_SECRET_KEY=sk_test_xxx npx tsx src/scripts/setup-stripe.ts"
    );
    process.exit(1);
  }

  console.log("🚀 Setting up Stripe products & prices...\n");

  let totalPrices = 0;

  for (const plan of PLANS) {
    console.log(`\n📦 ${plan.name} (${plan.planId})`);
    console.log(`   ${plan.description}`);

    // 1. Product
    const product = await findOrCreateProduct(plan);

    // 2. Monthly recurring flat price
    const recurringPrice = await ensureRecurringPrice(product, plan);
    if (recurringPrice) totalPrices++;

    // 3. Metered prices for overage billing
    if (plan.meteredPrices) {
      const aiPrice = await ensureMeteredPrice(
        product,
        plan,
        "ai_tokens",
        "AI tokens (per 100)",
        plan.meteredPrices.aiTokensCentsPerUnit
      );
      if (aiPrice) totalPrices++;

      const socialPrice = await ensureMeteredPrice(
        product,
        plan,
        "social_profiles",
        "Social profiles",
        plan.meteredPrices.socialProfilesCentsPerUnit
      );
      if (socialPrice) totalPrices++;
    }

    // Print plan summary
    console.log(`   Features: ${plan.features.length} items`);
    console.log(
      `   Limits: ${plan.aiTokenLimit?.toLocaleString() ?? "∞"} AI tokens, ${
        plan.socialProfileLimit ?? "∞"
      } social profiles`
    );
  }

  console.log(`\n✅ Done! ${PLANS.length} products, ${totalPrices} prices configured.`);
  console.log("\n💡 Next steps:");
  console.log("   1. Copy the price IDs into your environment or billing code.");
  console.log("   2. Run 'stripe listen --forward-to localhost:3000/api/webhooks/stripe' for local testing.");
  console.log("   3. Use /api/billing/checkout to create Checkout Sessions.\n");
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});