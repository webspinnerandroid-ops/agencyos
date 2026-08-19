import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import { createServiceClient } from "@/lib/supabase/server";
import { rewriteToPassGate } from "@/lib/seo/rewriter";
import { buildWpSeoMeta, schemaPreview } from "@/lib/seo/wp-seo-meta";

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

    let body: {
      text?: string;
      title?: string;
      keyword?: string;
      instructions?: string;
      targeted?: boolean;
    };
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
      {
        text,
        title: body.title,
        keyword: body.keyword,
        instructions: body.instructions,
        targeted: body.targeted,
      },
      { tenantId }
    );

    // Persist the final (rewritten) version so it shows up in Monitored Sites
    // and the rewrite history is queryable later.
    let savedAudit: Record<string, unknown> | null = null;
    const finalTitle = (result.final.title || result.title || "Rewritten content").slice(0, 300);
    const description = result.finalScores.seo != null ? finalTitle : "";

    const seoMeta = buildWpSeoMeta({
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
          original_score_aeo: result.original.aeoGeo?.aeoScore ?? null,
          original_score_geo: result.original.aeoGeo?.geoSscore ?? null,
          original_checks_json: {
            seo: result.original.seo?.checks ?? [],
            aeoGeo: result.original.aeoGeo?.checks ?? [],
          },
          final_score_aeo: result.final.aeoGeo?.aeoScore ?? null,
          final_score_geo: result.final.aeoGeo?.geoSscore ?? null,
          attempts: result.attempts.length,
          passed: result.passed,
          keyword: result.keyword,
          originalTitle: (result.original.title || "").slice(0, 300),
          originalBody: result.originalBody.slice(0, 60000),
          rewrittenBody: result.finalBody.slice(0, 60000),
          seoMeta: seoMeta.meta,
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

    // ALSO save the rewrite as a draft blog post so it shows up in Recent
    // Content and gets the exact same publish flow as generated content
    // (PublishButton → WordPress / CMS / schedule).
    let savedPostId: string | null = null;
    const { data: postRow, error: postError } = await supabase
      .from("posts")
      .insert({
        tenant_id: tenantId,
        client_id: null,
        content: {
          type: "blog",
          title: finalTitle,
          metaDescription: description,
          body: result.finalBody,
          keyword: result.keyword,
          // Canonical score shape (score key) so the DB trigger syncs
          // seo_score / aeo_geo_score columns and the UI's score resolver
          // picks it up — same shape the manual generator and AI team write.
          // `total` kept for back-compat with the rewrite response display.
          seo: {
            score: result.final.seo?.total ?? null,
            total: result.final.seo?.total ?? null,
            grade: result.final.seo?.grade ?? null,
            keyword: result.keyword,
            wordCount: result.final.seo?.wordCount ?? 0,
            checks: result.final.seo?.checks ?? [],
          },
          aeoGeo: {
            score: result.final.aeoGeo?.total ?? null,
            total: result.final.aeoGeo?.total ?? null,
            aeoScore: result.final.aeoGeo?.aeoScore ?? null,
            geoSscore: result.final.aeoGeo?.geoSscore ?? null,
            grade: result.final.aeoGeo?.grade ?? null,
            checks: result.final.aeoGeo?.checks ?? [],
            qaPairs: result.final.aeoGeo?.qaPairs ?? [],
          },
          rewrite: {
            kind: "rewrite",
            original_seo: result.originalScores.seo,
            original_aeo_geo: result.originalScores.aeoGeo,
            original_aeo: result.original.aeoGeo?.aeoScore ?? null,
            original_geo: result.original.aeoGeo?.geoSscore ?? null,
            passed: result.passed,
            gate: result.gate,
            originalBody: result.originalBody.slice(0, 60000),
            attempts: result.attempts.length,
          },
        },
        type: "blog",
        title: finalTitle,
        status: "draft",
        ai_generated: true,
        seo_score: result.final.seo?.total ?? null,
        aeo_geo_score: result.final.aeoGeo?.total ?? null,
      })
      .select("id")
      .single();
    if (postError) {
      console.warn("[seo/rewrite] post save failed:", postError.message);
    } else if (postRow) {
      savedPostId = postRow.id;
    }

    // Point the saved link at the specific saved rewrite so the user can
    // revisit, copy, edit, and re-compare it later.
    const detailUrl = `/dashboard/seo/sites?url=${encodeURIComponent(`text:${finalTitle}`)}`;
    const postsUrl = savedPostId ? `/dashboard/posts?open=${savedPostId}` : "/dashboard/posts";

    return NextResponse.json({
      success: true,
      saved: !!savedAudit,
      savedAudit,
      savedPostId,
      postsUrl,
      dashboardUrl: detailUrl,
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
