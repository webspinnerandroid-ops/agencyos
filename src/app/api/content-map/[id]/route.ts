import { NextRequest, NextResponse } from "next/server";
import { getTenantId, requireRole } from "@/lib/auth";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import { createServiceClient } from "@/lib/supabase/server";
import { cancelAutoPublish } from "@/lib/content-map-autopublish";

/**
 * PATCH /api/content-map/:id
 *   { action: "link",   postId, seo, aeoGeo, gate } — record a generated post
 *   { action: "dismiss" }                           — hide from the default view
 *   { action: "restore" }                           — back to planned
 * DELETE /api/content-map/:id — remove the row
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = await getTenantId();
    await requireRole("agency_editor");
    const supabase = await createServiceClient();
    const workspaceId = await getCurrentWorkspaceId();

    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      postId?: string;
      seo?: number | null;
      aeoGeo?: number | null;
      gate?: unknown;
      /** ISO datetime — the row's planned publish slot (date picker). */
      scheduledAt?: string | null;
      /** Inline row editor: the row's real fields. */
      title?: string;
      topic?: string;
      keywords?: string[];
      /** Generation mode: 'gate' (default, scored) or 'fiction' (no gate). */
      mode?: string;
    };

    // Inline row editing (bulk editor): update the row's title/topic/keywords
    // so placeholder rows can be given real topics before generating. Partial
    // — only the provided fields change. Strings are trimmed and capped to
    // mirror the import caps.
    if (!body.action && (body.title !== undefined || body.topic !== undefined || body.keywords !== undefined || body.mode !== undefined)) {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (body.title !== undefined) {
        const t = body.title.trim().slice(0, 300);
        if (!t) {
          return NextResponse.json({ error: "Title cannot be empty." }, { status: 400 });
        }
        patch.title = t;
      }
      if (body.topic !== undefined) {
        patch.topic = body.topic.trim().slice(0, 1000);
      }
      if (body.keywords !== undefined) {
        if (!Array.isArray(body.keywords)) {
          return NextResponse.json({ error: "keywords must be an array of strings." }, { status: 400 });
        }
        patch.keywords = body.keywords
          .map((k) => String(k).trim())
          .filter(Boolean)
          .slice(0, 12);
      }
      if (body.mode !== undefined) {
        // Row mode: only two legal values — gate (default, scored) or
        // fiction (creative stories, skips the gate by design).
        const m = String(body.mode).toLowerCase();
        if (m !== "gate" && m !== "fiction") {
          return NextResponse.json(
            { error: "mode must be 'gate' or 'fiction'." },
            { status: 400 }
          );
        }
        patch.mode = m;
      }
      const { error } = await supabase
        .from("content_map_items")
        .update(patch)
        .eq("tenant_id", tenantId)
        .eq("id", id);
      if (error) {
        return NextResponse.json(
          { error: "Failed to update the item", details: error.message },
          { status: 500 }
        );
      }
      return NextResponse.json({ success: true });
    }

    // Scheduling a row: set/clear its planned publish time. Works on any row
    // regardless of status (plan the date before or after generating).
    if (body.scheduledAt !== undefined && !body.action) {
      const iso =
        body.scheduledAt === null
          ? null
          : (() => {
              const d = new Date(body.scheduledAt as string);
              return isNaN(d.getTime()) ? undefined : d.toISOString();
            })();
      if (body.scheduledAt !== null && iso === undefined) {
        return NextResponse.json(
          { error: "scheduledAt must be an ISO datetime or null" },
          { status: 400 }
        );
      }
      const { error } = await supabase
        .from("content_map_items")
        .update({ scheduled_at: iso, updated_at: new Date().toISOString() })
        .eq("tenant_id", tenantId)
        .eq("id", id);
      if (error) {
        return NextResponse.json(
          { error: "Failed to schedule the item", details: error.message },
          { status: 500 }
        );
      }
      return NextResponse.json({ success: true, scheduledAt: iso });
    }

    // Scope: tenant + workspace (mirror the posts-page isolation).
    const scoped = () => {
      let query = supabase.from("content_map_items").select("id").eq("tenant_id", tenantId);
      if (workspaceId) query = query.eq("workspace_id", workspaceId);
      else query = query.is("workspace_id", null);
      return query;
    };
    // The item must exist inside this tenant + workspace before any action.
    const { data: owned } = await scoped().eq("id", id).maybeSingle();
    if (!owned) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }

    // Cancel the 15-minute auto-publish hold on this row's linked draft.
    // The draft is kept (status stays draft) — only the automation stops.
    if (body.action === "cancel_auto_publish") {
      const { data: row } = await supabase
        .from("content_map_items")
        .select("linked_post_id")
        .eq("tenant_id", tenantId)
        .eq("id", id)
        .maybeSingle();
      if (!row?.linked_post_id) {
        return NextResponse.json(
          { error: "This row has no linked draft to cancel." },
          { status: 400 }
        );
      }
      const ok = await cancelAutoPublish(tenantId, row.linked_post_id);
      if (!ok) {
        return NextResponse.json(
          { error: "No active auto-publish hold on this draft." },
          { status: 409 }
        );
      }
      return NextResponse.json({ success: true });
    }

    if (body.action === "link") {
      if (!body.postId) {
        return NextResponse.json({ error: "postId is required to link." }, { status: 400 });
      }
      const { error } = await supabase
        .from("content_map_items")
        .update({
          status: "done",
          linked_post_id: body.postId,
          gate: (body.gate ?? null) as Record<string, unknown> | null,
          error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("tenant_id", tenantId)
        .eq("id", id);
      if (error) {
        return NextResponse.json({ error: "Failed to link the post", details: error.message }, { status: 500 });
      }
      return NextResponse.json({ success: true });
    }

    if (body.action === "dismiss" || body.action === "restore") {
      const { error } = await supabase
        .from("content_map_items")
        .update({
          status: body.action === "dismiss" ? "dismissed" : "planned",
          error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("tenant_id", tenantId)
        .eq("id", id);
      if (error) {
        return NextResponse.json({ error: "Failed to update the item", details: error.message }, { status: 500 });
      }
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = await getTenantId();
    await requireRole("agency_editor");
    const supabase = await createServiceClient();
    const workspaceId = await getCurrentWorkspaceId();

    const { id } = await params;
    let query = supabase.from("content_map_items").delete().eq("tenant_id", tenantId);
    if (workspaceId) query = query.eq("workspace_id", workspaceId);
    else query = query.is("workspace_id", null);

    const { error } = await query.eq("id", id);
    if (error) {
      return NextResponse.json({ error: "Failed to delete the item", details: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
