import { NextResponse } from "next/server";
import { requireClientRole } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * GET /api/seo/client-proposals
 *
 * Client-facing endpoint. Returns SEO campaign proposals for the
 * currently authenticated client user. The middleware injects
 * x-client-id for client-role users.
 */
export async function GET() {
  try {
    // This will throw if the user is not a client role
    const clientId = await requireClientRole();
    const supabase = await createServiceClient();

    // Fetch campaigns where client_id matches the authenticated user
    const { data: campaigns, error } = await supabase
      .from("seo_campaigns")
      .select("*")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json(
        { error: "Failed to fetch proposals", details: error },
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