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

  // Could store invoice history, send receipt emails, etc.
  console.log(
    `[stripe-webhook] Invoice ${invoice.id} paid for subscription ${subscriptionId}`
  );
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