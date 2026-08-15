import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import { createServiceClient } from "@/lib/supabase/server";
import { rewriteToPassGate } from "@/lib/seo/rewriter";
import { buildRankMathMeta, schemaPreview } from "@/lib/seo/rank-math-meta";

/**
 * POST /api/seo/rewrite
 * Body: { text, title?, keyword? }
 *
 * Rewrites pasted content so it clears the SEO/AEO/GEO quality gate (80/80
 * by default), returning the original + final scores and every attempt's
 * breakdown. The passing result is SAVED to site_audits (mode "text") so it
 * appears on the Monitored Sites dashboard like any other audit.
 */
export async function POST(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const workspaceId = await getCurrentWorkspaceId();
    const supabase = await createServiceClient();

    let body: { text?: string; title?: string; keyword?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const text = (body.text ?? "").trim();
    if (!text) {
      return NextResponse.json(
        { error: "Provide a piece of text content to rewrite." },
        { status: 400 }
      );
    }

    const result = await rewriteToPassGate(
      { text, title: body.title, keyword: body.keyword },
      { tenantId }
    );

    // Persist the final (rewritten) version so it shows up in Monitored Sites
    // and the rewrite history is queryable later.
    let savedAudit: Record<string, unknown> | null = null;
    const finalTitle = (result.final.title || result.title || "Rewritten content").slice(0, 300);
    const description = result.finalScores.seo != null ? finalTitle : "";

    const rankMath = buildRankMathMeta({
      title: finalTitle,
      metaDescription: description,
      focusKeyword: result.keyword,
      qaPairs: result.final.aeoGeo?.qaPairs,
      slug: "",
      body: result.finalBody,
    });

    const failed = [
      ...(result.final.seo?.checks ?? []),
      ...(result.final.aeoGeo?.checks ?? []),
    ].filter((c) => !c.passed).length;

    const { data, error } = await supabase
      .from("site_audits")
      .insert({
        tenant_id: tenantId,
        workspace_id: workspaceId,
        mode: "text",
        url: null,
        title: finalTitle,
        keyword: result.keyword,
        seo_score: result.final.seo?.total ?? null,
        aeo_score: result.final.aeoGeo?.aeoScore ?? null,
        geo_score: result.final.aeoGeo?.geoSscore ?? null,
        word_count: result.final.seo?.wordCount ?? 0,
        issues: failed,
        checks_json: {
          seo: result.final.seo?.checks ?? [],
          aeoGeo: result.final.aeoGeo?.checks ?? [],
        },
        meta: {
          kind: "rewrite",
          original_score_seo: result.originalScores.seo,
          original_score_aeo_geo: result.originalScores.aeoGeo,
          attempts: result.attempts.length,
          passed: result.passed,
          rankMath: rankMath.meta,
          schemaPreview: schemaPreview({
            title: finalTitle,
            metaDescription: description,
            focusKeyword: result.keyword,
            qaPairs: result.final.aeoGeo?.qaPairs,
            body: result.finalBody,
          }),
        },
      })
      .select("id, created_at")
      .single();
    if (error) {
      console.warn("[seo/rewrite] save failed:", error.message);
    } else {
      savedAudit = data;
    }

    return NextResponse.json({
      success: true,
      saved: !!savedAudit,
      savedAudit,
      // Text audits appear in the Monitored Sites list (detail view matches
      // URL rows only), so the saved link points at the list where it shows.
      dashboardUrl: savedAudit ? "/dashboard/seo/sites" : "/dashboard/seo/sites",
      ...result,
      // The rewritten body is the deliverable.
      rewrittenBody: result.finalBody,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Rewrite failed";
    if (message.includes("Provide a piece of text")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error("[seo/rewrite]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
