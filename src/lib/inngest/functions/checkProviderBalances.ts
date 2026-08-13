import { inngest } from "@/lib/inngest/client";
import { createClient } from "@supabase/supabase-js";
import { checkAndAlertRow } from "@/lib/subscription-check";

/**
 * Daily provider balance sweep. Runs every auto-check in the subscription
 * registry and emails the super admin when credit is at/below a provider's
 * low_balance_threshold (at most once per 24h per provider). This is the
 * proactive half of the low-balance alerts — the admin "Check balances" button
 * fires the same logic on demand.
 */
export const checkProviderBalances = inngest.createFunction(
  {
    id: "check-provider-balances",
    name: "Check provider balances & alert on low credit",
    triggers: [{ cron: "0 12 * * *" }], // every day 12:00 UTC
  },
  async ({ step }) => {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    return await step.run("check-all", async () => {
      const { data: rows } = await supabase
        .from("subscription_registry")
        .select("*");

      // Super admin email(s): the registry is super-admin-wide, so alert the
      // account(s) that can actually top up. Fall back to ADMIN_EMAIL env.
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "super_admin");
      const adminIds = new Set((roles ?? []).map((r: any) => r.user_id));
      const { data: users } = await supabase.auth.admin.listUsers();
      const emails = (users?.users ?? [])
        .filter((u: any) => adminIds.has(u.id))
        .map((u: any) => u.email)
        .filter(Boolean);
      const recipient = emails[0] ?? process.env.ADMIN_EMAIL ?? null;

      const results: { provider: string; ok: boolean; credit?: number | null; error?: string; alertSent?: boolean }[] = [];
      for (const row of rows ?? []) {
        const checkType = String(row.auto_check ?? "");
        if (!checkType || checkType === "manual") continue;
        const r = await checkAndAlertRow(supabase, row, recipient);
        results.push({
          provider: row.provider,
          ok: r.ok,
          credit: r.credit,
          error: r.error,
          alertSent: r.alertSent,
        });
      }

      return {
        checked: results.length,
        ok: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        alertsSent: results.filter((r) => r.alertSent).length,
        recipient,
      };
    });
  }
);
