/**
 * Live model-catalog sync — keeps `ai_models` current with what each provider
 * actually serves TODAY.
 *
 * The seeded rows (migrations 003/009) are a 2025 snapshot: models retire,
 * get renamed, and new ones appear weekly. This module asks each provider's
 * LIST endpoint directly (the same API key the app already uses) and:
 *
 *   - upserts every model the provider reports (new models become available
 *     to pickers without a code change or migration),
 *   - flags models that disappeared from the list as `is_deprecated` (hidden
 *     from selectors but kept for history — never deleted),
 *   - stamps `last_verified_at` so the admin panel can show freshness.
 *
 * Providers without a known list endpoint (Midjourney, Leonardo, …) are
 * skipped, not failed. Runs from the twice-daily Inngest cron and from the
 * admin "Sync model catalogs" button (both via `syncModelCatalogs`).
 *
 * No new dependencies — every call is plain fetchWithTimeout + JSON.
 */
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { createClient } from "@supabase/supabase-js";

/** Providers whose catalogs we can enumerate. Everything else is skipped. */
const LIST_PROVIDERS = new Set([
  "OpenAI",
  "OpenAI Image",
  "OpenAI Embedding",
  "Anthropic",
  "Google",
  "Google Imagen",
  "DeepSeek",
  "Groq",
  "Together AI",
  "Fireworks",
  "Mistral",
  "Perplexity",
  "xAI",
  "OpenRouter",
]);

/** Env var holding the platform key for each listable provider. */
export function envKeyForProvider(name: string): string | null {
  const envMap: Record<string, string> = {
    DeepSeek: "DEEPSEEK_API_KEY",
    OpenAI: "OPENAI_API_KEY",
    "OpenAI Image": "OPENAI_API_KEY",
    "OpenAI Embedding": "OPENAI_API_KEY",
    Anthropic: "ANTHROPIC_API_KEY",
    Google: "GOOGLE_API_KEY",
    "Google Imagen": "GOOGLE_API_KEY",
    Groq: "GROQ_API_KEY",
    "Together AI": "TOGETHER_API_KEY",
    Fireworks: "FIREWORKS_API_KEY",
    Mistral: "MISTRAL_API_KEY",
    Perplexity: "PERPLEXITY_API_KEY",
    xAI: "XAI_API_KEY",
    OpenRouter: "OPENROUTER_API_KEY",
  };
  const envName = envMap[name];
  if (!envName) return null;
  const value = process.env[envName];
  return value ? value : null;
}

/** Per-provider model-id → app task tags (mirrors the migration seeds). */
export function tasksForModel(provider: string, id: string, meta: any): string[] {
  const tasks: string[] = [];
  const ctx = meta?.context_length ?? null;

  if (provider === "Google Imagen" || provider === "OpenAI Image") {
    return ["image_generation"];
  }
  if (provider === "Google" || provider === "Gemini") {
    // Gemini text models double as the image models for brand design.
    return ["blog_generation", "social_caption", "seo_audit", "seo_campaign_generation", "email_generation", "ad_copy", "image_generation"];
  }

  // OpenAI-compatible chat providers — decide from the model id.
  if (provider === "OpenAI") {
    if (/^gpt-5/.test(id)) {
      if (/nano/.test(id)) return ["social_caption", "email_generation", "ad_copy"];
      return ["blog_generation", "social_caption", "seo_audit", "seo_campaign_generation", "email_generation", "ad_copy"];
    }
    if (/^o\d/.test(id)) {
      // Deep-reasoning family (o1/o3/o4): audits, campaigns, long-form —
      // deliberately NOT the snappy short-copy tasks.
      return ["seo_audit", "seo_campaign_generation", "blog_generation"];
    }
    if (/^gpt-4/.test(id)) {
      return ["blog_generation", "social_caption", "seo_audit", "seo_campaign_generation", "email_generation", "ad_copy"];
    }
    if (/embed|whisper|tts|dall-e|image|realtime|moderation|audio/.test(id)) return [];
    if (/^gpt/.test(id)) {
      return ["blog_generation", "social_caption", "seo_audit", "seo_campaign_generation", "email_generation", "ad_copy"];
    }
    return [];
  }

  if (provider === "Anthropic") {
    if (/embed/.test(id)) return [];
    return ["blog_generation", "social_caption", "seo_audit", "seo_campaign_generation", "email_generation", "ad_copy"];
  }

  if (provider === "DeepSeek") {
    if (/embed|vision/i.test(id)) return [];
    // Reasoning-tier ids (deepseek-reasoner, deepseek-v4-pro, r1…) get the
    // deep-work set; chat-tier ids (deepseek-chat, deepseek-flash…) get
    // everything. Default is chat-tier — future ids keep working.
    if (/reasoner|\br\d|pro/i.test(id)) {
      return ["blog_generation", "seo_audit", "seo_campaign_generation"];
    }
    return ["blog_generation", "social_caption", "seo_audit", "seo_campaign_generation", "email_generation", "ad_copy"];
  }

  if (provider === "Groq") {
    if (/embed|guard|whisper|tts/.test(id)) return [];
    return ctx && ctx >= 100_000
      ? ["blog_generation", "social_caption", "seo_audit", "seo_campaign_generation"]
      : ["social_caption", "email_generation", "ad_copy"];
  }

  if (provider === "Together AI" || provider === "Fireworks") {
    if (/embed|whisper|tts|guard|vision/i.test(id)) return [];
    if (/Qwen|Llama|DeepSeek/i.test(id)) {
      return ctx && ctx >= 100_000
        ? ["blog_generation", "social_caption", "seo_audit", "seo_campaign_generation"]
        : ["social_caption", "email_generation", "ad_copy"];
    }
    return [];
  }

  if (provider === "Mistral") {
    if (/embed|moderation|ocr|audio/.test(id)) return [];
    return ["blog_generation", "social_caption", "seo_audit", "seo_campaign_generation"];
  }

  if (provider === "Perplexity") {
    if (/offline|online/.test(id)) return ["blog_generation", "seo_audit"];
    return [];
  }

  if (provider === "xAI") {
    if (/embed|vision|image/.test(id)) return [];
    return ["blog_generation", "social_caption", "seo_audit", "seo_campaign_generation"];
  }

  if (provider === "OpenRouter") {
    // Everything OpenRouter lists is chat-usable; text tasks only — image
    // generation there is a different (non-listed) endpoint. Utility
    // endpoints (embeddings, audio, speech, moderation) are excluded.
    if (/embed|whisper|tts|moderation|guard|clap|audio|speech|voice|asr/i.test(id)) return [];
    return ctx && ctx >= 100_000
      ? ["blog_generation", "social_caption", "seo_audit", "seo_campaign_generation"]
      : ["social_caption", "email_generation", "ad_copy"];
  }

  return tasks;
}

/** A model row is worth keeping when it maps to at least one app task. */
export function usable(provider: string, id: string, meta: any): boolean {
  return tasksForModel(provider, id, meta).length > 0;
}

export interface SyncResult {
  provider: string;
  ok: boolean;
  fetched: number;
  upserted: number;
  deprecated: number;
  error?: string;
}

function makeServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

/** Fetch the current model list from one provider. */
async function fetchProviderModels(
  providerName: string,
  baseUrl: string,
  apiKey: string
): Promise<{ id: string; meta: any }[]> {
  // Google's Gemini family uses its own listing shape; everything else is
  // OpenAI-style GET {base_url}/models with `data: [{ id, ... }]`.
  if (providerName === "Google" || providerName === "Google Imagen") {
    const res = await fetchWithTimeout(
      `${baseUrl}/models?key=${encodeURIComponent(apiKey)}&pageSize=1000`,
      {},
      20_000
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return (json.models ?? [])
      .map((m: any) => ({
        id: String(m.name ?? "").replace(/^models\//, ""),
        meta: { context_length: m.inputTokenLimit ?? null },
      }))
      .filter(({ id }: { id: string }) =>
        providerName === "Google Imagen"
          ? // Image provider: only true image models (Imagen + the Gemini
            // native-image variants). Everything else (gemma, tts, veo,
            // embeddings…) must never land on an image provider row.
            /^imagen-/.test(id) || /image/.test(id)
          : !/embedding|aqa|tts|veo/i.test(id)
      );
  }

  // OpenRouter's catalog is public — no Authorization header needed.
  const isPublicList = providerName === "OpenRouter";
  const res = await fetchWithTimeout(
    `${baseUrl}/models`,
    isPublicList ? {} : { headers: { Authorization: `Bearer ${apiKey}` } },
    20_000
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return (json.data ?? []).map((m: any) => ({
    id: String(m.id ?? m.model ?? ""),
    meta: { context_length: m.context_length ?? m.max_context_length ?? null },
  }));
}

/**
 * Sync every listable, key-configured provider. Returns one result per
 * provider attempted. Never throws — provider failures are reported, not
 * fatal, so one dead key can't block the rest of the catalog.
 */
export async function syncModelCatalogs(): Promise<{
  results: SyncResult[];
  syncedAt: string;
}> {
  const supabase = makeServiceClient();
  const { data: providers, error } = await supabase
    .from("ai_providers")
    .select("id, name, base_url");
  if (error) throw new Error(error.message);

  const results: SyncResult[] = [];
  const now = new Date().toISOString();

  for (const p of providers ?? []) {
    const name = p.name as string;
    if (!LIST_PROVIDERS.has(name)) continue;
    const apiKey = envKeyForProvider(name);
    // OpenRouter's catalog endpoint is public — it syncs with or without a
    // key, so a missing key is not a reason to skip it. Other providers need
    // their PLATFORM env key: the catalog is global (super-admin-owned), so
    // tenant-stored keys are deliberately not consulted here (tenant-api-key
    // access is tenant-scoped by design; see the isolation audit).
    if (!apiKey && name !== "OpenRouter") {
      results.push({
        provider: name,
        ok: false,
        fetched: 0,
        upserted: 0,
        deprecated: 0,
        error: "no API key configured",
      });
      continue;
    }

    try {
      if (!p.base_url) throw new Error("provider has no base_url");
      const remote = (
        await fetchProviderModels(name, p.base_url as string, apiKey ?? "")
      ).filter((m) => usable(name, m.id, m.meta));

      // Safety valve: an empty (or mapping-filtered-to-zero) list must never
      // run the vanish pass — that would deprecate the whole provider's
      // catalog off one bad response.
      if (remote.length === 0) {
        throw new Error(
          "provider returned no usable models — skipping to protect the catalog"
        );
      }

      // IDs already known for this provider (to detect vanishings).
      const { data: existing } = await supabase
        .from("ai_models")
        .select("id, model_identifier, is_deprecated")
        .eq("provider_id", p.id);
      const existingById = new Map(
        (existing ?? []).map((r: any) => [r.model_identifier as string, r])
      );

      // Upsert the live list. The provider's list is the source of truth:
      // a model present again is available (previous deprecation flags came
      // from older verifications, not humans — the admin toggle re-flags
      // until the next sync re-checks). Only VANISHED models stay flagged,
      // via the pass below.
      const rows = remote.map((m) => ({
        provider_id: p.id,
        model_identifier: m.id,
        supported_tasks: tasksForModel(name, m.id, m.meta),
        is_deprecated: false,
        last_verified_at: now,
      }));

      let upserted = 0;
      const CHUNK = 100;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { error: upErr } = await supabase
          .from("ai_models")
          .upsert(rows.slice(i, i + CHUNK), {
            onConflict: "provider_id,model_identifier",
          });
        if (upErr) throw new Error(upErr.message);
        upserted += rows.slice(i, i + CHUNK).length;
      }

      // Deprecate rows that vanished from the provider's live list.
      const remoteIds = new Set(remote.map((m) => m.id));
      const vanished = (existing ?? [])
        .filter(
          (r: any) =>
            r.is_deprecated !== true && !remoteIds.has(r.model_identifier)
        )
        .map((r: any) => r.id);
      if (vanished.length > 0) {
        const { error: depErr } = await supabase
          .from("ai_models")
          .update({ is_deprecated: true, last_verified_at: now })
          .in("id", vanished);
        if (depErr) throw new Error(depErr.message);
      }

      results.push({
        provider: name,
        ok: true,
        fetched: remote.length,
        upserted,
        deprecated: vanished.length,
      });
    } catch (e: any) {
      results.push({
        provider: name,
        ok: false,
        fetched: 0,
        upserted: 0,
        deprecated: 0,
        error: e?.message ?? "sync failed",
      });
    }
  }

  return { results, syncedAt: now };
}
