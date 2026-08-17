import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getTenantId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// ------------------------------------------------------------------
// POST /api/billing/topup
// Creates a one-off Stripe Checkout session for a token add-on pack.
// Body: { addonId: string } — the row in token_addons (min $20 USD).
// On completion the stripe webhook credits the tenant's add-on balance.
// ------------------------------------------------------------------
export async function POST(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();

    let body: { addonId?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const addonId = body.addonId;
    if (!addonId) {
      return NextResponse.json({ error: "addonId is required" }, { status: 400 });
    }

    // Load the add-on pack from the (RLS-closed) token_addons table.
    const { data: addon } = await supabase
      .from("token_addons")
      .select("*")
      .eq("id", addonId)
      .eq("active", true)
      .maybeSingle();

    if (!addon) {
      return NextResponse.json({ error: "Add-on pack not found or inactive" }, { status: 404 });
    }

    const priceUsd = Number(addon.price_usd ?? 0);
    if (!priceUsd || priceUsd < 20) {
      return NextResponse.json({ error: "Add-on price must be at least $20 USD" }, { status: 400 });
    }

    // Reuse the tenant's Stripe customer if one exists.
    const { data: existingSub } = await supabase
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    let customerId = existingSub?.stripe_customer_id;
    if (customerId) {
      try {
        await stripe.customers.retrieve(customerId);
      } catch {
        customerId = undefined;
      }
    }
    if (!customerId) {
      const { data: tenant } = await supabase
        .from("tenants")
        .select("name, billing_email")
        .eq("id", tenantId)
        .single();
      const customer = await stripe.customers.create({
        name: tenant?.name ?? "Agency Client",
        email: tenant?.billing_email ?? undefined,
        metadata: { tenant_id: tenantId },
      });
      customerId = customer.id;
    }

    // One-off payment for a fixed USD amount (not a Stripe product/price —
    // the add-on packs are denominations the super admin edits freely).
    const origin = request.headers.get("origin") ?? "http://localhost:3000";
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: Math.round(priceUsd * 100),
            product_data: {
              name: `Token Add-On — ${addon.label}`,
              description: "Prepaid AI token balance (USD). Applied to your account immediately after payment.",
            },
          },
        },
      ],
      metadata: {
        tenant_id: tenantId,
        kind: "token_topup",
        addon_id: addonId,
        addon_label: addon.label,
        addon_amount_usd: String(priceUsd),
      },
      success_url: `${origin}/dashboard/billing?success=true&kind=topup`,
      cancel_url: `${origin}/dashboard/billing?canceled=true`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    console.error("[billing/topup] Error:", err);
    return NextResponse.json({ error: err?.message ?? "Failed to create checkout session" }, { status: 500 });
  }
}
