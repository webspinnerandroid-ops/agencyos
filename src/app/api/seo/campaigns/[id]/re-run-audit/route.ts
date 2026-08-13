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

    // If the campaign has no competitors yet, discover them first (industry +
    // location research), so "Re-run audit" also fills the benchmark — not just
    // refreshes scores for competitors that already exist.
    let discovered = 0;
    if (competitors.length === 0) {
      try {
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
        const urls = await discoverCompetitors(host, owned.tenant_id, context);
        if (urls.length > 0) {
          competitors = await toCompetitorData(urls.slice(0, 5), context);
          discovered = urls.length;
        }
      } catch (err: any) {
        console.warn("[re-run-audit] Competitor discovery failed:", err?.message);
      }
    }

    const { entries, scored, unreachable } = await rescoreCompetitorEntries(
      competitors
    );

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
    });
  } catch (err: any) {
    const status = /not found|No rows|Campaign/i.test(err?.message ?? "") ? 404 : 500;
    return NextResponse.json(
      { error: err?.message ?? "Failed to re-run audit" },
      { status }
    );
  }
}
