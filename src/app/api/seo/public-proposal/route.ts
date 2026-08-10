import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * GET /api/seo/public-proposal?clientId=<uuid>
 *
 * Public endpoint. Returns SEO campaign proposals for a given client ID.
 * No authentication required — this is the share link endpoint.
 * Only returns campaigns in "proposed", "approved", or "active" status.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("clientId");

    if (!clientId) {
      return NextResponse.json(
        { error: "clientId query parameter is required" },
        { status: 400 }
      );
    }

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(clientId)) {
      return NextResponse.json(
        { error: "Invalid clientId format. Must be a UUID." },
        { status: 400 }
      );
    }

    const supabase = await createServiceClient();

    const { data: campaigns, error } = await supabase
      .from("seo_campaigns")
      .select("*")
      .eq("client_id", clientId)
      .in("status", ["proposed", "approved", "active"])
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[public-proposal] Failed to fetch campaigns:", error);
      return NextResponse.json(
        { error: "Failed to fetch proposals" },
        { status: 500 }
      );
    }

    return NextResponse.json({ campaigns: campaigns ?? [] });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}