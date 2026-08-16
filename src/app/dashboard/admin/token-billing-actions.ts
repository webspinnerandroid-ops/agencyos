"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";

export interface ModelRate {
  model_identifier: string;
  input_per_1m_usd: number | null;
  output_per_1m_usd: number | null;
  asset_price_usd: number | null;
}

export interface TokenPlan {
  plan_id: string;
  label: string;
  monthly_token_allowance_usd: number;
}

export interface TokenAddon {
  id: string;
  label: string;
  price_usd: number;
  active: boolean;
  sort_order: number;
}

export interface TokenBillingData {
  rates: ModelRate[];
  plans: TokenPlan[];
  addons: TokenAddon[];
}

export interface SaveResult {
  ok: boolean;
  error?: string;
}

async function safeSelect(table: string): Promise<any[]> {
  try {
    const supabase = await createServiceClient();
    const { data, error } = await supabase.from(table).select("*");
    if (error) return [];
    return (data ?? []) as any[];
  } catch {
    // Tables don't exist until migration 077 — degrade to an empty list.
    return [];
  }
}

export async function getTokenBilling(): Promise<TokenBillingData> {
  const [rates, plans, addons] = await Promise.all([
    safeSelect("model_rates"),
    safeSelect("token_plans"),
    safeSelect("token_addons"),
  ]);
  return {
    rates: rates as ModelRate[],
    plans: (plans as TokenPlan[]).sort((a, b) => a.label.localeCompare(b.label)),
    addons: (addons as TokenAddon[]).sort((a, b) => a.sort_order - b.sort_order),
  };
}

const toNum = (s: string): number | null => {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

export async function saveModelRate(
  identifier: string,
  input: string,
  output: string,
  asset: string
): Promise<SaveResult> {
  try {
    const id = identifier.trim();
    if (!id) return { ok: false, error: "Model identifier is required." };
    const supabase = await createServiceClient();
    await supabase.from("model_rates").upsert({
      model_identifier: id,
      input_per_1m_usd: toNum(input),
      output_per_1m_usd: toNum(output),
      asset_price_usd: toNum(asset),
      updated_at: new Date().toISOString(),
    });
    revalidatePath("/dashboard/admin");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function deleteModelRate(identifier: string): Promise<SaveResult> {
  try {
    const supabase = await createServiceClient();
    await supabase.from("model_rates").delete().eq("model_identifier", identifier);
    revalidatePath("/dashboard/admin");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function savePlan(
  planId: string,
  label: string,
  allowance: string
): Promise<SaveResult> {
  try {
    const id = planId.trim();
    if (!id) return { ok: false, error: "Plan ID (Stripe price id) is required." };
    const supabase = await createServiceClient();
    await supabase.from("token_plans").upsert({
      plan_id: id,
      label: label.trim() || id,
      monthly_token_allowance_usd: toNum(allowance) ?? 0,
      updated_at: new Date().toISOString(),
    });
    revalidatePath("/dashboard/admin");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function deletePlan(planId: string): Promise<SaveResult> {
  try {
    const supabase = await createServiceClient();
    await supabase.from("token_plans").delete().eq("plan_id", planId);
    revalidatePath("/dashboard/admin");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function saveAddon(
  id: string | null,
  label: string,
  price: string,
  active: boolean
): Promise<SaveResult> {
  try {
    const priceUsd = Number(price);
    if (!Number.isFinite(priceUsd) || priceUsd < 20) {
      return { ok: false, error: "Add-on price must be at least $20 USD." };
    }
    const supabase = await createServiceClient();
    const row = { label: label.trim() || "Token add-on", price_usd: priceUsd, active };
    if (id) {
      await supabase.from("token_addons").update(row).eq("id", id);
    } else {
      await supabase.from("token_addons").insert(row);
    }
    revalidatePath("/dashboard/admin");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function deleteAddon(id: string): Promise<SaveResult> {
  try {
    const supabase = await createServiceClient();
    await supabase.from("token_addons").delete().eq("id", id);
    revalidatePath("/dashboard/admin");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
