/**
 * Creates Stripe products and prices for Agency OS subscription plans.
 * Run: npx tsx scripts/setup-stripe-products.ts
 * Requires STRIPE_SECRET_KEY in .env.local
 */

import Stripe from "stripe";

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_KEY) {
  console.error("ERROR: STRIPE_SECRET_KEY not found in .env.local");
  process.exit(1);
}

const stripe = new Stripe(STRIPE_KEY);

interface PlanConfig {
  planId: string;
  name: string;
  description: string;
  price: number;
  features: string[];
  aiTokenLimit: number;
  socialProfileLimit: number;
}

const PLANS: PlanConfig[] = [
  {
    planId: "starter",
    name: "Starter",
    description: "5 clients · 5,000 AI tokens/mo · 3 social profiles · unlimited posts",
    price: 2900,
    features: [
      "Up to 5 clients",
      "5,000 AI tokens per month",
      "3 social profiles",
      "Unlimited posts",
      "Basic analytics",
      "White-label portal",
      "Email support",
    ],
    aiTokenLimit: 5000,
    socialProfileLimit: 3,
  },
  {
    planId: "growth",
    name: "Growth",
    description: "20 clients · 25,000 AI tokens/mo · 10 social profiles · unlimited posts",
    price: 7900,
    features: [
      "Up to 20 clients",
      "25,000 AI tokens per month",
      "10 social profiles",
      "Unlimited posts",
      "Advanced analytics",
      "White-label portal",
      "Client approval workflow",
      "Priority support",
    ],
    aiTokenLimit: 25000,
    socialProfileLimit: 10,
  },
  {
    planId: "enterprise",
    name: "Enterprise",
    description: "Unlimited clients · 100,000 AI tokens/mo · unlimited profiles · custom onboarding",
    price: 19900,
    features: [
      "Unlimited clients",
      "100,000 AI tokens per month",
      "Unlimited social profiles",
      "Unlimited posts",
      "Real-time analytics",
      "White-label portal",
      "Client approval workflow",
      "Custom domain support",
      "Dedicated account manager",
    ],
    aiTokenLimit: 100000,
    socialProfileLimit: 100,
  },
];

async function main() {
  console.log("Setting up Stripe products and prices...\n");

  for (const plan of PLANS) {
    console.log(`--- Creating ${plan.name} plan ---`);

    // Check if product already exists by plan_id metadata
    const existing = await stripe.products.search({
      query: `metadata["plan_id"]:"${plan.planId}"`,
    });

    let product: Stripe.Product;

    if (existing.data.length > 0) {
      product = existing.data[0];
      console.log(`  Product already exists: ${product.name} (${product.id})`);

      // Update product metadata
      product = await stripe.products.update(product.id, {
        name: plan.name,
        description: plan.description,
        metadata: {
          plan_id: plan.planId,
          features: JSON.stringify(plan.features),
          ai_token_limit: String(plan.aiTokenLimit),
          social_profile_limit: String(plan.socialProfileLimit),
        },
      });
      console.log(`  Updated product metadata`);
    } else {
      product = await stripe.products.create({
        name: plan.name,
        description: plan.description,
        metadata: {
          plan_id: plan.planId,
          features: JSON.stringify(plan.features),
          ai_token_limit: String(plan.aiTokenLimit),
          social_profile_limit: String(plan.socialProfileLimit),
        },
      });
      console.log(`  Created product: ${product.id}`);
    }

    // Check for existing active monthly price
    const existingPrices = await stripe.prices.list({
      product: product.id,
      type: "recurring",
      active: true,
      limit: 10,
    });

    const hasMonthlyPrice = existingPrices.data.some(
      (p) => p.recurring?.interval === "month"
    );

    if (!hasMonthlyPrice) {
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: plan.price,
        currency: "usd",
        recurring: { interval: "month" },
        metadata: { plan_id: plan.planId, price_type: "flat" },
      });
      console.log(`  Created monthly price: ${price.id} ($${plan.price / 100}/mo)`);
    } else {
      console.log(`  Monthly price already exists for ${plan.name}`);
    }
  }

  console.log("\nDone! All Stripe products and prices are configured.");
  console.log("Visit https://dashboard.stripe.com/test/products to verify.");
}

main().catch(console.error);