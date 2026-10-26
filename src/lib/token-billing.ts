"use server";

import { createServiceClient } from "@/lib/supabase/server";

// ============================================================================
// Token-billing balance helpers.
//
// Balances live in `tenant_balances` (migration 077):
//   monthly_allowance_usd  — USD credit granted by the subscription each cycle
//   used_this_cycle_usd    — USD of usage metered so far this cycle
//   addon_balance_usd      — prepaid top-up balance (Stripe purchases)
//
// A tenant can generate while  (monthly_allowance_usd - used_this_cycle_usd)
// + addon_balance_usd > 0. When both are exhausted, generation returns a
// 402-style "buy more tokens" response instead of silently failing.
//
// All tables are RLS-closed (service layer only) and the helpers degrade
// gracefully before migration 077 — no balance table means "not enforced".
// ============================================================================

export interface TokenBalance {
  enforced: boolean;
  monthlyAllowanceUsd: number;
  usedThisCycleUsd: number;
  addonBalanceUsd: number;
  /** Remaining spendable balance = unused allowance + add-on balance. */
  remainingUsd: number;
}

export interface BalanceCheckResult {
  allowed: boolean;
  balance: TokenBalance;
  reason?: string;
}

/**
 * Rollout switch for the 402 gate. Usage is always metered into the ledger and
 * tenant_balances regardless; this only controls whether an exhausted balance
 * *blocks* generation. Opt-in (`TOKEN_ENFORCE_BILLING=true`) until every plan
 * in `token_plans` carries a non-zero allowance — otherwise every tenant would
 * be locked out the moment a balance row appears with allowance 0.
 */
function billingGateActive(): boolean {
  return process.env.TOKEN_ENFORCE_BILLING === "true";
}

/**
 * Provision a tenant's balance row. Idempotent: a tenant that already has one
 * is left untouched (billing cycle resets own the allowance from then on).
 * Allowance comes from the tenant's plan in `token_plans`; an unknown or empty
 * plan yields 0, which means "metered but not yet granted" — never unlimited.
 */
export async function ensureTenantBalance(
  tenantId: string,
  planId?: string | null
): Promise<void> {
  const supabase = await createServiceClient();

  const { data: existing } = await supabase
    .from("tenant_balances")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (existing) return;

  let plan = planId ?? null;
  if (!plan) {
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("plan_id")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    plan = (sub as { plan_id: string | null } | null)?.plan_id ?? null;
  }

  let allowance = 0;
  if (plan) {
    const { data: planRow } = await supabase
      .from("token_plans")
      .select("monthly_token_allowance_usd")
      .eq("plan_id", plan)
      .maybeSingle();
    allowance = Number(
      (planRow as { monthly_token_allowance_usd: number | string } | null)
        ?.monthly_token_allowance_usd ?? 0
    );
  }

  const { error } = await supabase
    .from("tenant_balances")
    .insert({ tenant_id: tenantId, monthly_allowance_usd: allowance });

  // Concurrent signup/provision → primary-key collision. The row exists either
  // way, which is the postcondition we want.
  if (error && !/duplicate key/i.test(error.message)) {
    console.error("[token-billing] ensureTenantBalance failed:", error.message);
  }
}

export async function getTokenBalance(tenantId: string): Promise<TokenBalance> {
  const supabase = await createServiceClient();
  const { data } = await supabase
    .from("tenant_balances")
    .select("monthly_allowance_usd, used_this_cycle_usd, addon_balance_usd")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!data) {
    // No row (migration not applied or never generated) → not enforced.
    return {
      enforced: false,
      monthlyAllowanceUsd: 0,
      usedThisCycleUsd: 0,
      addonBalanceUsd: 0,
      remainingUsd: 0,
    };
  }

  const monthly = Number(data.monthly_allowance_usd ?? 0);
  const used = Number(data.used_this_cycle_usd ?? 0);
  const addon = Number(data.addon_balance_usd ?? 0);
  const unused = Math.max(0, monthly - used);

  return {
    enforced: true,
    monthlyAllowanceUsd: monthly,
    usedThisCycleUsd: used,
    addonBalanceUsd: addon,
    remainingUsd: unused + addon,
  };
}

/**
 * Gate a generation. Returns { allowed:false, reason } with a structured
 * "buy more tokens" message when the tenant has no remaining balance.
 * Not enforced (no balance row) → allowed. Super admins and agency admins
 * are never gated — platform operators must always be able to generate
 * regardless of balance.
 */
export async function checkTokenBalance(
  tenantId: string,
  role?: string | null
): Promise<BalanceCheckResult> {
  if (role === "super_admin" || role === "agency_admin") {
    return {
      allowed: true,
      balance: await getTokenBalance(tenantId),
    };
  }
  let balance = await getTokenBalance(tenantId);

  // Self-heal: a tenant created before balance provisioning (or before
  // migration 077) gets its row the first time it tries to generate.
  if (!balance.enforced && tenantId) {
    await ensureTenantBalance(tenantId);
    balance = await getTokenBalance(tenantId);
  }

  if (!billingGateActive()) {
    return { allowed: true, balance };
  }

  if (!balance.enforced) {
    // Enforcement is on but we could not read/provision a balance (table
    // missing, write denied). Fail closed: no balance means no spend.
    return {
      allowed: false,
      balance,
      reason:
        "Billing is unavailable for this workspace, so generation is paused. " +
        "Contact your administrator.",
    };
  }

  if (balance.remainingUsd > 0) {
    return { allowed: true, balance };
  }
  return {
    allowed: false,
    balance,
    reason:
      "Your monthly token allowance and add-on balance are used up. " +
      "Add tokens to keep generating.",
  };
}

// ---------------------------------------------------------------------------
// Stripe top-up support
// ---------------------------------------------------------------------------

/** Credit a purchased add-on pack to a tenant's prepaid balance + ledger. */
export async function creditAddonPurchase(
  tenantId: string,
  amountUsd: number,
  addonLabel: string
): Promise<void> {
  if (!amountUsd || amountUsd <= 0) return;
  const supabase = await createServiceClient();

  const { data: existing } = await supabase
    .from("tenant_balances")
    .select("addon_balance_usd")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("tenant_balances")
      .update({
        addon_balance_usd: Number(existing.addon_balance_usd ?? 0) + amountUsd,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId);
  } else {
    await supabase
      .from("tenant_balances")
      .insert({ tenant_id: tenantId, addon_balance_usd: amountUsd });
  }

  // Append-only ledger row so the super admin can see the purchase.
  await supabase.from("token_ledger").insert({
    tenant_id: tenantId,
    type: "purchase",
    unit_type: "usd",
    unit_qty: amountUsd,
    rate_usd: 1,
    total_usd: amountUsd,
    task: "token_addon",
    model_identifier: null,
  });
  console.log(`[token-billing] Add-on "${addonLabel}" ($${amountUsd}) credited to tenant ${tenantId}`);
}
