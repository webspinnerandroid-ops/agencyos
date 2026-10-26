#!/usr/bin/env node
/**
 * Provision missing `tenant_balances` rows (migration 077).
 *
 * Registration now creates a balance row for every new tenant, but tenants that
 * signed up earlier never got one — their usage is metered into `token_ledger`
 * while `tenant_balances` stays empty, so `getTokenBalance()` reports
 * "not enforced" and the billing screens show nothing.
 *
 * Idempotent: only tenants with no row are touched. Allowance is copied from
 * `token_plans` for the tenant's subscription plan (0 when the plan is not
 * configured — metering on, nothing granted).
 *
 *   node scripts/backfill-tenant-balances.mjs           # dry run
 *   node scripts/backfill-tenant-balances.mjs --apply   # write rows
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createClient } = require("@supabase/supabase-js");
const { loadEnvConfig } = require("@next/env");

loadEnvConfig(process.cwd());

const apply = process.argv.includes("--apply");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (.env.local).");
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function page(table, select) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(select).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

const tenants = await page("tenants", "id, name");
const balances = await page("tenant_balances", "tenant_id");
const subscriptions = await page("subscriptions", "tenant_id, plan_id");
const plans = await page("token_plans", "plan_id, monthly_token_allowance_usd");

const hasBalance = new Set(balances.map((b) => b.tenant_id));
const planByTenant = new Map(subscriptions.map((s) => [s.tenant_id, s.plan_id]));
const allowanceByPlan = new Map(
  plans.map((p) => [p.plan_id, Number(p.monthly_token_allowance_usd ?? 0)])
);

const missing = tenants
  .filter((t) => !hasBalance.has(t.id))
  .map((t) => {
    const planId = planByTenant.get(t.id) ?? null;
    return {
      tenant_id: t.id,
      monthly_allowance_usd: planId ? allowanceByPlan.get(planId) ?? 0 : 0,
      plan: planId,
      name: t.name,
    };
  });

console.log(
  `tenants: ${tenants.length} · with balance: ${tenants.length - missing.length} · missing: ${missing.length}`
);
for (const m of missing) {
  console.log(`  + ${m.tenant_id}  ${m.name}  plan=${m.plan ?? "none"} allowance=$${m.monthly_allowance_usd}`);
}

if (missing.length === 0) {
  console.log("Nothing to do.");
  process.exit(0);
}
if (!apply) {
  console.log("\nDry run. Re-run with --apply to insert these rows.");
  process.exit(0);
}

const { error } = await supabase.from("tenant_balances").insert(
  missing.map((m) => ({
    tenant_id: m.tenant_id,
    monthly_allowance_usd: m.monthly_allowance_usd,
  }))
);
if (error) {
  console.error("Insert failed:", error.message);
  process.exit(1);
}
console.log(`Inserted ${missing.length} balance row(s).`);
