import { NextRequest, NextResponse } from "next/server";
import { getTenantId, requireRole } from "@/lib/auth";
import {
  getNavSections,
  saveNavConfig,
  resetNavConfig,
  sanitizeNavSections,
} from "@/lib/nav-config";
import { buildNavSections } from "@/lib/nav-sections";

/** GET /api/admin/nav-config — current tenant's nav (custom or default). */
export async function GET() {
  try {
    const tenantId = await getTenantId();
    await requireRole("super_admin");
    const sections = await getNavSections(tenantId, true);
    return NextResponse.json({ sections });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to load navigation" },
      { status: err?.message?.includes("permissions") ? 403 : 500 }
    );
  }
}

/**
 * PUT /api/admin/nav-config
 * Body { sections } — save a custom nav. Body { reset: true } — restore the
 * built-in default (deletes the tenant's config row and returns the default).
 */
export async function PUT(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    await requireRole("super_admin");

    const body = (await request.json().catch(() => ({}))) as {
      sections?: unknown;
      reset?: boolean;
    };

    if (body.reset) {
      await resetNavConfig(tenantId);
      return NextResponse.json({ ok: true, sections: buildNavSections(true) });
    }

    const sanitized = sanitizeNavSections(body.sections);
    if (!sanitized) {
      return NextResponse.json(
        { error: "Invalid navigation structure — each section needs a label and at least one item with a /path and label." },
        { status: 400 }
      );
    }
    await saveNavConfig(tenantId, sanitized);
    return NextResponse.json({ ok: true, sections: sanitized });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to save navigation" },
      { status: err?.message?.includes("permissions") ? 403 : 500 }
    );
  }
}
