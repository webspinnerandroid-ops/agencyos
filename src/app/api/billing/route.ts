import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getTenantId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { getCurrentUsage } from "@/lib/usage";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// ------------------------------------------------------------------
// GET /api/billing
// Returns the current tenant's subscription status, plan info, and
// usage metrics for the current billing period.
// ------------------------------------------------------------------
export async function GET(_request: NextRequest) {
  const tenantId = await getTenantId();
  const supabase = await createServiceClient();

  // Fetch subscription
  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("plan_id, status, stripe_subscription_id, stripe_customer_id, current_period_end, created_at")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  // Fetch usage for current month
  const usage = await getCurrentUsage(tenantId);

  // Fetch Stripe subscription details if available
  let stripePlan: Stripe.Subscription | null = null;
  let stripeProduct: Stripe.Product | null = null;

  if (subscription?.stripe_subscription_id) {
    try {
      stripePlan = await stripe.subscriptions.retrieve(
        subscription.stripe_subscription_id
      );
      const productId = stripePlan.items.data[0]?.price.product as string | undefined;
      if (productId) {
        stripeProduct = await stripe.products.retrieve(productId);
      }
    } catch {
      // Stripe fetch failed — subscription may be in test mode or key is missing
      console.warn("[billing] Could not fetch Stripe subscription details");
    }
  }

  // Extract features and limits from Stripe product metadata
  let features: string[] = [];
  let limits: { ai_tokens?: number; social_profiles?: number } = {};

  if (stripeProduct?.metadata) {
    try {
      features = JSON.parse(stripeProduct.metadata.features ?? "[]") as string[];
    } catch {
      features = [];
    }
    limits = {
      ai_tokens: stripeProduct.metadata.ai_token_limit
        ? Number(stripeProduct.metadata.ai_token_limit)
        : undefined,
      social_profiles: stripeProduct.metadata.social_profile_limit
        ? Number(stripeProduct.metadata.social_profile_limit)
        : undefined,
    };
  }

  // Build billing history from invoices
  let invoices: Array<{
    id: string;
    amount: number;
    currency: string;
    status: string;
    date: string;
    pdfUrl: string | null;
  }> = [];

  if (subscription?.stripe_customer_id) {
    try {
      const invoiceList = await stripe.invoices.list({
        customer: subscription.stripe_customer_id,
        limit: 12,
      });
      invoices = invoiceList.data.map((inv) => ({
        id: inv.id,
        amount: inv.amount_paid,
        currency: inv.currency,
        status: inv.status ?? "unknown",
        date: new Date(inv.created * 1000).toISOString(),
        pdfUrl: inv.invoice_pdf ?? null,
      }));
    } catch {
      console.warn("[billing] Could not fetch invoices");
    }
  }

  return NextResponse.json({
    subscription: subscription
      ? {
          planId: subscription.plan_id,
          planName: stripeProduct?.name ?? subscription.plan_id,
          status: subscription.status,
          currentPeriodEnd: subscription.current_period_end,
          createdAt: subscription.created_at,
          features,
          limits,
        }
      : null,
    usage,
    invoices,
  });
}

// ------------------------------------------------------------------
// POST /api/billing
// Creates a Stripe Checkout Session for the tenant to subscribe or
// upgrade their plan. Accepts { planId: string } in the body.
// ------------------------------------------------------------------
export async function POST(request: NextRequest) {
  const tenantId = await getTenantId();
  const supabase = await createServiceClient();

  let body: { planId?: string; priceId?: string; action?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  // ------------------------------------------------------------------
  // Stripe Customer Portal: manage subscription / add payment method
  // ------------------------------------------------------------------
  if (body.action === "portal") {
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (!sub?.stripe_customer_id) {
      return NextResponse.json(
        { error: "No Stripe customer found for this tenant" },
        { status: 404 }
      );
    }

    const origin = request.headers.get("origin") ?? "http://localhost:3000";
    try {
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: sub.stripe_customer_id,
        return_url: `${origin}/dashboard/billing`,
      });
      return NextResponse.json({ url: portalSession.url });
    } catch (err) {
      console.error("[billing] Failed to create portal session:", err);
      return NextResponse.json(
        { error: "Failed to open billing portal" },
        { status: 500 }
      );
    }
  }

  if (!body.planId && !body.priceId) {
    return NextResponse.json(
      { error: "planId or priceId is required" },
      { status: 400 }
    );
  }

  // If a planId is provided, look up the Stripe price for it
  let stripePriceId = body.priceId;

  if (!stripePriceId && body.planId) {
    // Search for the product by plan_id metadata
    const products = await stripe.products.search({
      query: `metadata["plan_id"]:"${body.planId}"`,
    });

    if (products.data.length === 0) {
      return NextResponse.json(
        { error: `No Stripe product found for plan: ${body.planId}` },
        { status: 404 }
      );
    }

    const product = products.data[0];

    // Find the flat monthly price
    const prices = await stripe.prices.list({
      product: product.id,
      type: "recurring",
      active: true,
      limit: 5,
    });

    const monthlyPrice = prices.data.find(
      (p) => p.recurring?.interval === "month" && p.metadata?.price_type !== "metered"
    );

    if (!monthlyPrice) {
      return NextResponse.json(
        { error: "No monthly price found for this plan" },
        { status: 500 }
      );
    }

    stripePriceId = monthlyPrice.id;
  }

  // Check for existing Stripe customer
  const { data: existingSub } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  // Fetch tenant details for customer creation
  const { data: tenant } = await supabase
    .from("tenants")
    .select("name, billing_email")
    .eq("id", tenantId)
    .single();

  let customerId = existingSub?.stripe_customer_id;

  // Create or retrieve customer
  if (customerId) {
    try {
      await stripe.customers.retrieve(customerId);
    } catch {
      // Customer may have been deleted; create a new one
      customerId = undefined;
    }
  }

  if (!customerId) {
    const customer = await stripe.customers.create({
      name: tenant?.name ?? "Agency Client",
      email: tenant?.billing_email ?? undefined,
      metadata: { tenant_id: tenantId },
    });
    customerId = customer.id;
  }

  // Build the checkout session
  const origin = request.headers.get("origin") ?? "http://localhost:3000";

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [
      {
        price: stripePriceId!,
        quantity: 1,
      },
    ],
    metadata: {
      tenant_id: tenantId,
      plan_id: body.planId ?? "",
    },
    success_url: `${origin}/dashboard/billing?success=true`,
    cancel_url: `${origin}/dashboard/billing?canceled=true`,
    allow_promotion_codes: true,
    billing_address_collection: "auto",
  });

  return NextResponse.json({ url: session.url });
}