import { NextResponse } from "next/server";
import { getTenantId, requireRole } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { assertTenantOwner, tenantScopedClient } from "@/lib/supabase/tenant-scope";
import { rescoreCompetitorEntries } from "@/lib/seo/competitor-backfill";
import {
  discoverCompetitors,
  toCompetitorData,
} from "@/lib/seo/competitors";

/**
 * POST /api/seo/campaigns/[id]/re-run-audit
 *
 * Refreshes a past campaign's competitor SEO/AEO/GEO benchmark scores (re-fetch
 * + re-score each stored competitor) WITHOUT re-crawling the client's site or
 * regenerating the tier proposals. The client's own audit_json is untouched.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const tenantId = await getTenantId();
    await requireRole("agency_editor");

    const supabase = await createServiceClient();
    const scoped = tenantScopedClient(supabase, tenantId);

    const { data: campaign } = await scoped
      .from("seo_campaigns")
      .select("id, tenant_id, url, location, audit_json, competitors_json")
      .eq("id", id)
      .single();
    const owned = assertTenantOwner(campaign, tenantId, "Campaign");

    let competitors = Array.isArray(owned.competitors_json)
      ? owned.competitors_json
      : [];

    const audit = (owned.audit_json ?? {}) as any;
    const context = {
      url: audit.url ?? owned.url ?? "",
      homepageTitle: audit.homepage?.title ?? undefined,
      metaDescription: audit.homepage?.metaDescription ?? undefined,
      overallScore: audit.overallScore ?? undefined,
      location: owned.location ?? audit.location ?? null,
    };
    const host = (() => {
      try {
        return new URL(owned.url).hostname;
      } catch {
        return (owned.url ?? "").replace(/^https?:\/\//, "").split("/")[0] ?? "";
      }
    })();

    // If the campaign has no competitors yet, discover them first (industry +
    // location research), so "Re-run audit" also fills the benchmark — not just
    // refreshes scores for competitors that already exist.
    let discovered = 0;
    if (competitors.length === 0) {
      try {
        const urls = await discoverCompetitors(host, owned.tenant_id, context);
        if (urls.length > 0) {
          // Full pool — uncrawlable anchors are kept as notes, scored slots
          // are filled from crawlable backups.
          competitors = await toCompetitorData(urls, context);
          discovered = urls.length;
        }
      } catch (err: any) {
        console.warn("[re-run-audit] Competitor discovery failed:", err?.message);
      }
    }

    const { entries, scored, unreachable } = await rescoreCompetitorEntries(
      competitors
    );

    // Top-up: if the benchmark still has fewer than 5 measured competitors,
    // discover fresh candidates and append only the crawlable ones, so a
    // campaign never stays stuck at one score + a wall of dead domains.
    let added = 0;
    const scoredCount = entries.filter(
      (c) => c && typeof c.seoScore === "number"
    ).length;
    if (scoredCount < 5) {
      try {
        const fresh = await discoverCompetitors(host, owned.tenant_id, context);
        const existing = new Set(
          entries
            .map((c: any) => c.competitorUrl)
            .filter(Boolean)
            .map((u: string) => u.replace(/\/$/, "").toLowerCase())
        );
        const pool = fresh.filter(
          (u) => !existing.has(u.replace(/\/$/, "").toLowerCase())
        );
        if (pool.length > 0) {
          const additions = await toCompetitorData(pool, context, {
            maxScored: 5 - scoredCount,
            maxBackups: 10,
            keepNotes: false,
          });
          if (additions.length > 0) {
            entries.push(...(additions as unknown as typeof entries));
            added = additions.length;
          }
        }
      } catch (err: any) {
        console.warn("[re-run-audit] Top-up failed:", err?.message);
      }
    }

    const { error } = await scoped
      .from("seo_campaigns")
      .update({ competitors_json: entries })
      .eq("id", owned.id);
    if (error) throw error;

    return NextResponse.json({
      ok: true,
      competitors: entries,
      scored,
      unreachable,
      discovered,
      added,
    });
  } catch (err: any) {
    const status = /not found|No rows|Campaign/i.test(err?.message ?? "") ? 404 : 500;
    return NextResponse.json(
      { error: err?.message ?? "Failed to re-run audit" },
      { status }
    );
  }
}
