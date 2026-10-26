import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Token billing: balance provisioning + the 402 gate.
 *
 * Two behaviours matter here and both are invisible in the UI until they break:
 *
 *   1. `ensureTenantBalance` must create the row a tenant was never given, with
 *      the allowance of its plan — otherwise usage is metered forever against
 *      nothing.
 *   2. `checkTokenBalance` must not lock anyone out while the platform is still
 *      unmetered (no plan allowances configured), yet must fail closed — not
 *      open — when enforcement is switched on and the balance is unreachable.
 */
interface BalanceRow {
  tenant_id: string;
  monthly_allowance_usd: number;
  used_this_cycle_usd: number;
  addon_balance_usd: number;
}

let balances: BalanceRow[];
let subscriptions: Array<{ tenant_id: string; plan_id: string | null }>;
let plans: Array<{ plan_id: string; monthly_token_allowance_usd: number }>;
/** Simulate a database where the balance table is missing / writes are denied. */
let writesFail: boolean;

interface Result {
  data: unknown;
  error: { message: string } | null;
}

/** Minimal PostgREST-shaped builder covering the calls token-billing makes. */
function builder(table: string) {
  const filters: Array<[string, unknown]> = [];
  let op: "select" | "insert" | "update" = "select";
  let payload: Record<string, unknown> | null = null;

  const rows = (): Record<string, unknown>[] => {
    if (table === "tenant_balances") return balances as unknown as Record<string, unknown>[];
    if (table === "subscriptions") return subscriptions as unknown as Record<string, unknown>[];
    if (table === "token_plans") return plans as unknown as Record<string, unknown>[];
    return [];
  };

  const matches = (row: Record<string, unknown>) =>
    filters.every(([k, v]) => row[k] === v);

  const exec = (): Result => {
    if (table === "tenant_balances" && writesFail && op !== "select") {
      return { data: null, error: { message: "relation does not exist" } };
    }
    if (op === "insert") {
      const row = payload as Record<string, unknown>;
      if (table === "tenant_balances") {
        if (balances.some((b) => b.tenant_id === row.tenant_id)) {
          return { data: null, error: { message: 'duplicate key value violates unique constraint "tenant_balances_pkey"' } };
        }
        balances.push({
          tenant_id: String(row.tenant_id),
          monthly_allowance_usd: Number(row.monthly_allowance_usd ?? 0),
          used_this_cycle_usd: 0,
          addon_balance_usd: Number(row.addon_balance_usd ?? 0),
        });
      }
      return { data: null, error: null };
    }
    if (op === "update") {
      for (const row of rows()) if (matches(row)) Object.assign(row, payload);
      return { data: null, error: null };
    }
    return { data: rows().filter(matches), error: null };
  };

  const q = {
    select: () => q,
    insert: (row: Record<string, unknown>) => {
      op = "insert";
      payload = row;
      return q;
    },
    update: (row: Record<string, unknown>) => {
      op = "update";
      payload = row;
      return q;
    },
    eq: (column: string, value: unknown) => {
      filters.push([column, value]);
      return q;
    },
    maybeSingle: async (): Promise<Result> => {
      const res = exec();
      if (res.error) return { data: null, error: res.error };
      const list = res.data as Record<string, unknown>[];
      return { data: list[0] ?? null, error: null };
    },
    then: (onFulfilled?: (r: Result) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(exec()).then(onFulfilled, onRejected),
  };
  return q;
}

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => ({ from: (table: string) => builder(table) }),
}));

const { getTokenBalance, ensureTenantBalance, checkTokenBalance } = await import("./token-billing");

const TENANT = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  balances = [];
  subscriptions = [
    { tenant_id: TENANT, plan_id: "growth" },
    { tenant_id: "22222222-2222-4222-8222-222222222222", plan_id: "unknown-plan" },
  ];
  plans = [{ plan_id: "growth", monthly_token_allowance_usd: 40 }];
  writesFail = false;
  delete process.env.TOKEN_ENFORCE_BILLING;
});

afterEach(() => {
  delete process.env.TOKEN_ENFORCE_BILLING;
});

describe("ensureTenantBalance", () => {
  it("creates the missing row with the allowance of the tenant's plan", async () => {
    await ensureTenantBalance(TENANT);
    expect(balances).toHaveLength(1);
    expect(balances[0].monthly_allowance_usd).toBe(40);
    expect(balances[0].used_this_cycle_usd).toBe(0);
  });

  it("uses an explicitly supplied plan instead of the subscription", async () => {
    await ensureTenantBalance(TENANT, "growth");
    expect(balances[0].monthly_allowance_usd).toBe(40);
  });

  it("grants 0 (metered, nothing granted) for a plan with no allowance configured", async () => {
    await ensureTenantBalance("22222222-2222-4222-8222-222222222222");
    expect(balances[0].monthly_allowance_usd).toBe(0);
  });

  it("is idempotent — an existing row is never rewritten", async () => {
    balances.push({
      tenant_id: TENANT,
      monthly_allowance_usd: 12,
      used_this_cycle_usd: 7,
      addon_balance_usd: 0,
    });
    await ensureTenantBalance(TENANT);
    expect(balances).toHaveLength(1);
    expect(balances[0]).toMatchObject({ monthly_allowance_usd: 12, used_this_cycle_usd: 7 });
  });
});

describe("getTokenBalance", () => {
  it("reports not-enforced when the tenant has no row", async () => {
    const balance = await getTokenBalance(TENANT);
    expect(balance.enforced).toBe(false);
    expect(balance.remainingUsd).toBe(0);
  });

  it("computes remaining as unused allowance plus add-on credit", async () => {
    balances.push({
      tenant_id: TENANT,
      monthly_allowance_usd: 40,
      used_this_cycle_usd: 15.5,
      addon_balance_usd: 10,
    });
    const balance = await getTokenBalance(TENANT);
    expect(balance.enforced).toBe(true);
    expect(balance.remainingUsd).toBeCloseTo(34.5, 5);
  });

  it("never reports a negative remaining balance", async () => {
    balances.push({
      tenant_id: TENANT,
      monthly_allowance_usd: 40,
      used_this_cycle_usd: 55,
      addon_balance_usd: 0,
    });
    expect((await getTokenBalance(TENANT)).remainingUsd).toBe(0);
  });
});

describe("checkTokenBalance", () => {
  it("stays out of the way while enforcement is off, even at zero balance", async () => {
    balances.push({
      tenant_id: TENANT,
      monthly_allowance_usd: 0,
      used_this_cycle_usd: 0,
      addon_balance_usd: 0,
    });
    const result = await checkTokenBalance(TENANT, "agency_admin");
    expect(result.allowed).toBe(true);
  });

  it("meters, provisions, and still allows generation while enforcement is off", async () => {
    const result = await checkTokenBalance(TENANT);
    expect(result.allowed).toBe(true);
    expect(balances, "a tenant with no row is provisioned on first generation").toHaveLength(1);
  });

  it("blocks an exhausted tenant once enforcement is on", async () => {
    process.env.TOKEN_ENFORCE_BILLING = "true";
    balances.push({
      tenant_id: TENANT,
      monthly_allowance_usd: 40,
      used_this_cycle_usd: 40,
      addon_balance_usd: 0,
    });
    const result = await checkTokenBalance(TENANT, "content_manager");
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/add tokens/i);
  });

  it("allows a tenant with credit left once enforcement is on", async () => {
    process.env.TOKEN_ENFORCE_BILLING = "true";
    balances.push({
      tenant_id: TENANT,
      monthly_allowance_usd: 40,
      used_this_cycle_usd: 39.99,
      addon_balance_usd: 0,
    });
    expect((await checkTokenBalance(TENANT, "content_manager")).allowed).toBe(true);
  });

  it("fails closed when enforcement is on but no balance can be provisioned", async () => {
    process.env.TOKEN_ENFORCE_BILLING = "true";
    writesFail = true;
    const result = await checkTokenBalance(TENANT, "content_manager");
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/billing is unavailable/i);
  });

  it("never gates platform operators", async () => {
    process.env.TOKEN_ENFORCE_BILLING = "true";
    balances.push({
      tenant_id: TENANT,
      monthly_allowance_usd: 0,
      used_this_cycle_usd: 0,
      addon_balance_usd: 0,
    });
    expect((await checkTokenBalance(TENANT, "super_admin")).allowed).toBe(true);
    expect((await checkTokenBalance(TENANT, "agency_admin")).allowed).toBe(true);
  });
});
