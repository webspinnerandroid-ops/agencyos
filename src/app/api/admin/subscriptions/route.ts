import { NextRequest, NextResponse } from "next/server";
import { getTenantId, requireRole } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { autoCheck } from "@/lib/subscription-check";

// ------------------------------------------------------------------
// Shape / validation
// ------------------------------------------------------------------

export interface SubscriptionRecord {
  id?: string;
  provider: string;
  purpose?: string;
  plan?: string;
  cost_per_cycle?: number | null;
  billing_cycle?: "monthly" | "annual" | "payg";
  cycle_day?: number | null;
  renewal_date?: string | null;
  amount_owing?: number | null;
  credit_remaining?: number | null;
  portal_url?: string | null;
  account_email?: string | null;
  notes?: string | null;
  auto_check?: "stripe" | "resend" | "manual" | null;
}

const CYCLES = new Set(["monthly", "annual", "payg"]);
const AUTO = new Set(["stripe", "resend", "manual"]);

function cleanBody(body: unknown): SubscriptionRecord | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const provider =
    typeof b.provider === "string" ? b.provider.trim().slice(0, 120) : "";
  if (!provider) return null;
  const num = (v: unknown): number | null =>
    v === null || v === undefined || v === "" || Number.isNaN(Number(v))
      ? null
      : Math.round(Number(v) * 100) / 100;
  return {
    provider,
    purpose: typeof b.purpose === "string" ? b.purpose.slice(0, 300) : undefined,
    plan: typeof b.plan === "string" ? b.plan.slice(0, 120) : undefined,
    cost_per_cycle: num(b.cost_per_cycle),
    billing_cycle: CYCLES.has(String(b.billing_cycle))
      ? (b.billing_cycle as "monthly" | "annual" | "payg")
      : undefined,
    cycle_day:
      typeof b.cycle_day === "number" && b.cycle_day >= 1 && b.cycle_day <= 31
        ? b.cycle_day
        : undefined,
    renewal_date:
      typeof b.renewal_date === "string" && b.renewal_date
        ? b.renewal_date.slice(0, 10)
        : null,
    amount_owing: num(b.amount_owing),
    credit_remaining: num(b.credit_remaining),
    portal_url:
      typeof b.portal_url === "string"
        ? b.portal_url.slice(0, 500) || null
        : undefined,
    account_email:
      typeof b.account_email === "string"
        ? b.account_email.slice(0, 200) || null
        : undefined,
    notes:
      typeof b.notes === "string" ? b.notes.slice(0, 2000) || null : undefined,
    auto_check: AUTO.has(String(b.auto_check))
      ? (b.auto_check as "stripe" | "resend" | "manual")
      : undefined,
  };
}

const ENV_KEY_FOR_CHECK: Record<string, string> = {
  stripe: "STRIPE_SECRET_KEY",
  resend: "RESEND_API_KEY",
};

// ------------------------------------------------------------------
// Handlers
// ------------------------------------------------------------------

export async function GET() {
  try {
    await requireRole("super_admin");
    const supabase = await createServiceClient();
    const { data, error } = await supabase
      .from("subscription_registry")
      .select("*")
      .order("renewal_date", { ascending: true, nullsFirst: false })
      .order("provider", { ascending: true });
    if (error) throw error;
    return NextResponse.json({ subscriptions: data ?? [] });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to load subscriptions" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireRole("super_admin");
    const body = await request.json().catch(() => ({}));
    const supabase = await createServiceClient();

    // Action dispatch: auto-check one or all rows.
    if (body && typeof body === "object" && "action" in body) {
      const action = (body as { action?: string }).action;
      if (action === "checkAll") {
        const { data: rows } = await supabase
          .from("subscription_registry")
          .select("*");
        const results: { provider: string; ok: boolean; detail?: string; error?: string }[] = [];
        for (const row of rows ?? []) {
          const checkType = row.auto_check;
          if (!checkType || checkType === "manual") continue;
          const envKey = ENV_KEY_FOR_CHECK[checkType];
          const apiKey = envKey ? process.env[envKey] : undefined;
          if (!apiKey) {
            results.push({ provider: row.provider, ok: false, error: `${envKey} not set` });
            continue;
          }
          try {
            const result = await autoCheck(checkType, apiKey);
            await supabase
              .from("subscription_registry")
              .update({
                credit_remaining: result.creditRemaining,
                last_checked_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
              .eq("id", row.id);
            results.push({ provider: row.provider, ok: true, detail: result.detail });
          } catch (err: any) {
            results.push({ provider: row.provider, ok: false, error: err?.message ?? "check failed" });
          }
        }
        return NextResponse.json({ ok: true, results });
      }

      if (action === "check") {
        const id = String((body as { id?: string }).id ?? "");
        if (!id) return NextResponse.json({ error: "Missing subscription id" }, { status: 400 });
        const { data: row } = await supabase
          .from("subscription_registry")
          .select("*")
          .eq("id", id)
          .maybeSingle();
        if (!row) return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
        const checkType = row.auto_check;
        if (!checkType || checkType === "manual") {
          return NextResponse.json({ error: "This provider has no auto-check (track manually)" }, { status: 400 });
        }
        const envKey = ENV_KEY_FOR_CHECK[checkType];
        const apiKey = envKey ? process.env[envKey] : undefined;
        if (!apiKey) {
          return NextResponse.json({ error: `${envKey} is not configured on the server` }, { status: 400 });
        }
        const result = await autoCheck(checkType, apiKey);
        await supabase
          .from("subscription_registry")
          .update({
            credit_remaining: result.creditRemaining,
            last_checked_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", id);
        return NextResponse.json({ ok: true, creditRemaining: result.creditRemaining, detail: result.detail });
      }

      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }

    // Otherwise: add a new subscription.
    const record = cleanBody(body);
    if (!record) {
      return NextResponse.json({ error: "Provider name is required" }, { status: 400 });
    }
    const { data, error } = await supabase
      .from("subscription_registry")
      .insert(record)
      .select("*")
      .single();
    if (error) throw error;
    return NextResponse.json({ subscription: data });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to save subscription" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    await requireRole("super_admin");
    const body = await request.json().catch(() => ({}));
    const id =
      body && typeof body === "object" && typeof body.id === "string"
        ? body.id
        : "";
    if (!id) return NextResponse.json({ error: "Missing subscription id" }, { status: 400 });
    const record = cleanBody(body);
    if (!record) return NextResponse.json({ error: "Invalid subscription data" }, { status: 400 });
    const supabase = await createServiceClient();
    const { data, error } = await supabase
      .from("subscription_registry")
      .update({ ...record, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return NextResponse.json({ subscription: data });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to update subscription" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await requireRole("super_admin");
    const id = request.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing subscription id" }, { status: 400 });
    const supabase = await createServiceClient();
    const { error } = await supabase.from("subscription_registry").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to delete subscription" },
      { status: 500 }
    );
  }
}
