import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getRole } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import {
  mergeLandingContent,
  type LandingContent,
} from "@/lib/landing-content";
import {
  bustPricingCache,
  formatCentsAsDollars,
  getPricingStatus,
  withLivePrices,
} from "@/lib/stripe-pricing";

/**
 * POST /api/admin/page-builder/pricing
 *
 * Super-admin only. Creates a Stripe product + monthly price (so checkout can
 * resolve it by plan_id / hub_id metadata) and appends the new plan/hub to the
 * landing content in the same save — one atomic flow, no manual Stripe setup.
 *
 * Body:
 *   { kind: "plan" | "hub", name, priceCents, description?, features?,
 *     popular?, blurb?, content }   // content = the builder's current state
 */

function getStripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

async function requireSuperAdmin(): Promise<NextResponse | null> {
  try {
    const role = await getRole();
    if (role !== "super_admin") {
      return NextResponse.json(
        { error: "Super admin access required" },
        { status: 403 }
      );
    }
    return null;
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

export async function POST(request: NextRequest) {
  const denied = await requireSuperAdmin();
  if (denied) return denied;

  let body: {
    kind?: "plan" | "hub";
    name?: string;
    priceCents?: number;
    description?: string;
    features?: string[];
    popular?: boolean;
    blurb?: string;
    content?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const kind = body.kind;
  const name = String(body.name ?? "").trim();
  const priceCents = Number(body.priceCents);

  if (kind !== "plan" && kind !== "hub") {
    return NextResponse.json({ error: "kind must be 'plan' or 'hub'" }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!Number.isInteger(priceCents) || priceCents <= 0) {
    return NextResponse.json(
      { error: "priceCents must be a positive integer (cents)" },
      { status: 400 }
    );
  }
  if (!body.content || typeof body.content !== "object" || Array.isArray(body.content)) {
    return NextResponse.json({ error: "content must be an object" }, { status: 400 });
  }

  const id = slugify(name);
  if (!id) {
    return NextResponse.json({ error: "Name must contain letters or numbers" }, { status: 400 });
  }
  if (kind === "hub" && id === "bundle_3") {
    return NextResponse.json({ error: "That hub id is reserved" }, { status: 400 });
  }

  const content = mergeLandingContent(body.content);
  const metaKey = kind === "plan" ? "plan_id" : "hub_id";
  const existingIds = kind === "plan"
    ? content.plans.map((p) => p.planId)
    : content.hubs.map((h) => h.hubId);
  if (existingIds.includes(id)) {
    return NextResponse.json(
      { error: `A ${kind} with id "${id}" already exists` },
      { status: 409 }
    );
  }

  let stripe: Stripe;
  try {
    stripe = getStripe();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Stripe is not configured" },
      { status: 500 }
    );
  }

  try {
    // Reject duplicates that exist in Stripe but not in the landing content.
    const existing = await stripe.products.search({
      query: `metadata["${metaKey}"]:"${id}"`,
    });
    if (existing.data.length > 0) {
      return NextResponse.json(
        { error: `A Stripe product for "${id}" already exists` },
        { status: 409 }
      );
    }

    const product = await stripe.products.create({
      name,
      metadata:
        kind === "plan"
          ? { plan_id: id, features: JSON.stringify(body.features ?? []) }
          : { hub_id: id },
    });

    await stripe.prices.create({
      product: product.id,
      unit_amount: priceCents,
      currency: "usd",
      recurring: { interval: "month" },
      metadata: { [metaKey]: id, price_type: "flat" },
    });

    // Append the new entry to the builder's current state.
    const next: LandingContent = {
      ...content,
      plans:
        kind === "plan"
          ? [
              ...content.plans,
              {
                planId: id,
                name,
                price: formatCentsAsDollars(priceCents),
                description: String(body.description ?? "").trim(),
                features: (body.features ?? []).map((f) => String(f)),
                popular: body.popular === true,
              },
            ]
          : content.plans,
      hubs:
        kind === "hub"
          ? [
              ...content.hubs,
              {
                hubId: id,
                name,
                price: formatCentsAsDollars(priceCents),
                blurb: String(body.blurb ?? "").trim(),
              },
            ]
          : content.hubs,
    };

    const supabase = await createServiceClient();
    const { error } = await supabase
      .from("site_settings")
      .update({
        landing_content: next as unknown as Record<string, unknown>,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);
    if (error) throw new Error(error.message);

    bustPricingCache();
    const [enriched, pricing] = await Promise.all([
      withLivePrices(next),
      getPricingStatus(next),
    ]);

    return NextResponse.json({ success: true, content: enriched, pricing });
  } catch (err) {
    console.error("[page-builder] Failed to create Stripe product/price:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create product/price" },
      { status: 500 }
    );
  }
}
