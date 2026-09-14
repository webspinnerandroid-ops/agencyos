/**
 * Client lifecycle — the single shared state machine behind BOTH the
 * onboarding wizard and Malory's conversational onboarding.
 *
 * Principle: the wizard owns the state; Malory (Team Room chat) reads and
 * writes the SAME rows through the same functions, so the two front doors
 * can never drift apart. A step completed in chat advances the wizard, and
 * a step completed in the wizard is narrated into the Team Room.
 *
 * All access is tenant-scoped and goes through the service client; the
 * `client_onboarding` table has RLS enabled with no policies (service-role
 * only), matching token_ledger/tenant_balances.
 */

import { createServiceClient } from "@/lib/supabase/server";
import { LIFECYCLE_STEPS, stepIndexFor } from "@/lib/lifecycle-steps";

export {
  LIFECYCLE_STEPS,
  STEP_IDS,
  stepIndexFor,
  nextStepAfter,
} from "@/lib/lifecycle-steps";
export type { LifecycleStepDef } from "@/lib/lifecycle-steps";

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export type LifecycleStatus = "not_started" | "in_progress" | "completed";

export interface ClientLifecycle {
  id: string;
  tenant_id: string;
  client_id: string;
  workspace_id: string | null;
  step: number; // 0-based index into LIFECYCLE_STEPS
  status: LifecycleStatus;
  data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Reads / writes
// ---------------------------------------------------------------------------

export async function getLifecycle(
  tenantId: string,
  clientId: string
): Promise<ClientLifecycle | null> {
  const supabase = await createServiceClient();
  const { data } = await supabase
    .from("client_onboarding")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("client_id", clientId)
    .maybeSingle();
  return (data as ClientLifecycle | null) ?? null;
}

export async function getOrCreateLifecycle(
  tenantId: string,
  clientId: string,
  workspaceId: string | null
): Promise<ClientLifecycle> {
  const existing = await getLifecycle(tenantId, clientId);
  if (existing) return existing;
  const supabase = await createServiceClient();
  const { data, error } = await supabase
    .from("client_onboarding")
    .insert({
      tenant_id: tenantId,
      client_id: clientId,
      workspace_id: workspaceId,
      step: 0,
      status: "not_started",
      data: {},
    })
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(`Failed to start onboarding: ${error?.message ?? ""}`);
  }
  return data as ClientLifecycle;
}

export interface AdvanceResult {
  lifecycle: ClientLifecycle;
  advanced: boolean;
}

/**
 * Advance (or confirm) the lifecycle at a given step. Steps can only move
 * forward — a call for an earlier step is ignored (idempotent), a call for a
 * step more than one ahead is clamped to the next step.
 */
export async function advanceLifecycle(
  tenantId: string,
  clientId: string,
  stepId: string,
  dataPatch?: Record<string, unknown>
): Promise<AdvanceResult> {
  const lifecycle = await getLifecycle(tenantId, clientId);
  if (!lifecycle) {
    throw new Error("Onboarding has not been started for this client.");
  }
  if (lifecycle.status === "completed") {
    return { lifecycle, advanced: false };
  }

  const target = stepIndexFor(stepId);
  const current = lifecycle.step;
  // Confirm/progress rule: completing the current step (or any later step)
  // always moves to the immediate next step. The wizard passes the step it
  // just finished; Malory may pass a later step but is still clamped to one
  // ahead. Calls for an earlier or already-passed step are idempotent and
  // leave the step unchanged. The final step never auto-advances (`go_live`
  // is completed via completeLifecycle).
  const next =
    target >= current && current < LIFECYCLE_STEPS.length - 1
      ? current + 1
      : current;
  const advanced = next > current || Object.keys(dataPatch ?? {}).length > 0;

  const data = { ...(lifecycle.data ?? {}), ...(dataPatch ?? {}) };
  const supabase = await createServiceClient();
  const { data: updated, error } = await supabase
    .from("client_onboarding")
    .update({
      step: next,
      status: "in_progress",
      data,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId)
    .eq("client_id", clientId)
    .select("*")
    .single();
  if (error || !updated) {
    throw new Error(`Failed to advance onboarding: ${error?.message ?? ""}`);
  }
  return { lifecycle: updated as ClientLifecycle, advanced };
}

export async function completeLifecycle(
  tenantId: string,
  clientId: string
): Promise<ClientLifecycle> {
  const supabase = await createServiceClient();
  const { data, error } = await supabase
    .from("client_onboarding")
    .update({
      step: LIFECYCLE_STEPS.length - 1,
      status: "completed",
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId)
    .eq("client_id", clientId)
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(`Failed to complete onboarding: ${error?.message ?? ""}`);
  }
  return data as ClientLifecycle;
}

// ---------------------------------------------------------------------------
// Team Room (Malory) bridge
// ---------------------------------------------------------------------------

/**
 * Find-or-create the tenant's Team Room chat (kind = "team") for a workspace,
 * mirroring ai-team-chat's getOrCreateTeamChat but without cookies — usable
 * from the wizard server actions AND background contexts.
 */
async function findOrCreateTeamRoom(
  tenantId: string,
  workspaceId: string | null
): Promise<{ id: string }> {
  const supabase = await createServiceClient();
  const { data: existing } = await supabase
    .from("team_chats")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("workspace_id", workspaceId)
    .eq("kind", "team")
    .maybeSingle();
  if (existing) return existing;

  const { data: created, error } = await supabase
    .from("team_chats")
    .insert({
      tenant_id: tenantId,
      workspace_id: workspaceId,
      client_id: null,
      title: "Team Room",
      kind: "team",
      employee_key: null,
    })
    .select("id")
    .single();
  if (error || !created) {
    throw new Error(`Could not open the Team Room: ${error?.message ?? ""}`);
  }
  return created;
}

/**
 * Post a Malory-narrated message into the Team Room. Best-effort by contract
 * — callers should wrap this in try/catch (it must never fail the workflow).
 */
export async function narrateToTeamRoom(
  tenantId: string,
  workspaceId: string | null,
  content: string,
  metadataAction = "lifecycle_note"
): Promise<void> {
  const supabase = await createServiceClient();
  const chat = await findOrCreateTeamRoom(tenantId, workspaceId);
  await supabase.from("team_messages").insert({
    chat_id: chat.id,
    tenant_id: tenantId,
    role: "employee",
    employee_key: "nina",
    content,
    metadata: { action: metadataAction },
  });
}

/** Campaign-deployment kickoff announcement (called by deployCampaign). */
export async function announceCampaignDeployed(
  tenantId: string,
  workspaceId: string | null,
  clientId: string | null,
  tierName: string,
  postCount: number
): Promise<void> {
  await narrateToTeamRoom(
    tenantId,
    workspaceId,
    `Campaign kickoff: the **${tierName}** plan has been approved and deployed — ${postCount} content pieces are now drafted on the calendar with dates and owners. I'll coordinate the team as each piece comes due. Next up: confirm the content plan items in the calendar so Cheryl starts writing.`,
    "campaign_deployed"
  );
}
