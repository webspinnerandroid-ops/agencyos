"use server";

import { createClient } from "@supabase/supabase-js";

/**
 * IndexNow auto-indexing.
 *
 * When content is published, we ping IndexNow (api.indexnow.org) so Bing,
 * Yandex, Seznam and their partners crawl it immediately instead of waiting
 * for the next sitemap pass. Each host (the platform domain or a mapped CMS
 * custom domain) has one key; the key file is served at /<key>.txt by the
 * route src/app/[key].txt/route.ts, which IndexNow requires for verification.
 */

const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
const KEY_CHARS = "abcdef0123456789";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export function generateKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let key = "";
  for (const b of bytes) key += KEY_CHARS[b % KEY_CHARS.length];
  return key;
}

/** Platform canonical host, e.g. platform.blissmedialab.com (no scheme/path). */
export function platformHost(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
}

/** Return the IndexNow key for a host, creating + storing one if missing. */
export async function ensureIndexNowKey(host: string): Promise<string | null> {
  const supabase = getAdminClient();
  const clean = host.toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!clean) return null;

  const { data: existing } = await supabase
    .from("indexnow_keys")
    .select("key")
    .eq("host", clean)
    .maybeSingle();
  if (existing?.key) return existing.key;

  const key = generateKey();
  const { data, error } = await supabase
    .from("indexnow_keys")
    .insert({ host: clean, key })
    .select("key")
    .single();
  if (error) {
    // Concurrent create — re-read.
    const { data: retry } = await supabase
      .from("indexnow_keys")
      .select("key")
      .eq("host", clean)
      .maybeSingle();
    return retry?.key ?? null;
  }
  return data?.key ?? null;
}

/** Look up the key for a host (for the /<key>.txt verification route). */
export async function getIndexNowKey(host: string): Promise<string | null> {
  const supabase = getAdminClient();
  const clean = host.toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!clean) return null;
  const { data } = await supabase
    .from("indexnow_keys")
    .select("key")
    .eq("host", clean)
    .maybeSingle();
  return data?.key ?? null;
}

/**
 * Submit URL paths to IndexNow for a host (e.g. ["/site/acme-landing"]).
 * Fire-and-forget: never throws — indexing is best-effort.
 */
export async function pingIndexNow(
  host: string,
  paths: string[],
  domainHint?: string
): Promise<{ ok: boolean; detail?: string }> {
  try {
    const clean = host.toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
    const key = await ensureIndexNowKey(clean);
    if (!key) return { ok: false, detail: "no key" };

    const urlList = paths
      .filter((p) => p && p.startsWith("/"))
      .map((p) => `https://${clean}${p}`);

    if (urlList.length === 0) return { ok: false, detail: "no urls" };

    const payload = {
      host: clean,
      key,
      keyLocation: `https://${clean}/${key}.txt`,
      urlList,
    };
    const res = await fetch(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, 200);
      return { ok: false, detail: `HTTP ${res.status}: ${body}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  }
}

/**
 * Ping every host that serves a CMS page: the platform domain plus any
 * custom domains mapped to the page's slug. Best-effort.
 */
export async function pingPagePublish(
  tenantId: string,
  slug: string
): Promise<{ ok: boolean; detail?: string }[]> {
  const hosts = [platformHost()];
  const supabase = getAdminClient();
  const { data: domains } = await supabase
    .from("site_domains")
    .select("domain")
    .eq("tenant_id", tenantId);
  for (const d of domains ?? []) {
    if (typeof d.domain === "string" && d.domain) hosts.push(d.domain);
  }
  const results: { ok: boolean; detail?: string }[] = [];
  for (const host of hosts) {
    results.push(await pingIndexNow(host, [`/site/${slug}`]));
  }
  return results;
}
