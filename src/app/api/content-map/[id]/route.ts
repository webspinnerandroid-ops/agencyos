import { NextRequest, NextResponse } from "next/server";
import { getTenantId, requireRole } from "@/lib/auth";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import { createServiceClient } from "@/lib/supabase/server";
import { cancelAutoPublish } from "@/lib/content-map-autopublish";
import { parseJsonBody } from "@/lib/api-validate";
import { contentMapRowPatchSchema } from "@/lib/validations";

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
    const body = await parseJsonBody(request, contentMapRowPatchSchema);
    if (!body.ok) return body.response;
    const data = body.data;

    // Inline row editing (bulk editor): update the row's title/topic/keywords
    // so placeholder rows can be given real topics before generating. Partial
    // — only the provided fields change. Strings are trimmed and capped to
    // mirror the import caps.
    if (!data.action && (data.title !== undefined || data.topic !== undefined || data.keywords !== undefined || data.mode !== undefined)) {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (data.title !== undefined) {
        const t = data.title.trim().slice(0, 300);
        if (!t) {
          return NextResponse.json({ error: "Title cannot be empty." }, { status: 400 });
        }
        patch.title = t;
      }
      if (data.topic !== undefined) {
        patch.topic = data.topic.trim().slice(0, 1000);
      }
      if (data.keywords !== undefined) {
        if (!Array.isArray(data.keywords)) {
          return NextResponse.json({ error: "keywords must be an array of strings." }, { status: 400 });
        }
        patch.keywords = data.keywords
          .map((k) => String(k).trim())
          .filter(Boolean)
          .slice(0, 12);
      }
      if (data.mode !== undefined) {
        // Row mode: only two legal values — gate (default, scored) or
        // fiction (creative stories, skips the gate by design). The schema
        // has already normalized + validated this.
        patch.mode = data.mode;
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
    if (data.scheduledAt !== undefined && !data.action) {
      const iso =
        data.scheduledAt === null
          ? null
          : (() => {
              const d = new Date(data.scheduledAt as string);
              return isNaN(d.getTime()) ? undefined : d.toISOString();
            })();
      if (data.scheduledAt !== null && iso === undefined) {
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
    if (data.action === "cancel_auto_publish") {
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

    if (data.action === "link") {
      if (!data.postId) {
        return NextResponse.json({ error: "postId is required to link." }, { status: 400 });
      }
      const { error } = await supabase
        .from("content_map_items")
        .update({
          status: "done",
          linked_post_id: data.postId,
          gate: (data.gate ?? null) as Record<string, unknown> | null,
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

    if (data.action === "dismiss" || data.action === "restore") {
      const { error } = await supabase
        .from("content_map_items")
        .update({
          status: data.action === "dismiss" ? "dismissed" : "planned",
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
