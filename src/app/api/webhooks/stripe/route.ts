import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createServiceClient } from "@/lib/supabase/server";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// ------------------------------------------------------------------
// Stripe requires the raw body for signature verification. Next.js
// App Router reads the body for you via request.text(), so we just
// need the raw text and the stripe-signature header.
// ------------------------------------------------------------------

function getStripeEvent(
  body: string,
  signature: string
): Stripe.Event {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;
  return stripe.webhooks.constructEvent(body, signature, webhookSecret);
}

// ------------------------------------------------------------------
// Event handlers
// ------------------------------------------------------------------

async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
  const supabase = await createServiceClient();

  const tenantId = session.metadata?.tenant_id;
  const customerId = session.customer as string;
  const subscriptionId = session.subscription as string;

  if (!tenantId) {
    console.error("[stripe-webhook] Missing tenant_id in session metadata");
    return;
  }

  // ------------------------------------------------------------------
  // Token add-on top-up: credit the tenant's prepaid balance.
  // ------------------------------------------------------------------
  if (session.metadata?.kind === "token_topup") {
    const amount = Number(session.metadata.addon_amount_usd ?? 0);
    if (amount > 0) {
      const { creditAddonPurchase } = await import("@/lib/token-billing");
      await creditAddonPurchase(tenantId, amount, session.metadata.addon_label ?? "Token add-on");
    }
    return;
  }

  // ------------------------------------------------------------------
  // Hub purchase (hub-and-spoke): add the hub to the tenant's settings so
  // usage limits expand immediately. bundle_3 grants the any-3 bundle.
  // ------------------------------------------------------------------
  if (session.metadata?.hub_id || session.metadata?.hub_ids) {
    const { setTenantHubs, getTenantHubs } = await import("@/lib/plan-limits");
    const current = await getTenantHubs(tenantId);
    const additions = session.metadata?.hub_ids
      ? session.metadata.hub_ids.split(",").filter(Boolean)
      : session.metadata?.hub_id
        ? [session.metadata.hub_id]
        : [];
    const next = [...current];
    for (const hubId of additions) {
      if (!next.includes(hubId)) next.push(hubId);
    }
    await setTenantHubs(tenantId, next);
    console.log(`[stripe-webhook] Hubs [${additions.join(", ")}] activated for tenant ${tenantId}`);
    return;
  }

  // Upsert subscription record
  const { data: existing } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("subscriptions")
      .update({
        stripe_subscription_id: subscriptionId,
        stripe_customer_id: customerId,
        status: "active",
      })
      .eq("id", existing.id);
  } else {
    await supabase.from("subscriptions").insert({
      tenant_id: tenantId,
      stripe_subscription_id: subscriptionId,
      stripe_customer_id: customerId,
      status: "active",
      plan_id: session.metadata?.plan_id ?? null,
    });
  }

  console.log(`[stripe-webhook] Subscription activated for tenant ${tenantId}`);
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const supabase = await createServiceClient();

  const status = subscription.status;
  const customerId = subscription.customer as string;
  const currentPeriodEnd = new Date(
    (subscription as unknown as { current_period_end: number }).current_period_end * 1000
  ).toISOString();

  const { error } = await supabase
    .from("subscriptions")
    .update({
      status,
      current_period_end: currentPeriodEnd,
    })
    .eq("stripe_subscription_id", subscription.id);

  if (error) {
    console.error("[stripe-webhook] Error updating subscription:", error);
  } else {
    console.log(
      `[stripe-webhook] Subscription ${subscription.id} status → ${status}`
    );
  }
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const supabase = await createServiceClient();

  const { error } = await supabase
    .from("subscriptions")
    .update({ status: "canceled" })
    .eq("stripe_subscription_id", subscription.id);

  if (error) {
    console.error("[stripe-webhook] Error canceling subscription:", error);
  } else {
    console.log(`[stripe-webhook] Subscription ${subscription.id} canceled`);
  }
}

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  const supabase = await createServiceClient();

  const subscriptionId = (invoice as unknown as { subscription: string }).subscription;
  if (!subscriptionId) return;

  console.log(
    `[stripe-webhook] Invoice ${invoice.id} paid for subscription ${subscriptionId}`
  );

  // Agency ops (Phase 2/4): ledger entry + workflow event, idempotent on the
  // Stripe event id so Stripe's at-least-once retries never double-resume a
  // payment gate (plan Phase 4 acceptance test: 3× replay → one ledger row).
  try {
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("tenant_id")
      .eq("stripe_subscription_id", subscriptionId)
      .maybeSingle();
    if (!sub) return;
    const tenantId = sub.tenant_id as string;

    const { record } = await import("@/lib/agency/ledger");
    const { emitInvoicePaid } = await import("@/lib/agency/events");
    const eventId = (invoice as unknown as { id: string }).id ?? "";

    // Idempotency probe: the activity table has no unique constraint on
    // artifact_ref, so we check for this Stripe event before inserting.
    const { data: existing } = await supabase
      .from("activity")
      .select("id")
      .eq("artifact_ref", eventId)
      .eq("type", "payment")
      .limit(1)
      .maybeSingle();
    if (existing) {
      console.log(`[stripe-webhook] Invoice event ${eventId} already recorded — skipping`);
      return;
    }

    const amountUsd =
      typeof invoice.amount_paid === "number" ? invoice.amount_paid / 100 : null;
    await record({
      tenantId,
      actor: { kind: "webhook", name: "stripe" },
      type: "payment",
      summary: `Invoice paid: ${invoice.number ?? invoice.id} ($${amountUsd?.toFixed(2) ?? "?"})`,
      payload: { stripeInvoiceId: invoice.id, subscriptionId },
      artifactRef: eventId,
      status: "ok",
    });
    await emitInvoicePaid({
      tenantId,
      stripeEventId: eventId,
      invoiceId: invoice.id ?? null,
      amountUsd,
      clientId: null,
      workspaceId: null,
    });
  } catch (err) {
    console.error("[stripe-webhook] agency ops emission failed:", (err as Error).message);
  }
}

// ------------------------------------------------------------------
// Route handler (POST only)
// ------------------------------------------------------------------
export async function POST(request: NextRequest) {
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json(
      { error: "Missing stripe-signature header" },
      { status: 400 }
    );
  }

  let body: string;
  try {
    body = await request.text();
  } catch {
    return NextResponse.json(
      { error: "Failed to read request body" },
      { status: 400 }
    );
  }

  let event: Stripe.Event;
  try {
    event = getStripeEvent(body, signature);
  } catch (err) {
    console.error("[stripe-webhook] Signature verification failed:", err);
    return NextResponse.json(
      { error: "Webhook signature verification failed" },
      { status: 400 }
    );
  }

  // ------------------------------------------------------------------
  // Route to handler
  // ------------------------------------------------------------------
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutSessionCompleted(session);
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionUpdated(subscription);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionDeleted(subscription);
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        await handleInvoicePaid(invoice);
        break;
      }

      default:
        console.log(`[stripe-webhook] Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[stripe-webhook] Handler error:", error);
    return NextResponse.json(
      { error: "Webhook handler failed" },
      { status: 500 }
    );
  }
}