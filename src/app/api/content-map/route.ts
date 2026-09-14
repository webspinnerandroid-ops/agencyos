import { NextRequest, NextResponse } from "next/server";
import { getTenantId, requireRole } from "@/lib/auth";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import { createServiceClient } from "@/lib/supabase/server";
import { rateLimitRequest } from "@/lib/rate-limit";
import { parseCsv, mapCsvRows } from "@/lib/content-map-import";
import { slugify } from "@/lib/cms";

export const maxDuration = 60;

/**
 * GET /api/content-map?clientId=…&status=…
 * The workspace's content map: items + a per-status summary for the page.
 */
export async function GET(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    await requireRole("agency_editor");
    const supabase = await createServiceClient();
    const workspaceId = await getCurrentWorkspaceId();

    const { searchParams } = request.nextUrl;
    const clientId = searchParams.get("clientId");
    const status = searchParams.get("status");

    let query = supabase
      .from("content_map_items")
      .select(
        "id, source_row, title, keywords, topic, content_type, platforms, external_links, scheduled_at, auto_publish, status, linked_post_id, gate, error, import_note, created_at, updated_at"
      )
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true });

    // Workspace isolation mirrors the posts page: bind the resolved
    // workspace, never list tenant-wide.
    if (workspaceId) {
      query = query.eq("workspace_id", workspaceId);
    } else {
      query = query.is("workspace_id", null);
    }
    if (clientId) query = query.eq("client_id", clientId);
    if (status) query = query.eq("status", status);

    const { data: items, error } = await query;
    if (error) {
      return NextResponse.json(
        { error: "Failed to load the content map", details: error.message },
        { status: 500 }
      );
    }

    const list = items ?? [];
    const summary = list.reduce<Record<string, number>>((acc, it) => {
      acc[it.status] = (acc[it.status] ?? 0) + 1;
      return acc;
    }, {});

    // Publishing history: every WordPress/social attempt for the rows'
    // linked drafts, so the map shows the full publish story per row.
    // Best-effort — an empty history never blocks the map.
    const linkedIds = list
      .map((it) => it.linked_post_id)
      .filter((id): id is string => Boolean(id));
    const history: Record<
      string,
      { platform: string; attemptAt: string; success: boolean; siteName: string | null; targetUrl: string | null; error: string | null }[]
    > = {};
    if (linkedIds.length > 0) {
      try {
        const { data: logs } = await supabase
          .from("publishing_logs")
          .select("post_id, platform, attempt_at, success, site_name, target_url, error_message")
          .in("post_id", linkedIds)
          .order("attempt_at", { ascending: false })
          .limit(500);
        for (const log of logs ?? []) {
          const arr = (history[log.post_id as string] ??= []);
          if (arr.length < 10) {
            arr.push({
              platform: log.platform as string,
              attemptAt: log.attempt_at as string,
              success: Boolean(log.success),
              siteName: (log.site_name as string | null) ?? null,
              targetUrl: (log.target_url as string | null) ?? null,
              error: (log.error_message as string | null) ?? null,
            });
          }
        }
      } catch {
        // history is garnish — never block the map on it
      }
    }

    // Linked drafts' hold state (migration 105): which drafts have a
    // 15-minute auto-publish hold armed, and each draft's status. Drives the
    // countdown + Cancel banner on the map rows.
    const linkedPosts: Record<
      string,
      { autoPublishAt: string | null; postStatus: string | null; scheduledAt: string | null }
    > = {};
    if (linkedIds.length > 0) {
      try {
        const { data: linkedRows } = await supabase
          .from("posts")
          .select("id, status, scheduled_at, auto_publish_at")
          .eq("tenant_id", tenantId)
          .in("id", linkedIds);
        for (const row of linkedRows ?? []) {
          linkedPosts[row.id as string] = {
            autoPublishAt: (row.auto_publish_at as string | null) ?? null,
            postStatus: (row.status as string | null) ?? null,
            scheduledAt: (row.scheduled_at as string | null) ?? null,
          };
        }
      } catch {
        // pre-migration-105 column → empty map; rows render without banners
      }
    }

    return NextResponse.json({ items: list, summary, history, linkedPosts });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/content-map  (multipart/form-data)
 *   file       — the CSV (Title, Keywords, Topic, Type, Platforms)
 *   clientId   — the client this map belongs to (optional)
 *   brandVoice — one brand voice applied to every row (optional)
 *
 * Parses and validates the whole file first; then stores the import record
 * and inserts every mappable row as a `planned` content_map_item. Nothing
 * is generated here — generation is explicit per item (or batch).
 */
export async function POST(request: NextRequest) {
  try {
    const rl = rateLimitRequest(request, "content-map-import", 10);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Rate limit exceeded. Try again in ${rl.retryAfterSeconds}s.` },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
      );
    }

    const tenantId = await getTenantId();
    await requireRole("agency_editor");
    const supabase = await createServiceClient();
    let workspaceId = await getCurrentWorkspaceId();

    const form = await request.formData();
    const file = form.get("file");
    const clientId = (form.get("clientId") as string | null) || null;
    const brandVoice = ((form.get("brandVoice") as string | null) ?? "").trim() || null;

    // When the map is for a specific client, the rows belong in THAT client's
    // workspace — not whichever workspace the user is currently browsing. This
    // is what makes "import Mike's year of ideas while browsing Decore
    // Hotels" land on Mike's map instead of silently vanishing into the wrong
    // workspace. Falls back to the current workspace for agency (no-client)
    // maps.
    if (clientId) {
      const { data: client } = await supabase
        .from("clients")
        .select("id, workspace_id, name")
        .eq("id", clientId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (!client) {
        return NextResponse.json({ error: "Client not found." }, { status: 400 });
      }
      if (client.workspace_id) {
        workspaceId = client.workspace_id;
      } else {
        // Client has no workspace yet — create + link one (same flow the
        // onboarding wizard uses) so the import never lands "nowhere".
        const base = slugify(client.name || "Client").slice(0, 40);
        const { data: ws, error: wsErr } = await supabase
          .from("workspaces")
          .insert({
            tenant_id: tenantId,
            name: client.name || "Client Workspace",
            slug: `${base}-${crypto.randomUUID().slice(0, 8)}`,
            is_default: false,
          })
          .select("id")
          .single();
        if (wsErr || !ws) {
          return NextResponse.json(
            { error: "Failed to create the client's workspace", details: wsErr?.message },
            { status: 500 }
          );
        }
        await supabase
          .from("clients")
          .update({ workspace_id: ws.id })
          .eq("id", clientId)
          .eq("tenant_id", tenantId);
        workspaceId = ws.id;
      }
    }

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Attach a CSV file in the `file` field." },
        { status: 400 }
      );
    }
    if (file.size > 2_000_000) {
      return NextResponse.json(
        { error: "CSV too large (2 MB max — that's well over a year of daily posts)." },
        { status: 400 }
      );
    }

    const text = await file.text();
    const parsed = parseCsv(text);
    if (parsed.header.length === 0) {
      return NextResponse.json(
        { error: "The file has no header row — expected columns like Title, Keywords, Topic." },
        { status: 400 }
      );
    }
    const { rows, skipped } = mapCsvRows(parsed);
    if (rows.length === 0) {
      return NextResponse.json(
        {
          error:
            "No usable rows — every data row needs a Title or a Topic. Expected columns: Title, Keywords, Topic, Type, Platforms.",
          skipped,
        },
        { status: 400 }
      );
    }

    // The import record: provenance + the map-level brand voice.
    const { data: importRow, error: importErr } = await supabase
      .from("content_map_imports")
      .insert({
        tenant_id: tenantId,
        workspace_id: workspaceId ?? null,
        client_id: clientId,
        brand_voice: brandVoice,
        filename: file.name,
        row_count: rows.length,
      })
      .select("id")
      .single();
    if (importErr || !importRow) {
      return NextResponse.json(
        { error: "Failed to save the import", details: importErr?.message },
        { status: 500 }
      );
    }

    const { data: inserted, error: itemsErr } = await supabase
      .from("content_map_items")
      .insert(
        rows.map((r) => ({
          tenant_id: tenantId,
          workspace_id: workspaceId ?? null,
          client_id: clientId,
          import_id: importRow.id,
          source_row: r.rowNumber,
          title: r.title.slice(0, 300),
          keywords: r.keywords.slice(0, 12),
          topic: r.topic.slice(0, 1000),
          content_type: r.contentType,
          platforms: r.platforms.slice(0, 6),
          external_links: r.externalLinks.slice(0, 5),
          // The CSV's suggested publish date (null when absent — optional).
          scheduled_at: r.scheduledAt,
          // Automation target from the CSV's "Auto Publish" column (null =
          // manual draft).
          auto_publish: r.autoPublish,
          import_note: r.importNote,
          status: "planned",
        }))
      )
      .select("id, source_row, title");

    if (itemsErr || !inserted) {
      return NextResponse.json(
        { error: "Failed to save the map items", details: itemsErr?.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      importId: importRow.id,
      imported: inserted.length,
      skipped,
      // Warnings keyed by source row so the UI can surface them inline.
      notes: rows
        .filter((r) => r.importNote)
        .map((r) => ({ row: r.rowNumber, note: r.importNote })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
