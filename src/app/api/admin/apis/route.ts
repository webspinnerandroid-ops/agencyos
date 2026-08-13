import { NextRequest, NextResponse } from "next/server";
import { getTenantId, getUserId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Super-admin: APIs & balances.
 *
 * GET  — list ONLY the AI providers that are actually configured (a platform
 *        env key for that provider, or tenant-stored keys). Providers with no
 *        key are omitted entirely — the panel never guesses about connections
 *        it can't see. Each row carries an honest `balance_note` explaining
 *        whether a live balance exists for that provider.
 * POST — refresh balances for configured providers only, using each
 *        provider's OWN env key (never a type-collapsed guess). Only
 *        providers with a real billing endpoint get a number; the rest state
 *        why instead of showing nothing.
 */

async function requireAdmin(): Promise<{ tenantId: string; supabase: any } | { error: string }> {
  const tenantId = await getTenantId();
  if (!tenantId) return { error: "Authentication required" };
  const userId = await getUserId();
  if (!userId) return { error: "Authentication required" };
  const supabase = await createServiceClient();
  const { data: roles } = await supabase
    .from("user_roles")
    .select("role")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId);
  const isAdmin = (roles ?? []).some((r: any) => r.role === "super_admin");
  return isAdmin ? { tenantId, supabase } : { error: "Super admin access required" };
}

/**
 * The platform env key for each provider. A provider is only "configured"
 * when its own key is set (or a tenant has stored one) — two providers of the
 * same type must never share one key's status.
 */
export function envKeyByProviderName(): Record<string, string> {
  return {
    DeepSeek: process.env.DEEPSEEK_API_KEY ?? "",
    OpenAI: process.env.OPENAI_API_KEY ?? "",
    "OpenAI Image": process.env.OPENAI_API_KEY ?? "",
    "OpenAI Embedding": process.env.OPENAI_API_KEY ?? "",
    Google: process.env.GOOGLE_API_KEY ?? "",
    "Google Imagen": process.env.GOOGLE_API_KEY ?? "",
    Runway: process.env.RUNWAY_API_KEY ?? "",
    "fal.ai": process.env.FAL_AI_API_KEY ?? "",
    "Alibaba Wan": process.env.DASHSCOPE_API_KEY ?? process.env.WAN_API_KEY ?? "",
    ElevenLabs: process.env.ELEVENLABS_API_KEY ?? "",
    "Stability AI": process.env.STABILITY_API_KEY ?? "",
  };
}

/**
 * Honest description of whether a live balance exists for a provider. No
 * fabricated numbers — OpenAI/Google/Runway/etc. don't expose balances to an
 * API key, and the panel says so next to the provider name.
 */
export function balanceNoteFor(providerName: string): string {
  const name = providerName.toLowerCase();
  if (name.includes("fal")) return "Live credit balance via fal.ai billing API";
  if (name.includes("deepseek"))
    return "Live balance via DeepSeek billing API (org admin key)";
  if (name.includes("openai"))
    return "No balance endpoint via API key — see platform.openai.com/usage";
  if (name.includes("google"))
    return "No balance endpoint via API key — see console.cloud.google.com";
  if (name.includes("runway"))
    return "No balance endpoint — track in the Runway dashboard";
  if (name.includes("elevenlabs"))
    return "No balance endpoint — track in the ElevenLabs dashboard";
  if (name.includes("stability"))
    return "No balance endpoint — track in the Stability dashboard";
  if (name.includes("wan") || name.includes("dashscope") || name.includes("alibaba"))
    return "No balance endpoint via API key — track in the provider portal";
  return "No balance endpoint — track in the provider portal";
}

/** Providers that expose a real billing/balance endpoint to a key. */
export function hasLiveBalanceApi(providerName: string): boolean {
  const name = providerName.toLowerCase();
  return name.includes("fal") || name.includes("deepseek");
}

async function fetchBalance(
  providerName: string,
  apiKey: string
): Promise<{ balance: number | null; currency: string | null }> {
  const name = providerName.toLowerCase();
  try {
    if (name.includes("deepseek")) {
      const res = await fetch("https://api.deepseek.com/user/balance", {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return { balance: null, currency: null };
      const data = await res.json();
      const b = data?.balance_infos?.[0]?.total_balance;
      return { balance: b != null ? Number(b) : null, currency: data?.balance_infos?.[0]?.currency ?? "USD" };
    }
    if (name.includes("fal")) {
      const res = await fetch("https://api.fal.ai/v1/account/billing?expand=credits", {
        headers: { Authorization: `Key ${apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return { balance: null, currency: null };
      const data = await res.json();
      const b = Number(data?.credits?.current_balance);
      return { balance: Number.isFinite(b) ? b : null, currency: data?.credits?.currency ?? "USD" };
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
    const envKeyByProvider = envKeyByProviderName();

    // ONLY providers that are actually configured: a platform env key for that
    // provider OR tenant-stored keys. Everything else is omitted.
    const list = (providers.data ?? [])
      .filter((p: any) => Boolean(envKeyByProvider[p.name]) || (tenantKeyCount.get(p.id) ?? 0) > 0)
      .map((p: any) => {
        const b = balanceMap.get(p.id);
        const envKey = envKeyByProvider[p.name] ?? "";
        const tenantKeys = tenantKeyCount.get(p.id) ?? 0;
        const balance = b?.balance_usd ?? null;
        return {
          id: p.id,
          name: p.name,
          type: p.type,
          base_url: p.base_url,
          connected: true, // only configured providers are listed
          env_key: envKey ? "configured" : undefined,
          tenant_key_count: tenantKeys,
          balance_usd: balance,
          currency: b?.currency ?? "USD",
          balance_note: balanceNoteFor(p.name),
          low_threshold_usd: b?.low_threshold_usd ?? 20,
          checked_at: b?.checked_at ?? null,
          low: balance != null && Number(balance) < Number(b?.low_threshold_usd ?? 20),
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

    const results: {
      provider: string;
      balance: number | null;
      currency: string | null;
      note?: string;
    }[] = [];
    if (body.refresh) {
      const [providers, keys] = await Promise.all([
        supabase.from("ai_providers").select("id, name, type"),
        supabase.from("tenant_api_keys").select("provider_id"),
      ]);
      const tenantKeyed = new Set<string>((keys.data ?? []).map((k: any) => k.provider_id));
      const envKeyByProvider = envKeyByProviderName();

      // Per-provider key, configured providers only — no type-collapsed guess.
      for (const provider of (providers.data ?? []) as any[]) {
        const key = envKeyByProvider[provider.name] ?? "";
        const hasKey = Boolean(key) || tenantKeyed.has(provider.id);
        if (!hasKey) continue;
        const note = balanceNoteFor(provider.name);
        // A tenant-stored key is encrypted and unusable for platform balance
        // checks — only a platform env key can be queried here.
        if (!key || !hasLiveBalanceApi(provider.name)) {
          results.push({ provider: provider.name, balance: null, currency: null, note });
          continue;
        }
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
        results.push({ provider: provider.name, balance, currency, note });
      }
    }

    return NextResponse.json({ results });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Internal error" }, { status: 500 });
  }
}
