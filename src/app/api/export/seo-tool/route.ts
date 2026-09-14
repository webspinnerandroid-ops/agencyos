import { NextRequest, NextResponse } from "next/server";
import { authenticateMachineKey, hasScope } from "@/lib/agency/api-keys";
import { createServiceClient } from "@/lib/supabase/server";
import { record } from "@/lib/agency/ledger";

/**
 * GET /api/export/seo-tool?clientId=...&limit=20
 *
 * Emits the SeoToolExport JSON that FreeCMS's importer already consumes
 * (packages/importer/src/adapters.ts → mapSeoToolExport). This closes the
 * pipeline: agency-os SEO drafts → export → `freecms import` → client site.
 *
 * Auth: machine key with 'export' scope, tenant-scoped by the key.
 * Schema contract (must stay aligned with FreeCMS SeoToolExport):
 * {
 *   version: 1,
 *   contentType: "post",
 *   items: [{ title, slug?, date?, excerpt?, author?, tags?, category?,
 *             cover?: {url, alt?}, seo?: {...}, body: markdown-or-html }]
 * }
 */
export async function GET(request: NextRequest) {
  const ctx = await authenticateMachineKey(request.headers.get("authorization"));
  if (!ctx) {
    return NextResponse.json({ error: "Valid machine key required" }, { status: 401 });
  }
  if (!hasScope(ctx, "export")) {
    return NextResponse.json({ error: "export scope required" }, { status: 403 });
  }

  const supabase = await createServiceClient();
  const clientId = request.nextUrl.searchParams.get("clientId");
  const limit = Math.min(Number(request.nextUrl.searchParams.get("limit") ?? 20) || 20, 100);

  let query = supabase
    .from("posts")
    .select(
      "id, title, content, slug, excerpt, created_at, published_at, client_id, tenant_id, media_urls, metadata"
    )
    .eq("tenant_id", ctx.tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (clientId) query = query.eq("client_id", clientId);

  const { data: posts, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const items = (posts ?? []).map((p) => {
    const meta = (p.metadata ?? {}) as Record<string, unknown>;
    const seoMeta = (meta.seo ?? {}) as Record<string, unknown>;
    return {
      // FreeCMS SeoToolExport item shape:
      title: (p.title as string) ?? "Untitled",
      slug: (p.slug as string) ?? (p.id as string),
      date: (p.published_at as string) ?? (p.created_at as string),
      excerpt: (p.excerpt as string) ?? null,
      author: "Bliss Media Lab",
      tags: Array.isArray(meta.tags) ? (meta.tags as string[]) : [],
      category: (meta.category as string) ?? undefined,
      cover:
        Array.isArray(p.media_urls) && p.media_urls.length > 0
          ? { url: p.media_urls[0] as string }
          : undefined,
      seo: {
        title: (seoMeta.title as string) ?? undefined,
        metaDescription: (seoMeta.metaDescription ?? seoMeta.description) as string | undefined,
      },
      // Body: the platform stores markdown/JSON content; pass through as-is —
      // FreeCMS detects HTML vs markdown on its side (bodyIsHtml check).
      body:
        typeof p.content === "string"
          ? p.content
          : JSON.stringify(p.content ?? {}),
    };
  });

  await record({
    tenantId: ctx.tenantId,
    actor: { kind: "api", keyId: ctx.keyId },
    type: "content",
    summary: `SEO-tool export: ${items.length} posts${clientId ? ` for client ${clientId}` : ""}`,
    source: "api",
  });

  return NextResponse.json(
    { version: 1, contentType: "post", items },
    {
      headers: {
        "Content-Disposition": `attachment; filename="seo-tool-export-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    }
  );
}
