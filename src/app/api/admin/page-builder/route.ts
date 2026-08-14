import { NextRequest, NextResponse } from "next/server";
import { getRole } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { mergeLandingContent } from "@/lib/landing-content";

/**
 * GET  /api/admin/page-builder — the current (sanitized) landing content.
 * PUT  /api/admin/page-builder — persist the visual builder's edits.
 *
 * Super admin only. The public landing page reads the same row via
 * getLandingContent() and falls back to compiled defaults for any missing or
 * blank field, so a partial save never breaks the marketing site.
 */

async function requireSuperAdmin(): Promise<NextResponse | null> {
  try {
    const role = await getRole();
    if (role !== "super_admin") {
      return NextResponse.json(
        { error: "Super admin access required" },
        { status: 403 }
      );
    }
    return null;
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

export async function GET() {
  const denied = await requireSuperAdmin();
  if (denied) return denied;

  try {
    const supabase = await createServiceClient();
    const { data, error } = await supabase
      .from("site_settings")
      .select("landing_content")
      .eq("id", 1)
      .maybeSingle();
    if (error) throw new Error(error.message);

    return NextResponse.json({
      content: mergeLandingContent(data?.landing_content),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load content" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const denied = await requireSuperAdmin();
  if (denied) return denied;

  let body: { content?: unknown } = {};
  try {
    body = (await request.json()) as { content?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.content || typeof body.content !== "object" || Array.isArray(body.content)) {
    return NextResponse.json(
      { error: "content must be an object" },
      { status: 400 }
    );
  }

  try {
    const supabase = await createServiceClient();
    // Store the admin's object as-is; rendering sanitizes + defaults missing
    // fields so the public page can never break. Validate it round-trips the
    // sanitizer so we reject obviously-malformed payloads.
    const safe = mergeLandingContent(body.content);
    const { error } = await supabase
      .from("site_settings")
      .update({
        landing_content: body.content as Record<string, unknown>,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);
    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true, content: safe });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save content" },
      { status: 500 }
    );
  }
}
