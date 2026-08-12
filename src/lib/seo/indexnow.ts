// indexnow.ts — best-effort search-engine indexing for published/edited content.
//
// IndexNow (https://www.indexnow.org) is the open protocol supported by Bing,
// Yandex, Seznam, Naver, and (via Bing's agreement) surfaced to Google. One
// HTTP GET per URL, keyed by a per-site key that must be exposed at
// https://<site>/{key}.txt.
//
// This module NEVER blocks the publish path: indexing is fire-and-forget, and
// every failure is logged and swallowed. If no key or site URL is configured,
// it no-ops silently — deployers opt in by setting:
//
//   INDEXNOW_KEY      — the key file name (e.g. "a1b2c3...")
//   PUBLIC_SITE_URL   — https://yourclientdomain.com (fallback: blog_platforms
//                       site_url, then clients.website)
//
// Google itself does not speak IndexNow; for Google coverage, a sitemap ping
// is included (google.com/ping) which at least nudges recrawl of the sitemap.

export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
export const GOOGLE_PING_ENDPOINT = "https://www.google.com/ping";

interface PingTarget {
  url: string;
  siteUrl: string; // scheme+host of the site the URL lives on
  key: string;
}

/** Normalize a site URL to scheme+host so key + URL live on the same origin. */
function normalizeSiteUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim();
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

function getKey(): string | null {
  const key = process.env.INDEXNOW_KEY?.trim();
  return key && key.length > 0 ? key : null;
}

function getConfiguredSiteUrl(): string | null {
  return normalizeSiteUrl(process.env.PUBLIC_SITE_URL);
}

/** Ping IndexNow for a set of absolute URLs. Returns per-endpoint results. */
export async function pingIndexNow(
  urls: string[],
  opts: { siteUrl?: string | null; key?: string | null } = {}
): Promise<{ ok: boolean; endpoint: string; error?: string }[]> {
  const unique = [...new Set(urls)].filter(Boolean);
  if (unique.length === 0) return [];

  const key = opts.key ?? getKey();
  const site = normalizeSiteUrl(opts.siteUrl ?? getConfiguredSiteUrl());
  if (!key || !site) {
    console.warn(
      "[indexnow] Skipped — set INDEXNOW_KEY and PUBLIC_SITE_URL (or blog_platforms site_url) to enable."
    );
    return [];
  }

  const results: { ok: boolean; endpoint: string; error?: string }[] = [];

  // IndexNow requires one request per URL (GET or POST; GET is simplest).
  for (const url of unique) {
    const target: PingTarget = { url, siteUrl: site, key };
    const qs = new URLSearchParams({
      url: target.url,
      key: target.key,
    });
    try {
      const res = await fetch(`${INDEXNOW_ENDPOINT}?${qs.toString()}`, {
        method: "GET",
        // Not critical if it's slow; give it a reasonable cap so a stalled
        // endpoint can't pile up request handlers.
        signal: AbortSignal.timeout(8000),
      });
      results.push({
        ok: res.ok || res.status === 202,
        endpoint: "indexnow",
        error: res.ok ? undefined : `HTTP ${res.status}`,
      });
    } catch (err) {
      results.push({
        ok: false,
        endpoint: "indexnow",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Nudge Google's recrawl of the sitemap too (IndexNow isn't consumed by
  // Google directly; this is a cheap extra signal when a sitemap exists).
  try {
    const sitemapUrl = `${site}/sitemap.xml`;
    const res = await fetch(
      `${GOOGLE_PING_ENDPOINT}?sitemap=${encodeURIComponent(sitemapUrl)}`,
      { method: "GET", signal: AbortSignal.timeout(8000) }
    );
    results.push({
      ok: res.ok,
      endpoint: "google-ping",
      error: res.ok ? undefined : `HTTP ${res.status}`,
    });
  } catch (err) {
    results.push({
      ok: false,
      endpoint: "google-ping",
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return results;
}

/**
 * Submit a post to IndexNow when it's published or edited. Resolves the
 * canonical URL from the post's content (blog slug) + the tenant's site URL
 * (blog_platforms.site_url, clients.website, or PUBLIC_SITE_URL). Never
 * throws — callers can fire-and-forget.
 */
export async function submitPostToIndexNow(input: {
  tenantId: string;
  siteUrl?: string | null; // resolved by caller (blog_platforms / client)
  content?: unknown; // posts.content — JSON with { slug, type }
}): Promise<{ ok: boolean; urls: string[]; error?: string }> {
  const key = getKey();
  const site = normalizeSiteUrl(input.siteUrl ?? getConfiguredSiteUrl());
  if (!key || !site) return { ok: false, urls: [] };

  const content = input.content as
    | { slug?: string; type?: string }
    | null
    | undefined;
  if (typeof content?.slug !== "string" || !content.slug) {
    return { ok: false, urls: [], error: "Post has no slug — nothing to index" };
  }

  const url = `${site}/${content.slug.replace(/^\/+/, "")}`;
  const results = await pingIndexNow([url], { siteUrl: site, key });
  const ok = results.some((r) => r.ok);
  return {
    ok,
    urls: [url],
    error: ok ? undefined : results.find((r) => !r.ok)?.error,
  };
}
