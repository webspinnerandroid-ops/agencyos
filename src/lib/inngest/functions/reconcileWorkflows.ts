import { inngest } from "@/lib/inngest/client";
import { reconcile } from "@/lib/agency/workflow";

// ============================================================================
// reconcileWorkflows — the DR seam (docs/backup-and-dr.md §4.2).
//
// Nightly sweep: any workflow stuck in waiting_for_approval / running /
// pending is re-presented (same approval token — duplicate approvals are
// structurally impossible) and anything waiting past the SLA is flagged to
// the ledger. Also run manually after any Postgres restore (runbooks R1/R2/R5)
// and after Inngest state loss (R6) — this function replaces Inngest's own
// memory of in-flight waits, because Postgres, not Inngest, is the truth.
// ============================================================================

export const reconcileWorkflows = inngest.createFunction(
  {
    id: "agency-reconcile-workflows",
    name: "Agency Ops — Reconcile Workflows",
    retries: 1,
    triggers: [{ cron: "17 3 * * *" }], // 03:17 daily — off the hour on purpose
  },
  async ({ step }) => {
    const result = await step.run("sweep", async () => {
      return reconcile({ staleAfterDays: 14 });
    });
    return {
      scanned: result.scanned,
      rePresented: result.rePresented.length,
      flaggedStale: result.flaggedStale.length,
      failed: result.failed,
    };
  }
);
