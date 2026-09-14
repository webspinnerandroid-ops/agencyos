// ============================================================================
// events.ts — typed Inngest event names + send helpers (Phase 4 glue).
//
// These are the seams between the webhook world (Stripe, Telegram, the
// public signing page) and the workflow world (Inngest functions). Every
// workflow wait listens for one of these; every emit site is listed here.
//
// Emit sites:
//   agency/contract.signed   ← src/lib/signing.ts finalizeSignature()
//   agency/invoice.paid      ← src/app/api/webhooks/stripe/route.ts invoice.paid
//   agency/gate.decided      ← telegram callback ap:approve/ap:reject (decideApproval)
//   agency/onboarding.requested ← POST /api/agency/onboard
// ============================================================================

import { inngest } from "@/lib/inngest/client";
import { createServiceClient } from "@/lib/supabase/server";

export const AGENCY_EVENTS = {
  onboardingRequested: "agency/onboarding.requested",
  contractSigned: "agency/contract.signed",
  invoicePaid: "agency/invoice.paid",
  gateDecided: "agency/gate.decided",
} as const;

export interface OnboardingRequestedData {
  tenantId: string;
  workspaceId: string | null;
  clientId: string | null; // null → workflow creates the client
  client: {
    legalName: string;
    domain?: string | null;
    contactEmail: string;
    contactName?: string | null;
  };
  service: string; // service catalog key, e.g. 'seo_campaign'
  requestedBy?: string | null;
}

export async function emitOnboardingRequested(data: OnboardingRequestedData) {
  await inngest.send({ name: AGENCY_EVENTS.onboardingRequested, data });
}

export async function emitContractSigned(data: {
  tenantId: string;
  signRequestId: string;
  campaignId: string | null;
  clientId: string | null;
  workspaceId: string | null;
  signerEmail: string;
}) {
  await inngest.send({ name: AGENCY_EVENTS.contractSigned, data });
}

export async function emitInvoicePaid(data: {
  tenantId: string;
  stripeEventId: string;
  invoiceId: string | null;
  amountUsd: number | null;
  clientId: string | null;
  workspaceId: string | null;
}) {
  await inngest.send({ name: AGENCY_EVENTS.invoicePaid, data });
}

export async function emitGateDecided(data: {
  tenantId: string;
  stateId: string;
  token: string;
  decision: "approved" | "rejected";
  decidedBy: string;
}) {
  await inngest.send({ name: AGENCY_EVENTS.gateDecided, data });
}

/**
 * Recipient allowlist (Phase 4 security gate, plan acceptance test):
 * outbound agreement/invoice sends may only target an email already on the
 * client record (or the explicit contact email given at onboarding).
 * Enforced server-side at the send site — never in the UI.
 */
export async function assertRecipientAllowlisted(input: {
  tenantId: string;
  clientId: string | null;
  email: string;
  /** Extra addresses accepted for this tenant (e.g. intake-provided contact). */
  extraAllowed?: string[];
}): Promise<void> {
  const target = input.email.trim().toLowerCase();
  if (!target) throw new Error("Recipient email is required");

  const allowed = new Set<string>((input.extraAllowed ?? []).map((e) => e.trim().toLowerCase()));
  if (input.clientId) {
    const supabase = await createServiceClient();
    const { data } = await supabase
      .from("clients")
      .select("email")
      .eq("id", input.clientId)
      .eq("tenant_id", input.tenantId)
      .maybeSingle();
    if (data?.email) allowed.add(String(data.email).trim().toLowerCase());
  }
  if (!allowed.has(target)) {
    throw new Error(
      `Recipient "${target}" is not on the client record — send blocked by the recipient allowlist.`
    );
  }
}
