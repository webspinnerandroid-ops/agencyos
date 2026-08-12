import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import { scanOpportunitiesForTenant, currentWeekStart } from "@/lib/opportunity-scan";

/**
 * POST /api/opportunities/generate
 * Body: { topics?: string[] }
 *
 * Runs the Reddit/LinkedIn/Quora opportunity scan for this tenant now
 * (the same logic the weekly Inngest cron runs). Recommendations are
 * AI-generated — review before posting.
 */
export async function POST(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    if (!tenantId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const workspaceId = (await getCurrentWorkspaceId().catch(() => null)) ?? null;
    const body = (await request.json().catch(() => ({}))) as { topics?: string[] };

    const result = await scanOpportunitiesForTenant(
      tenantId,
      workspaceId,
      {
        brandName: "our agency and its clients",
        topics: (body.topics ?? []).filter((t: string) => t.trim()),
        targetAudience: "people searching for expert answers in our niche",
      },
      currentWeekStart()
    );

    if (result.error && result.inserted === 0) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    return NextResponse.json({
      inserted: result.inserted,
      message: result.inserted
        ? `Found ${result.inserted} opportunity${result.inserted === 1 ? "" : "ies"} this week.`
        : "No new opportunities were added.",
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 });
  }
}
