import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Super-admin: APIs & balances.
 *
 * GET  — list AI providers with connection status (env key / tenant keys) and
 *        the last-known balance from provider_balances.
 * POST — refresh balances: DeepSeek and OpenAI expose live balance endpoints;
 *        other providers stay "n/a" (checked best-effort). Also stores a
 *        low-balance threshold so the panel can flag providers running out.
 */

async function requireAdmin(): Promise<{ tenantId: string; supabase: any } | { error: string }> {
  const tenantId = await getTenantId();
  if (!tenantId) return { error: "Authentication required" };
  const supabase = await createServiceClient();
  const { data: roles } = await supabase
    .from("user_roles")
    .select("role")
    .eq("tenant_id", tenantId)
    .eq("user_id", tenantId);
  const isAdmin = (roles ?? []).some((r: any) => r.role === "super_admin");
  return isAdmin ? { tenantId, supabase } : { error: "Super admin access required" };
}

async function fetchBalance(providerName: string, apiKey: string): Promise<{ balance: number | null; currency: string | null }> {
  const name = providerName.toLowerCase();
  try {
    if (name.includes("deepseek")) {
      const res = await fetch("https://api.deepseek.com/user/balance", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) return { balance: null, currency: null };
      const data = await res.json();
      const b = data?.balance_infos?.[0]?.total_balance;
      return { balance: b != null ? Number(b) : null, currency: data?.balance_infos?.[0]?.currency ?? "USD" };
    }
    if (name.includes("openai")) {
      // Requires an org admin key; best-effort — fails cleanly otherwise.
      const res = await fetch("https://api.openai.com/v1/dashboard/billing/credit_grants", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) return { balance: null, currency: null };
      const data = await res.json();
      const total = Number(data?.total_granted ?? 0) - Number(data?.total_used ?? 0);
      return { balance: Number.isFinite(total) ? total : null, currency: "USD" };
    }
  } catch {
    // provider unreachable / key invalid — leave unknown
  }
  return { balance: null, currency: null };
}

export async function GET() {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: 403 });

    const { supabase } = auth;
    const [providers, balances, keyCounts] = await Promise.all([
      supabase.from("ai_providers").select("id, name, base_url, type").order("name"),
      supabase.from("provider_balances").select("provider_id, balance_usd, currency, low_threshold_usd, checked_at"),
      supabase.from("tenant_api_keys").select("provider_id"),
    ]);

    const balanceMap = new Map<string, any>((balances.data ?? []).map((b: any) => [b.provider_id, b]));
    const tenantKeyCount = new Map<string, number>();
    for (const k of (keyCounts.data ?? []) as any[]) {
      tenantKeyCount.set(k.provider_id, (tenantKeyCount.get(k.provider_id) ?? 0) + 1);
    }
    const envKeys = new Map<string, string>();
    if (process.env.OPENAI_API_KEY) envKeys.set("text", process.env.OPENAI_API_KEY);
    if (process.env.DEEPSEEK_API_KEY) envKeys.set("text", process.env.DEEPSEEK_API_KEY);
    if (process.env.GOOGLE_API_KEY) envKeys.set("image", process.env.GOOGLE_API_KEY);
    if (process.env.RUNWAY_API_KEY) envKeys.set("video", process.env.RUNWAY_API_KEY);
    if (process.env.FAL_AI_API_KEY) envKeys.set("video", process.env.FAL_AI_API_KEY);
    if (process.env.ELEVENLABS_API_KEY) envKeys.set("voice", process.env.ELEVENLABS_API_KEY);

    const list = (providers.data ?? []).map((p: any) => {
      const b = balanceMap.get(p.id);
      const envConnected = envKeys.has(p.type ?? "");
      const tenantKeys = tenantKeyCount.get(p.id) ?? 0;
      return {
        id: p.id,
        name: p.name,
        type: p.type,
        base_url: p.base_url,
        connected: envConnected || tenantKeys > 0,
        env_key: envConnected ? "configured" : undefined,
        tenant_key_count: tenantKeys,
        balance_usd: b?.balance_usd ?? null,
        currency: b?.currency ?? "USD",
        low_threshold_usd: b?.low_threshold_usd ?? 20,
        checked_at: b?.checked_at ?? null,
        low: b?.balance_usd != null && Number(b.balance_usd) < Number(b?.low_threshold_usd ?? 20),
      };
    });

    return NextResponse.json({ providers: list });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Internal error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: 403 });

    const { supabase } = auth;
    const body = (await request.json().catch(() => ({}))) as {
      refresh?: boolean;
      thresholds?: Record<string, number>;
    };

    // Update thresholds if provided.
    if (body.thresholds) {
      for (const [providerId, threshold] of Object.entries(body.thresholds)) {
        await supabase
          .from("provider_balances")
          .upsert({ provider_id: providerId, low_threshold_usd: threshold }, { onConflict: "provider_id" });
      }
    }

    const results: { provider: string; balance: number | null; currency: string | null }[] = [];
    if (body.refresh) {
      const [providers, keys] = await Promise.all([
        supabase.from("ai_providers").select("id, name, type"),
        supabase.from("tenant_api_keys").select("provider_id, encrypted_key, provider:ai_providers(name)"),
      ]);

      const envByType = new Map<string, string>();
      if (process.env.OPENAI_API_KEY) envByType.set("text", process.env.OPENAI_API_KEY);
      if (process.env.DEEPSEEK_API_KEY) envByType.set("text", process.env.DEEPSEEK_API_KEY);
      if (process.env.GOOGLE_API_KEY) envByType.set("image", process.env.GOOGLE_API_KEY);
      if (process.env.RUNWAY_API_KEY) envByType.set("video", process.env.RUNWAY_API_KEY);
      if (process.env.FAL_AI_API_KEY) envByType.set("video", process.env.FAL_AI_API_KEY);
      if (process.env.ELEVENLABS_API_KEY) envByType.set("voice", process.env.ELEVENLABS_API_KEY);

      for (const provider of (providers.data ?? []) as any[]) {
        const key = envByType.get(provider.type ?? "") ?? "";
        if (!key) continue;
        const { balance, currency } = await fetchBalance(provider.name, key);
        if (balance != null) {
          await supabase.from("provider_balances").upsert(
            {
              provider_id: provider.id,
              balance_usd: balance,
              currency: currency ?? "USD",
              checked_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
            { onConflict: "provider_id" }
          );
        }
        results.push({ provider: provider.name, balance, currency });
      }
    }

    return NextResponse.json({ results });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Internal error" }, { status: 500 });
  }
}
