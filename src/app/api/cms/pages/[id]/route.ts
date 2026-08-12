import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { slugify, type CmsBlock } from "@/lib/cms";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();

    const { data, error } = await supabase
      .from("site_pages")
      .select("*")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Page not found" }, { status: 404 });
    return NextResponse.json({ page: data });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal error" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();

    const body = (await request.json().catch(() => ({}))) as {
      title?: string;
      blocks?: CmsBlock[];
      is_published?: boolean;
    };

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.title === "string") patch.title = body.title.trim() || "Untitled Page";
    if (Array.isArray(body.blocks)) patch.blocks = body.blocks;
    if (typeof body.is_published === "boolean") {
      patch.is_published = body.is_published;
      patch.published_at = body.is_published ? new Date().toISOString() : null;
    }

    const { data, error } = await supabase
      .from("site_pages")
      .update(patch)
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .select("*")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Page not found" }, { status: 404 });
    return NextResponse.json({ page: data });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal error" },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();

    const { error } = await supabase
      .from("site_pages")
      .delete()
      .eq("id", id)
      .eq("tenant_id", tenantId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal error" },
      { status: 500 }
    );
  }
}
