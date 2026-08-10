import { inngest } from "@/lib/inngest/client";
import { syncInbox, syncCalendar } from "@/lib/inbox/archer";
import { createClient } from "@supabase/supabase-js";

function createServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export const syncInboxes = inngest.createFunction(
  {
    id: "sync-inboxes",
    name: "Sync Email Inboxes",
    retries: 2,
    triggers: [
      {
        cron: "*/5 * * * *",
      },
    ],
  },
  async ({ step }) => {
    const supabase = createServiceSupabase();

    const { data: accounts, error } = await supabase
      .from("email_accounts")
      .select("id, tenant_id, platform, email_address");

    if (error) {
      console.error("[syncInboxes] Failed to fetch email accounts:", error);
      return { status: "error", message: error.message };
    }

    if (!accounts || accounts.length === 0) {
      return { status: "skipped", message: "No email accounts configured" };
    }

    const results: { accountId: string; email: string; inbox: unknown; calendar: unknown }[] = [];

    for (const account of accounts) {
      const stepResult = await step.run(
        `sync-${account.id}`,
        async () => {
          let inboxResult;
          let calendarResult;

          try {
            inboxResult = await syncInbox(account.id, account.tenant_id);
          } catch (err: any) {
            console.error(`[syncInboxes] Inbox sync failed for ${account.email_address}:`, err.message);
            inboxResult = { error: err.message };
          }

          try {
            calendarResult = await syncCalendar(account.id, account.tenant_id);
          } catch (err: any) {
            console.error(`[syncInboxes] Calendar sync failed for ${account.email_address}:`, err.message);
            calendarResult = { error: err.message };
          }

          return {
            accountId: account.id,
            email: account.email_address,
            inbox: inboxResult,
            calendar: calendarResult,
          };
        }
      );

      results.push(stepResult);
    }

    const totalSynced = results.filter(
      (r: any) => r.inbox?.threadsImported > 0 || r.calendar?.eventsImported > 0
    ).length;

    return {
      status: "completed",
      accountsProcessed: results.length,
      accountsWithNewData: totalSynced,
      results,
    };
  }
);