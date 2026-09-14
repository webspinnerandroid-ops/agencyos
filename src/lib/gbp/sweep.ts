// ============================================================================
// GBP review-sync sweep — shared by the hourly Inngest worker and the one-off
// "run it right now" script (scripts/run-reputation-workers-once.ts).
//
// Cross-tenant by design: this sweep enumerates every connected tenant/
// workspace pair, then each pair is processed with explicit tenant scoping
// inside syncGbpReviewsForPair. Same trust model as the other allowlisted
// Inngest workers.
// ============================================================================

import {
  markSyncOk,
  syncGbpReviewsForPair,
  type ServiceClient,
} from "@/lib/gbp/client";

export type { ServiceClient };

export interface ConnectedPair {
  tenant_id: string;
  workspace_id: string | null;
}

export interface SyncPairOutcome {
  tenantId: string;
  workspaceId: string | null;
  ok: boolean;
  error: string | null;
  listings: number;
  newReviews: number;
}

export interface SweepResult {
  status: "skipped" | "completed";
  message?: string;
  pairsProcessed?: number;
  pairsOk?: number;
  newReviews?: number;
  results?: SyncPairOutcome[];
}

/**
 * Every distinct connected tenant/workspace pair with a real location.
 * Intentionally cross-tenant: this enumerates which pairs have connected
 * listings — every per-pair query inside syncGbpReviewsForPair is
 * tenant-scoped by explicit argument.
 */
export async function listConnectedGbpPairs(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<ConnectedPair[]> {
  const { data, error } = await supabase
    .from("google_business_profiles")
    .select("tenant_id, workspace_id")
    .eq("connected", true)
    .not("location_id", "is", null)
    .limit(1000);
  if (error) {
    console.error("[gbpSweep] list pairs:", error.message);
    return [];
  }
  const seen = new Set<string>();
  const out: ConnectedPair[] = [];
  for (const row of (data ?? []) as ConnectedPair[]) {
    const key = `${row.tenant_id}|${row.workspace_id ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ tenant_id: row.tenant_id, workspace_id: row.workspace_id ?? null });
  }
  return out;
}

/**
 * Sync every connected pair once. `runStep` wraps each pair's work so the
 * Inngest version gets durable step semantics while the one-off script just
 * runs it inline. (Listing the pairs stays outside runStep — the Inngest
 * function reads them directly via listConnectedGbpPairs in its own step.)
 */
export async function runGbpReviewSync(
  supabase: ServiceClient,
  pairs: ConnectedPair[],
  runStep: (name: string, fn: () => Promise<SyncPairOutcome>) => Promise<SyncPairOutcome>
): Promise<SweepResult> {
  if (pairs.length === 0) {
    return { status: "skipped", message: "No connected Business Profiles" };
  }

  const results: SyncPairOutcome[] = [];
  for (const pair of pairs) {
    const outcome = await runStep(
      `sync-${pair.tenant_id}-${pair.workspace_id ?? "all"}`,
      async () => {
        try {
          const r = await syncGbpReviewsForPair(supabase, pair.tenant_id, pair.workspace_id);
          if (r.ok) await markSyncOk(supabase, pair.tenant_id);
          return {
            tenantId: pair.tenant_id,
            workspaceId: pair.workspace_id,
            ok: r.ok,
            error: r.error ?? null,
            listings: r.listings.length,
            newReviews: r.newReviews,
          };
        } catch (err) {
          console.error("[gbpSweep] pair failed:", pair.tenant_id, err);
          return {
            tenantId: pair.tenant_id,
            workspaceId: pair.workspace_id,
            ok: false,
            error: err instanceof Error ? err.message : "unknown",
            listings: 0,
            newReviews: 0,
          };
        }
      }
    );
    results.push(outcome);
  }

  const okCount = results.filter((r) => r.ok).length;
  return {
    status: "completed",
    pairsProcessed: pairs.length,
    pairsOk: okCount,
    newReviews: results.reduce((sum, r) => sum + r.newReviews, 0),
    results,
  };
}
