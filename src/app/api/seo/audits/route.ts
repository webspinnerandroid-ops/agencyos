import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import { createServiceClient } from "@/lib/supabase/server";
import { analyzeContent, type AnalyzeResult } from "@/lib/seo/analyzer";

/**
 * Saved site audits — the dashboard behind "monitor a URL".
 *
 * POST /api/seo/audits
 *   { url?, text?, title?, keyword? }  — run the analyzer and persist the run.
 *   Returns { audit, result }.
 *
 * GET /api/seo/audits
 *   Returns the monitored-sites list: the LATEST audit per URL for this
 *   tenant/workspace, plus audit count + last-audited time. Query params:
 *     search   — substring match on url/title
 *     url      — when set, returns the full history for that single site
 *                (all runs, newest first) plus matched GA4/SC traffic rows
 *                from traffic_snapshots for the same domain.
 */
export async function GET(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const workspaceId = await getCurrentWorkspaceId();
    const supabase = await createServiceClient();

    const search = request.nextUrl.searchParams.get("search")?.trim() ?? "";
    const url = request.nextUrl.searchParams.get("url")?.trim() ?? "";

    let query = supabase
      .from("site_audits")
      .select("id, mode, url, title, keyword, seo_score, aeo_score, geo_score, word_count, issues, checks_json, fetched, fetch_error, created_at, workspace_id")
      .eq("tenant_id", tenantId);

    if (workspaceId) {
      // Same model as /api/clients: legacy tenant-wide rows appear in every
      // workspace view, alongside rows scoped to the current workspace.
      query = query.or(`workspace_id.is.null,workspace_id.eq.${workspaceId}`);
    }

    // Single-site history mode.
    if (url) {
      const { data, error } = await query
        .eq("url", url)
        .order("created_at", { ascending: false });
      if (error) throw error;

      const traffic = await fetchMatchedTraffic(supabase, tenantId, url);
      const keywords = await fetchMatchedKeywords(supabase, tenantId, url);
      return NextResponse.json({ audits: data ?? [], traffic, keywords });
    }

    if (search) {
      query = query.or(`url.ilike.%${search}%,title.ilike.%${search}%`);
    }

    const { data, error } = await query
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw error;

    // Latest-per-URL, preserving newest-first order.
    const seen = new Map<string, typeof data[number]>();
    const counts = new Map<string, number>();
    for (const row of data ?? []) {
      const key = row.url ?? `text:${row.title}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (!seen.has(key)) seen.set(key, row);
    }
    const sites = [...seen.values()].map((row) => {
      const key = row.url ?? `text:${row.title}`;
      return {
        key,
        mode: row.mode,
        url: row.url,
        title: row.title,
        keyword: row.keyword,
        seoScore: row.seo_score,
        aeoScore: row.aeo_score,
        geoScore: row.geo_score,
        issues: row.issues,
        fetched: row.fetched,
        fetchError: row.fetch_error,
        lastAuditedAt: row.created_at,
        auditCount: counts.get(key) ?? 1,
      };
    });

    return NextResponse.json({ sites });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load audits";
    console.error("[seo/audits GET]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const workspaceId = await getCurrentWorkspaceId();
    const supabase = await createServiceClient();

    let body: {
      url?: string;
      text?: string;
      title?: string;
      keyword?: string;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body." },
        { status: 400 }
      );
    }

    const hasUrl = typeof body.url === "string" && body.url.trim().length > 0;
    const hasText = typeof body.text === "string" && body.text.trim().length > 0;
    if (!hasUrl && !hasText) {
      return NextResponse.json(
        { error: "Provide a URL or a piece of text content to audit." },
        { status: 400 }
      );
    }
    if (hasUrl && hasText) {
      return NextResponse.json(
        { error: "Provide either a URL or text, not both." },
        { status: 400 }
      );
    }

    const result: AnalyzeResult = await analyzeContent(body);
    const failed = [
      ...(result.seo?.checks ?? []),
      ...(result.aeoGeo?.checks ?? []),
    ].filter((c) => !c.passed).length;

    const { data: audit, error } = await supabase
      .from("site_audits")
      .insert({
        tenant_id: tenantId,
        workspace_id: workspaceId,
        mode: result.mode,
        url: result.url ?? null,
        title: result.title.slice(0, 300),
        keyword: result.keyword,
        seo_score: result.seo?.total ?? null,
        aeo_score: result.aeoGeo?.aeoScore ?? null,
        geo_score: result.aeoGeo?.geoSscore ?? null,
        word_count: result.wordCount,
        issues: failed,
        checks_json: {
          seo: result.seo?.checks ?? [],
          aeoGeo: result.aeoGeo?.checks ?? [],
        },
        fetched: result.fetched ?? null,
        fetch_error: result.fetchError?.slice(0, 500) ?? null,
      })
      .select("id, mode, url, title, keyword, seo_score, aeo_score, geo_score, word_count, issues, fetched, fetch_error, created_at")
      .single();

    if (error) throw error;

    return NextResponse.json({ audit, result }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Audit failed";
    if (message.includes("Provide a URL")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error("[seo/audits POST]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Hostname (without scheme/www) for a URL or a SC resource like "sc-domain:example.com". */
function domainOf(value: string): string {
  const s = (value || "").trim();
  let host = s;
  try {
    host = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`).hostname;
  } catch {
    host = s.replace(/^sc-domain:/i, "").replace(/^https?:\/\//i, "").split("/")[0] ?? s;
  }
  return host.replace(/^www\./, "").toLowerCase();
}

/** Pull measured SC keyword rankings whose resource matches the site's domain. */
async function fetchMatchedKeywords(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  tenantId: string,
  url: string
): Promise<{
  query: string;
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
  position: number | null;
}[]> {
  const siteDomain = domainOf(url);
  const { data, error } = await supabase
    .from("keyword_rankings")
    .select("query, clicks, impressions, ctr, position, resource")
    .eq("tenant_id", tenantId)
    .limit(2000);
  if (error || !data) return [];
  return data
    .filter((r) => domainOf(String(r.resource)) === siteDomain)
    .map((r) => ({
      query: r.query ?? "",
      clicks: r.clicks ?? null,
      impressions: r.impressions ?? null,
      ctr: r.ctr ?? null,
      position: r.position ?? null,
    }))
    .sort((a, b) => (b.clicks ?? 0) - (a.clicks ?? 0))
    .slice(0, 25);
}

/** Pull the latest GA4 + Search Console traffic rows whose resource matches the site's domain. */
async function fetchMatchedTraffic(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  tenantId: string,
  url: string
): Promise<{ googleAnalytics: unknown[]; searchConsole: unknown[] }> {
  const siteDomain = domainOf(url);
  const { data, error } = await supabase
    .from("traffic_snapshots")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("metric_date", { ascending: false })
    .limit(400);
  if (error || !data) return { googleAnalytics: [], searchConsole: [] };

  const googleAnalytics = data
    .filter((r) => r.provider === "google_analytics")
    .slice(0, 60);
  const searchConsole = data
    .filter(
      (r) => r.provider === "search_console" && domainOf(String(r.resource)) === siteDomain
    )
    .slice(0, 60);
  return { googleAnalytics, searchConsole };
}
