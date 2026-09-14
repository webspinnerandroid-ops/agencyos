// ============================================================================
// workflow.ts — durable workflow state machine (Phase 3 approval gates).
//
// Principle (ADR-003 / docs/backup-and-dr.md §4): Inngest is the scheduler and
// messenger; Postgres is the source of truth. Every durable step PERSISTS
// BEFORE IT WAITS, and approvals are receipts in Postgres — never chat
// history. If Inngest dies or the server restarts, `reconcile()` re-presents
// any workflow that was mid-approval, and duplicate replies are ignored via
// idempotency keys.
//
// Plan v3 Phase 3 · migration 106 (workflow_state, approval_receipts)
// ============================================================================

import { randomBytes } from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { record, LedgerActor } from "./ledger";

export type WorkflowStatus =
  | "pending"
  | "waiting_for_approval"
  | "running"
  | "done"
  | "failed"
  | "rejected"
  | "cancelled";

export interface WorkflowStateRow {
  id: string;
  tenant_id: string;
  workflow: string;
  step: string;
  status: WorkflowStatus;
  idempotency_key: string;
  payload: Record<string, unknown>;
  approval_token: string | null;
  result: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

function svc() {
  return createServiceClient();
}

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

/** Create (or fetch existing) workflow state. Idempotent on idempotency_key. */
export async function startWorkflow(input: {
  tenantId: string;
  workflow: string;
  step: string;
  idempotencyKey: string;
  payload?: Record<string, unknown>;
}): Promise<WorkflowStateRow> {
  const supabase = await svc();
  const { data: existing } = await supabase
    .from("workflow_state")
    .select("*")
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();
  if (existing) return existing as WorkflowStateRow;

  const { data, error } = await supabase
    .from("workflow_state")
    .insert({
      tenant_id: input.tenantId,
      workflow: input.workflow,
      step: input.step,
      status: "pending",
      idempotency_key: input.idempotencyKey,
      payload: input.payload ?? {},
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`startWorkflow failed: ${error?.message}`);
  await record({
    tenantId: input.tenantId,
    actor: { kind: "system" },
    type: "workflow",
    summary: `Workflow ${input.workflow} started (${input.step})`,
    payload: { idempotencyKey: input.idempotencyKey },
    artifactRef: data.id as string,
    status: "pending",
  });
  return data as WorkflowStateRow;
}

export async function setWorkflowStatus(
  stateId: string,
  status: WorkflowStatus,
  patch?: { step?: string; result?: Record<string, unknown> }
): Promise<void> {
  const supabase = await svc();
  const { error } = await supabase
    .from("workflow_state")
    .update({
      status,
      ...(patch?.step ? { step: patch.step } : {}),
      ...(patch?.result ? { result: patch.result } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", stateId);
  if (error) throw new Error(`setWorkflowStatus(${status}) failed: ${error.message}`);
}

// ---------------------------------------------------------------------------
// The approval gate primitive
// ---------------------------------------------------------------------------

export interface ApprovalGateInput {
  stateId: string;
  tenantId: string;
  clientId?: string | null;
  /** What the human is being asked to approve, e.g. "Service agreement for Acme". */
  title: string;
  detail?: string;
  /** Deep link into the app for the [Review] button. */
  link?: string | null;
}

/**
 * Persist a waiting_for_approval state (BEFORE any notification is sent) and
 * mint a single-use approval token. Returns the token for the Telegram card.
 */
export async function openApprovalGate(
  input: ApprovalGateInput
): Promise<{ token: string }> {
  const supabase = await svc();
  const token = randomBytes(16).toString("hex");

  // Stash the card metadata ON the state row so reconciliation can re-present
  // it faithfully after a crash/restore without re-deriving the title.
  const { data: current } = await supabase
    .from("workflow_state")
    .select("payload")
    .eq("id", input.stateId)
    .maybeSingle();
  const mergedPayload = {
    ...(((current?.payload ?? {}) as Record<string, unknown>) || {}),
    approval: { title: input.title, detail: input.detail ?? null, link: input.link ?? null },
  };

  const { error } = await supabase
    .from("workflow_state")
    .update({
      status: "waiting_for_approval",
      approval_token: token,
      payload: mergedPayload,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.stateId);
  if (error) throw new Error(`openApprovalGate failed: ${error.message}`);

  await record({
    tenantId: input.tenantId,
    clientId: input.clientId ?? null,
    actor: { kind: "system" },
    type: "approval",
    summary: `Awaiting approval: ${input.title}`,
    payload: { title: input.title, detail: input.detail ?? null, link: input.link ?? null },
    artifactRef: input.stateId,
    status: "waiting_for_approval",
  });
  return { token };
}

export interface ApprovalDecision {
  decided: boolean;
  status?: "approved" | "rejected";
  reason?: string;
}

/**
 * Resolve an approval gate from a Telegram callback (or the app).
 *
 * Idempotency: the approval_receipts row is the receipt. If a receipt already
 * exists for this token, the gate was already decided — the second tap is a
 * no-op (docs/backup-and-dr.md §4.1.3). The receipt is written BEFORE the
 * caller resumes the workflow, so a crash between receipt and resume leaves
 * the workflow resumable, never double-resumed.
 */
export async function decideApproval(
  token: string,
  decision: "approve" | "reject",
  decidedBy: string,
  opts?: { channel?: string; telegramMessageId?: number }
): Promise<ApprovalDecision> {
  if (!token) return { decided: false, reason: "missing token" };
  const supabase = await svc();

  const { data: state } = await supabase
    .from("workflow_state")
    .select("*")
    .eq("approval_token", token)
    .maybeSingle();
  if (!state) return { decided: false, reason: "unknown token" };

  // Already decided? Idempotent no-op.
  const { data: existingReceipt } = await supabase
    .from("approval_receipts")
    .select("id")
    .eq("state_id", state.id)
    .maybeSingle();
  if (existingReceipt) {
    return {
      decided: false,
      status: state.status === "running" || state.status === "done" ? "approved" : "rejected",
      reason: "already decided",
    };
  }
  if ((state as WorkflowStateRow).status !== "waiting_for_approval") {
    return { decided: false, reason: `workflow is ${state.status}` };
  }

  const finalStatus = decision === "approve" ? "approved" : "rejected";
  const { error: receiptErr } = await supabase.from("approval_receipts").insert({
    state_id: state.id,
    tenant_id: state.tenant_id,
    decision: finalStatus,
    decided_by: decidedBy,
    channel: opts?.channel ?? "telegram",
    telegram_message_id: opts?.telegramMessageId ?? null,
  });
  if (receiptErr) {
    // Unique/parallel-tap protection — someone else decided concurrently.
    return { decided: false, reason: "concurrent decision, retry" };
  }

  await setWorkflowStatus(state.id, finalStatus === "approved" ? "running" : "rejected");
  await record({
    tenantId: state.tenant_id,
    actor: { kind: "telegram", chatId: decidedBy.replace(/^telegram:/, "") } as LedgerActor,
    type: "approval",
    summary: `Approval ${finalStatus}: ${(state as WorkflowStateRow).workflow}`,
    artifactRef: state.id,
    status: "ok",
  });

  return { decided: true, status: finalStatus };
}

/** Load a waiting workflow by its approval token (to re-render the card). */
export async function loadByApprovalToken(token: string): Promise<WorkflowStateRow | null> {
  const supabase = await svc();
  const { data } = await supabase
    .from("workflow_state")
    .select("*")
    .eq("approval_token", token)
    .maybeSingle();
  return (data as WorkflowStateRow) ?? null;
}

// ---------------------------------------------------------------------------
// Reconciliation — the DR seam (docs/backup-and-dr.md §4.2)
// ---------------------------------------------------------------------------

export interface ReconcileResult {
  scanned: number;
  rePresented: { stateId: string; workflow: string; title: string }[];
  flaggedStale: { stateId: string; workflow: string; waitingDays: number }[];
  failed: number;
}

/**
 * Scan workflow_state for in-flight workflows and re-present them.
 *
 * Called: (a) by the nightly Inngest reconciliation function, (b) manually
 * after any Postgres restore (runbook R1/R2/R5), (c) after an Inngest state
 * loss (runbook R6 — this replaces Inngest's own state entirely).
 *
 * Re-presenting re-sends the SAME approval token: duplicate Telegram cards
 * are annoying, but duplicate approvals are structurally impossible (§4.1.3).
 */
export async function reconcile(opts?: {
  staleAfterDays?: number;
}): Promise<ReconcileResult> {
  const staleAfterDays = opts?.staleAfterDays ?? 14;
  const supabase = await svc();
  const result: ReconcileResult = { scanned: 0, rePresented: [], flaggedStale: [], failed: 0 };

  const { data: waiting, error } = await supabase
    .from("workflow_state")
    .select("id, tenant_id, workflow, step, status, payload, approval_token, updated_at")
    .in("status", ["waiting_for_approval", "running", "pending"]);
  if (error) throw new Error(`reconcile scan failed: ${error.message}`);
  result.scanned = waiting?.length ?? 0;

  const { getTelegramBotToken, sendTelegramMessage } = await import("@/lib/telegram");
  const botConfigured = getTelegramBotToken() !== null;

  for (const row of waiting ?? []) {
    try {
      const updatedAgo = Date.now() - new Date(row.updated_at as string).getTime();
      const waitingDays = Math.floor(updatedAgo / 86_400_000);

      if (row.status === "waiting_for_approval") {
        if (waitingDays >= staleAfterDays) {
          result.flaggedStale.push({
            stateId: row.id as string,
            workflow: row.workflow as string,
            waitingDays,
          });
          await record({
            tenantId: row.tenant_id as string,
            actor: { kind: "inngest" },
            type: "reconciliation",
            summary: `Workflow ${row.workflow} stale: waiting ${waitingDays} days for approval`,
            artifactRef: row.id as string,
            status: "pending",
          });
          continue;
        }
        // Re-present only if the row has been quiet for 10+ minutes — a card
        // younger than that is probably fine; this also keeps the nightly run
        // from re-pinging fresh approvals.
        if (updatedAgo < 10 * 60 * 1000) continue;
        const token = (row as WorkflowStateRow).approval_token;
        if (!token) continue;
        if (botConfigured) {
          const payload = (row.payload ?? {}) as { approval?: { title?: string } };
          const title = payload.approval?.title ?? `${row.workflow}: ${row.step}`;
          const chatId = await adminChatIdFor(row.tenant_id as string);
          if (!chatId) continue;
          await sendTelegramMessage(
            chatId,
            `⏮️ Re-presenting (workflow resumed after restart): *${title}*\nWorkflow: ${row.workflow} / ${row.step}`,
            {
              parseMode: "Markdown",
              replyMarkup: {
                inline_keyboard: [
                  [
                    { text: "✅ Approve", callback_data: `ap:approve:${token}` },
                    { text: "❌ Reject", callback_data: `ap:reject:${token}` },
                  ],
                ],
              },
            }
          );
        }
        result.rePresented.push({
          stateId: row.id as string,
          workflow: row.workflow as string,
          title:
            ((row.payload ?? {}) as { approval?: { title?: string } }).approval?.title ??
            `${row.workflow}: ${row.step}`,
        });
      } else {
        // running/pending: nudge the workflow runner by recording it; the
        // Inngest function that owns the workflow listens for its own retry
        // semantics — reconciliation only guarantees the state is visible.
        await record({
          tenantId: row.tenant_id as string,
          actor: { kind: "inngest" },
          type: "reconciliation",
          summary: `In-flight workflow ${row.workflow} (${row.step}) found by reconciliation sweep`,
          artifactRef: row.id as string,
          status: "pending",
        });
      }
    } catch (err) {
      result.failed += 1;
      console.error("[workflow] reconcile row failed:", err instanceof Error ? err.message : err);
    }
  }

  const sweepTenant = (waiting?.[0] as { tenant_id?: string } | undefined)?.tenant_id;
  if (sweepTenant) {
    await record({
      tenantId: sweepTenant,
      actor: { kind: "inngest" },
      type: "reconciliation",
      summary: `Reconciliation sweep: ${result.scanned} in-flight, ${result.rePresented.length} re-presented, ${result.flaggedStale.length} stale`,
    });
  }
  return result;
}

/** The tenant's bound Telegram chat (first bound user) for re-presentation. */
async function adminChatIdFor(tenantId: string): Promise<string | null> {
  const supabase = await svc();
  const { data } = await supabase
    .from("telegram_links")
    .select("chat_id")
    .eq("tenant_id", tenantId)
    .limit(1)
    .maybeSingle();
  return (data?.chat_id as string) ?? null;
}
