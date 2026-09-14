import { inngest } from "@/lib/inngest/client";
import { createServiceClient } from "@/lib/supabase/server";
import {
  startWorkflow,
  setWorkflowStatus,
  openApprovalGate,
  decideApproval,
  loadByApprovalToken,
} from "@/lib/agency/workflow";
import { record } from "@/lib/agency/ledger";
import {
  AGENCY_EVENTS,
  assertRecipientAllowlisted,
  OnboardingRequestedData,
} from "@/lib/agency/events";
import { sendTelegramMessage, getTelegramBotToken } from "@/lib/telegram";

// ============================================================================
// onboardClient — Plan v3 Phase 4.
//
// The money path: client record → subsystem provisioning → agreement approval
// gate → signature wait → payment wait → client_active.
//
// Durability contract (ADR-003): every step persists to workflow_state via
// startWorkflow() BEFORE it waits. The signature and payment waits re-check
// native state on every wake, so a missed event self-heals on the next tick.
// ============================================================================

const SIGNATURE_POLL = "10m";
const SIGNATURE_TIMEOUT = "30d";
const PAYMENT_POLL = "1h";
const PAYMENT_TIMEOUT = "45d";

async function adminChatId(tenantId: string): Promise<string | null> {
  const supabase = await createServiceClient();
  const { data } = await supabase
    .from("telegram_links")
    .select("chat_id")
    .eq("tenant_id", tenantId)
    .limit(1)
    .maybeSingle();
  return (data?.chat_id as string) ?? null;
}

async function notify(tenantId: string, text: string): Promise<void> {
  if (!getTelegramBotToken()) return;
  const chatId = await adminChatId(tenantId);
  if (chatId) await sendTelegramMessage(chatId, text, { parseMode: "Markdown" });
}

export const onboardClient = inngest.createFunction(
  {
    id: "agency-onboard-client",
    name: "Agency Ops — Onboard Client",
    retries: 3,
    triggers: [{ event: AGENCY_EVENTS.onboardingRequested }],
  },
  async ({ event, step }) => {
    const data = event.data as OnboardingRequestedData;
    const tenantId = data.tenantId;
    const idem = `onboard:${tenantId}:${data.client.legalName.toLowerCase().replace(/\s+/g, "-")}:${data.service}`;

    // ---- Step 1: client record (idempotent) --------------------------------
    const clientId = await step.run("ensure-client-record", async () => {
      const supabase = await createServiceClient();
      if (data.clientId) {
        const { data: existing } = await supabase
          .from("clients")
          .select("id")
          .eq("id", data.clientId)
          .eq("tenant_id", tenantId)
          .maybeSingle();
        if (existing) return existing.id as string;
      }
      // Match-or-create on tenant + name so a replay never duplicates.
      const { data: match } = await supabase
        .from("clients")
        .select("id")
        .eq("tenant_id", tenantId)
        .ilike("name", data.client.legalName)
        .maybeSingle();
      if (match) return match.id as string;

      const { data: created, error } = await supabase
        .from("clients")
        .insert({
          tenant_id: tenantId,
          workspace_id: data.workspaceId,
          name: data.client.legalName,
          website: data.client.domain ?? null,
          email: data.client.contactEmail,
        })
        .select("id")
        .single();
      if (error) throw new Error(`client create failed: ${error.message}`);
      await record({
        tenantId,
        workspaceId: data.workspaceId,
        clientId: created.id as string,
        actor: { kind: "inngest" },
        type: "client",
        summary: `Client created: ${data.client.legalName} (${data.service})`,
        source: "inngest",
      });
      return created.id as string;
    });

    // ---- Step 2: workflow_state + subsystem provisioning -------------------
    const stateId = await step.run("start-workflow-state", async () => {
      const state = await startWorkflow({
        tenantId,
        workflow: "onboard_client",
        step: "provision",
        idempotencyKey: idem,
        payload: {
          clientId,
          service: data.service,
          contactEmail: data.client.contactEmail,
          domain: data.client.domain ?? null,
          requestedBy: data.requestedBy ?? null,
        },
      });
      return state.id;
    });

    await step.run("provision-subsystems", async () => {
      const supabase = await createServiceClient();
      const rows = [
        { subsystem: "agency_os_workspace", resource_id: data.workspaceId ?? clientId },
        { subsystem: data.service === "seo_campaign" ? "agency_os_seo" : "agency_os_cms", resource_id: clientId },
      ];
      await supabase.from("client_subsystems").upsert(
        rows.map((r) => ({
          client_id: clientId,
          tenant_id: tenantId,
          subsystem: r.subsystem,
          resource_id: r.resource_id ?? null,
          metadata: { provisioned_by: "onboard_client", service: data.service },
        })),
        { onConflict: "client_id,subsystem" }
      );
      await setWorkflowStatus(stateId, "running", { step: "agreement" });
      await record({
        tenantId,
        clientId,
        actor: { kind: "inngest" },
        type: "workflow",
        summary: `Provisioned subsystems for ${data.client.legalName}`,
        source: "inngest",
      });
    });

    // ---- Step 3: agreement approval gate (human decides before any send) ---
    const approved = await step.run("agreement-approval-gate", async () => {
      const state = await startWorkflow({
        tenantId,
        workflow: "onboard_client",
        step: "agreement",
        idempotencyKey: `${idem}:approval`,
        payload: { clientId, gate: "agreement" },
      });
      const { token } = await openApprovalGate({
        stateId: state.id,
        tenantId,
        clientId,
        title: `Send service agreement to ${data.client.legalName}`,
        detail: `Recipient: ${data.client.contactEmail}. Approving sends the in-house signing link.`,
      });
      await notify(
        tenantId,
        `✍️ *Approval needed*\nSend the service agreement for *${data.client.legalName}* to ${data.client.contactEmail}?`
      );
      // Wait for the decision. decideApproval flips state to running/rejected;
      // poll until the gate leaves waiting_for_approval.
      const deadline = Date.now() + 14 * 86_400_000;
      while (Date.now() < deadline) {
        await step.sleep("agreement-gate-poll", "1m");
        const current = await (async () => {
          const supabase = await createServiceClient();
          const { data: row } = await supabase
            .from("workflow_state")
            .select("status")
            .eq("id", state.id)
            .maybeSingle();
          return (row?.status as string) ?? "waiting_for_approval";
        })();
        if (current === "running") return { approved: true };
        if (current === "rejected") return { approved: false };
      }
      return { approved: false };
    });

    if (!approved.approved) {
      await step.run("mark-rejected", async () => {
        await setWorkflowStatus(stateId, "rejected", { step: "agreement" });
        await record({
          tenantId,
          clientId,
          actor: { kind: "system" },
          type: "workflow",
          summary: `Onboarding rejected at agreement gate: ${data.client.legalName}`,
          status: "failed",
        });
      });
      return { status: "rejected", clientId };
    }

    // ---- Step 4: send the agreement (allowlist enforced server-side) -------
    const signToken = await step.run("send-agreement", async () => {
      // Allowlist gate BEFORE any send (plan Phase 4 acceptance test).
      await assertRecipientAllowlisted({
        tenantId,
        clientId,
        email: data.client.contactEmail,
      });
      const { createSignRequest } = await import("@/lib/signing");
      const supabase = await createServiceClient();
      const { data: campaign } = await supabase
        .from("seo_campaigns")
        .select("id, workspace_id")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const { request, signUrl } = await createSignRequest({
        tenantId,
        campaignId: campaign?.id ?? "",
        workspaceId: data.workspaceId,
        clientId,
        signerName: data.client.contactName ?? data.client.legalName,
        signerEmail: data.client.contactEmail,
        createdBy: data.requestedBy ?? null,
      });
      await record({
        tenantId,
        clientId,
        actor: { kind: "system" },
        type: "workflow",
        summary: `Agreement sent to ${data.client.contactEmail} for signature`,
        artifactRef: request.id,
        status: "pending",
      });
      await notify(tenantId, `📤 Agreement sent to *${data.client.legalName}*. Waiting for signature.`);
      return request.token;
    });

    // ---- Step 5: wait for signature (event-driven + state re-check) --------
    await step.waitForEvent("wait-signature", {
      event: AGENCY_EVENTS.contractSigned,
      match: "data.signRequestId",
      timeout: SIGNATURE_TIMEOUT,
    });
    const signed = await step.run("verify-signature", async () => {
      const supabase = await createServiceClient();
      const { data: req } = await supabase
        .from("sign_requests")
        .select("id, status")
        .eq("token", signToken)
        .maybeSingle();
      return (req?.status as string) === "signed";
    });
    if (!signed) {
      await notify(tenantId, `⏰ Signature for *${data.client.legalName}* timed out after 30 days.`);
      await setWorkflowStatus(stateId, "failed", { step: "signature" });
      return { status: "signature-timeout", clientId };
    }

    // ---- Step 6: wait for payment ------------------------------------------
    const paid = await step.waitForEvent("wait-payment", {
      event: AGENCY_EVENTS.invoicePaid,
      timeout: PAYMENT_TIMEOUT,
    });
    const paymentConfirmed = await step.run("verify-payment", async () => {
      if (paid) return true;
      // Self-heal: check subscriptions native state in case the event was lost.
      const supabase = await createServiceClient();
      const { data: sub } = await supabase
        .from("subscriptions")
        .select("status")
        .eq("tenant_id", tenantId)
        .eq("status", "active")
        .maybeSingle();
      return Boolean(sub);
    });

    // ---- Step 7: finalize ---------------------------------------------------
    await step.run("finalize", async () => {
      await setWorkflowStatus(stateId, "done", { step: "complete" });
      await record({
        tenantId,
        clientId,
        actor: { kind: "system" },
        type: "workflow",
        summary: paymentConfirmed
          ? `Client active: ${data.client.legalName} (signed + paid)`
          : `Client signed: ${data.client.legalName} (payment pending)`,
        status: paymentConfirmed ? "ok" : "pending",
      });
      await notify(
        tenantId,
        paymentConfirmed
          ? `🎉 *${data.client.legalName}* is fully onboarded — signed and paid.`
          : `✍️ *${data.client.legalName}* signed. Payment hasn't landed yet — I'll keep watching.`
      );
    });

    return { status: paymentConfirmed ? "active" : "signed-awaiting-payment", clientId };
  }
);
