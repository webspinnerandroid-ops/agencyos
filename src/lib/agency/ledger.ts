// ============================================================================
// ledger.ts — the activity ledger client.
//
// The single sanctioned write path into the `activity` table (migration 106).
// Ledger writing is enforced in code, not documentation: `record()` validates
// required fields, is insert-only (the DB trigger blocks UPDATE/DELETE), and
// is fire-and-forget — a ledger failure must never break the workflow that
// produced the event.
//
// Plan v3 Phase 2 · docs/phase-0-decisions.md ADR-001/003
// ============================================================================

import { createServiceClient } from "@/lib/supabase/server";

export type LedgerActor =
  | { kind: "system" }
  | { kind: "user"; userId: string }
  | { kind: "telegram"; chatId: string }
  | { kind: "api"; keyId: string }
  | { kind: "inngest" }
  | { kind: "webhook"; name: string };

export type LedgerType =
  | "email"
  | "seo"
  | "payment"
  | "workflow"
  | "approval"
  | "issue"
  | "client"
  | "content"
  | "cost"
  | "reconciliation";

export interface LedgerEntryInput {
  tenantId: string;
  workspaceId?: string | null;
  clientId?: string | null;
  actor: LedgerActor;
  type: LedgerType;
  source?: "app" | "telegram" | "api" | "inngest" | "webhook";
  /** Human-readable one-liner — REQUIRED. This is what "Open Acme" renders. */
  summary: string;
  payload?: Record<string, unknown>;
  /** Stable external reference (message_id, stripe event id, PR url, ...). */
  artifactRef?: string | null;
  status?: "ok" | "pending" | "failed" | "waiting_for_approval";
}

export interface LedgerEntry {
  id: number;
  tenantId: string;
  occurredAt: string;
  type: LedgerType;
  summary: string;
}

function actorToString(actor: LedgerActor): string {
  switch (actor.kind) {
    case "system":
      return "system";
    case "user":
      return actor.userId;
    case "telegram":
      return `telegram:${actor.chatId}`;
    case "api":
      return `api:${actor.keyId}`;
    case "inngest":
      return "inngest";
    case "webhook":
      return `webhook:${actor.name}`;
  }
}

function actorToSource(actor: LedgerActor, fallback: LedgerEntryInput["source"]): string {
  switch (actor.kind) {
    case "system":
    case "user":
      return fallback ?? "app";
    case "telegram":
      return "telegram";
    case "api":
      return "api";
    case "inngest":
      return "inngest";
    case "webhook":
      return "webhook";
  }
}

/**
 * Record an activity. Validates required fields, maps to the activity table,
 * and never throws — ledger failures are logged and swallowed.
 */
export async function record(input: LedgerEntryInput): Promise<LedgerEntry | null> {
  try {
    if (!input.tenantId) throw new Error("tenantId is required");
    if (!input.type) throw new Error("type is required");
    if (!input.summary || !input.summary.trim()) {
      throw new Error("summary is required — a ledger row without a summary is noise");
    }

    const supabase = await createServiceClient();
    const { data, error } = await supabase
      .from("activity")
      .insert({
        tenant_id: input.tenantId,
        workspace_id: input.workspaceId ?? null,
        client_id: input.clientId ?? null,
        actor: actorToString(input.actor),
        type: input.type,
        source: actorToSource(input.actor, input.source),
        summary: input.summary.trim().slice(0, 500),
        payload: input.payload ?? {},
        artifact_ref: input.artifactRef ?? null,
        status: input.status ?? "ok",
      })
      .select("id, tenant_id, occurred_at, type, summary")
      .single();

    if (error) {
      // Append-only trigger rejections, RLS surprises, connectivity — log loudly.
      console.error("[ledger] record failed:", error.message, JSON.stringify(input.summary));
      return null;
    }
    return {
      id: data.id as number,
      tenantId: data.tenant_id as string,
      occurredAt: data.occurred_at as string,
      type: data.type as LedgerType,
      summary: data.summary as string,
    };
  } catch (err) {
    console.error("[ledger] record threw:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Last N entries for a client — the "Open Acme" context card core. */
export async function recentForClient(
  tenantId: string,
  clientId: string,
  limit = 5
): Promise<LedgerEntry[]> {
  try {
    const supabase = await createServiceClient();
    const { data, error } = await supabase
      .from("activity")
      .select("id, occurred_at, type, summary")
      .eq("tenant_id", tenantId)
      .eq("client_id", clientId)
      .order("occurred_at", { ascending: false })
      .limit(limit);
    if (error) return [];
    return (data ?? []).map((r) => ({
      id: r.id as number,
      tenantId,
      occurredAt: r.occurred_at as string,
      type: r.type as LedgerType,
      summary: r.summary as string,
    }));
  } catch {
    return [];
  }
}
