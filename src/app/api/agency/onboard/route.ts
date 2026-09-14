import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTenantId, getRole, getUserId } from "@/lib/auth";
import { emitOnboardingRequested } from "@/lib/agency/events";
import { record } from "@/lib/agency/ledger";

const Body = z.object({
  client: z.object({
    legalName: z.string().min(2).max(120),
    domain: z.string().max(200).nullish(),
    contactEmail: z.string().email(),
    contactName: z.string().max(120).nullish(),
  }),
  service: z.enum(["seo_campaign", "web_build"]),
  clientId: z.string().uuid().nullish(),
  workspaceId: z.string().uuid().nullish(),
});

/**
 * POST /api/agency/onboard — the voice-command/Telegram/dashboard entry point
 * to the onboarding workflow. Validates, emits agency/onboarding.requested,
 * and returns immediately (Inngest runs the steps; Telegram reports progress).
 */
export async function POST(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const role = await getRole();
    if (role !== "agency_admin" && role !== "super_admin" && role !== "agency_editor") {
      return NextResponse.json({ error: "Insufficient role" }, { status: 403 });
    }
    const userId = await getUserId();
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    await emitOnboardingRequested({
      tenantId,
      workspaceId: parsed.data.workspaceId ?? null,
      clientId: parsed.data.clientId ?? null,
      client: {
        legalName: parsed.data.client.legalName,
        domain: parsed.data.client.domain ?? null,
        contactEmail: parsed.data.client.contactEmail,
        contactName: parsed.data.client.contactName ?? null,
      },
      service: parsed.data.service,
      requestedBy: userId,
    });
    await record({
      tenantId,
      actor: userId ? { kind: "user", userId } : { kind: "system" },
      type: "workflow",
      summary: `Onboarding requested: ${parsed.data.client.legalName} (${parsed.data.service})`,
      status: "pending",
    });
    return NextResponse.json({ ok: true, workflow: "onboard_client" }, { status: 202 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
