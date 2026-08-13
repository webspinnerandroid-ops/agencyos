import { NextRequest, NextResponse } from "next/server";
import { getTenantId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { randomBytes } from "crypto";

/**
 * PATCH /api/seo/campaigns/[id]/share
 * Manage the public audit share link for a campaign (tenant-authenticated).
 *
 * Body:
 *   enabled (optional)    - false revokes the public link (404), true re-enables
 *   regenerate (optional) - true mints a fresh unguessable share token; the new
 *                           public link becomes /audit/<token>
 *
 * Returns the new link state: { enabled, url }
 */

function shareUrl(tokenOrId: string): string {
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://platform.blissmedialab.com";
  return `${origin.replace(/\/$/, "")}/audit/${tokenOrId}`;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();
    const { id } = await params;

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const wantEnabled = typeof body.enabled === "boolean" ? body.enabled : undefined;
    const wantRegenerate = body.regenerate === true;

    if (wantEnabled === undefined && !wantRegenerate) {
      return NextResponse.json(
        { error: "Provide enabled (boolean) and/or regenerate (true)." },
        { status: 400 }
      );
    }

    const updates: Record<string, unknown> = {};
    if (wantEnabled !== undefined) updates.share_enabled = wantEnabled;
    if (wantRegenerate) {
      updates.share_token = randomBytes(16).toString("hex");
      updates.share_enabled = true; // regenerating always re-enables
    }

    const { data: campaign, error } = await supabase
      .from("seo_campaigns")
      .update(updates)
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .select("id, share_enabled, share_token")
      .single();

    if (error || !campaign) {
      // Pre-migration 056 the share_enabled / share_token columns don't
      // exist yet — tell the admin exactly that instead of a confusing 404.
      if (error && /share_enabled|share_token|schema cache/i.test(error.message)) {
        return NextResponse.json(
          { error: "Share management is ready — run migration 056 (adds share_enabled / share_token) in the Supabase SQL Editor, then retry." },
          { status: 400 }
        );
      }
      return NextResponse.json(
        { error: "Campaign not found or no permission." },
        { status: 404 }
      );
    }

    const token = campaign.share_token ?? campaign.id;
    return NextResponse.json({
      enabled: campaign.share_enabled,
      url: shareUrl(token),
    });
  } catch (err) {
    console.error("[campaign share]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: "Could not update the share link." },
      { status: 500 }
    );
  }
}
