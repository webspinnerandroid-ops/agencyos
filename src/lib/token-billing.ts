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
 * Not enforced (no balance row) → allowed. Super admins are never gated —
 * the platform owner must always be able to generate regardless of balance.
 */
export async function checkTokenBalance(
  tenantId: string,
  role?: string | null
): Promise<BalanceCheckResult> {
  if (role === "super_admin") {
    return {
      allowed: true,
      balance: await getTokenBalance(tenantId),
    };
  }
  const balance = await getTokenBalance(tenantId);
  if (!balance.enforced) {
    return { allowed: true, balance };
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
