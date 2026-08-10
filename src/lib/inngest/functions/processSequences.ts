import { inngest } from "@/lib/inngest/client";
import { processSequenceStep } from "@/lib/leads/cipher";
import { createClient } from "@supabase/supabase-js";

function createServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export const processSequences = inngest.createFunction(
  {
    id: "process-sequences",
    name: "Process Sequence Steps",
    retries: 1,
    triggers: [
      {
        cron: "*/5 * * * *",
      },
    ],
  },
  async ({ step }) => {
    const supabase = createServiceSupabase();
    const now = new Date().toISOString();

    const { data: enrollments, error } = await supabase
      .from("sequence_enrollments")
      .select("id, lead_id, current_step")
      .eq("paused", false)
      .is("completed_at", null)
      .lte("next_action_at", now)
      .limit(50);

    if (error) {
      console.error("[processSequences] Failed to fetch enrollments:", error);
      return { status: "error", message: error.message };
    }

    if (!enrollments || enrollments.length === 0) {
      return { status: "skipped", message: "No due enrollments" };
    }

    const results: { enrollmentId: string; leadId: string; step: number; outcome: string }[] = [];

    for (const enrollment of enrollments) {
      const result = await step.run(
        `process-${enrollment.id}`,
        async () => {
          try {
            const outcome = await processSequenceStep(enrollment.id);
            return {
              enrollmentId: enrollment.id,
              leadId: enrollment.lead_id,
              step: enrollment.current_step,
              outcome: outcome.processed ? outcome.action ?? "step executed" : "skipped",
            };
          } catch (err: any) {
            console.error(`[processSequences] Error for enrollment ${enrollment.id}:`, err.message);
            return {
              enrollmentId: enrollment.id,
              leadId: enrollment.lead_id,
              step: enrollment.current_step,
              outcome: `error: ${err.message}`,
            };
          }
        }
      );

      results.push(result);
    }

    const processed = results.filter((r) => r.outcome !== "skipped").length;

    return {
      status: "completed",
      due: enrollments.length,
      processed,
      results,
    };
  }
);