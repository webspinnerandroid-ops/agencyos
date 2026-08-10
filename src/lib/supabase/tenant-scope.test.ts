import { describe, it, expect } from "vitest";
import {
  tenantScopedClient,
  scopeInsertPayload,
  assertTenantOwner,
  TenantScopeError,
} from "./tenant-scope";

/**
 * Builds a minimal chainable mock of a Supabase client + query builder.
 * Every method call records `{ method, args }` and returns the chain, so we
 * can assert exactly what filters the scoped proxy injected.
 */
type MockClient = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc: (...args: any[]) => Record<string, any>;
};

function makeMockClient(): {
  client: MockClient;
  calls: { method: string; args: unknown[] }[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  chain: Record<string, any>;
} {
  const calls: { method: string; args: unknown[] }[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: Record<string, any> = {};

  const method = (name: string) => (...args: unknown[]) => {
    calls.push({ method: name, args });
    return chain;
  };

  for (const name of [
    "select",
    "insert",
    "upsert",
    "update",
    "delete",
    "eq",
    "neq",
    "in",
    "is",
    "order",
    "limit",
    "range",
    "single",
    "maybeSingle",
    "count",
  ]) {
    chain[name] = method(name);
  }

  const client: MockClient = {
    from: (table: string) => {
      calls.push({ method: "from", args: [table] });
      return chain;
    },
    rpc: method("rpc"),
  };

  return { client, calls, chain };
}

describe("tenantScopedClient", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const asSupabase = (client: MockClient) => client as any;

  it("throws when tenantId is missing", () => {
    const { client } = makeMockClient();
    expect(() => tenantScopedClient(asSupabase(client), "")).toThrow(TenantScopeError);
    // Cast through unknown: TS won't let us pass undefined to a string param,
    // but the runtime guard must still catch it.
    expect(() =>
      tenantScopedClient(asSupabase(client), undefined as unknown as string)
    ).toThrow(TenantScopeError);
  });

  it("appends eq(tenant_id) to select chains", () => {
    const { client, calls } = makeMockClient();
    const scoped = tenantScopedClient(asSupabase(client), "t1");

    scoped.from("posts").select("*").eq("id", "p1").single();

    const eqCalls = calls.filter((c) => c.method === "eq");
    expect(eqCalls).toContainEqual({ method: "eq", args: ["tenant_id", "t1"] });
    // The caller's own filter still runs after the injected one
    expect(eqCalls).toContainEqual({ method: "eq", args: ["id", "p1"] });
  });

  it("appends eq(tenant_id) to update and delete chains", () => {
    const { client, calls } = makeMockClient();
    const scoped = tenantScopedClient(asSupabase(client), "t1");

    scoped.from("posts").update({ status: "published" });
    scoped.from("posts").delete();

    const eqCalls = calls.filter((c) => c.method === "eq");
    expect(eqCalls).toHaveLength(2);
    expect(eqCalls.every((c) => c.args[0] === "tenant_id" && c.args[1] === "t1")).toBe(
      true
    );
  });

  it("forces tenant_id into insert payloads (single and array)", () => {
    const { client, calls } = makeMockClient();
    const scoped = tenantScopedClient(asSupabase(client), "t1");

    scoped.from("posts").insert({ title: "a", tenant_id: "attacker" });
    scoped.from("posts").insert([
      { title: "b" },
      { title: "c", tenant_id: "other" },
    ]);

    const inserts = calls.filter((c) => c.method === "insert");
    expect(inserts[0].args[0]).toEqual({ title: "a", tenant_id: "t1" });
    expect(inserts[1].args[0]).toEqual([
      { title: "b", tenant_id: "t1" },
      { title: "c", tenant_id: "t1" },
    ]);
  });

  it("forces tenant_id into upsert payloads", () => {
    const { client, calls } = makeMockClient();
    const scoped = tenantScopedClient(asSupabase(client), "t1");

    scoped.from("posts").upsert({ id: "x" }, { onConflict: "id" });

    const upserts = calls.filter((c) => c.method === "upsert");
    expect(upserts[0].args[0]).toEqual({ id: "x", tenant_id: "t1" });
    expect(upserts[0].args[1]).toEqual({ onConflict: "id" });
  });

  it("leaves no-tenant tables (join-scoped children) unscoped", () => {
    const { client, calls } = makeMockClient();
    const scoped = tenantScopedClient(asSupabase(client), "t1");

    scoped.from("post_platforms").select("*").eq("post_id", "p1");

    const eqCalls = calls.filter((c) => c.method === "eq");
    expect(eqCalls).toHaveLength(1);
    expect(eqCalls[0].args[0]).toBe("post_id");
  });

  it("passes through non-from methods (rpc) unchanged", () => {
    const { client, calls } = makeMockClient();
    const scoped = tenantScopedClient(asSupabase(client), "t1");

    scoped.rpc("increment_usage", { p_tenant_id: "t1" });

    expect(calls).toContainEqual({
      method: "rpc",
      args: ["increment_usage", { p_tenant_id: "t1" }],
    });
  });
});

describe("scopeInsertPayload", () => {
  it("overrides a spoofed tenant_id", () => {
    expect(scopeInsertPayload({ tenant_id: "evil" }, "good")).toEqual({
      tenant_id: "good",
    });
  });

  it("handles arrays", () => {
    expect(scopeInsertPayload([{ a: 1 }, { a: 2 }], "t")).toEqual([
      { a: 1, tenant_id: "t" },
      { a: 2, tenant_id: "t" },
    ]);
  });

  it("passes through non-objects untouched", () => {
    expect(scopeInsertPayload(null, "t")).toBeNull();
  });
});

describe("assertTenantOwner", () => {
  it("accepts a matching row", () => {
    const row = { id: "1", tenant_id: "t1" };
    expect(assertTenantOwner(row, "t1")).toBe(row);
  });

  it("throws for a missing row", () => {
    expect(() => assertTenantOwner(null, "t1")).toThrow(TenantScopeError);
    expect(() => assertTenantOwner(undefined, "t1")).toThrow(TenantScopeError);
  });

  it("throws when the row belongs to another tenant", () => {
    expect(() =>
      assertTenantOwner({ id: "1", tenant_id: "t2" }, "t1")
    ).toThrow(/does not belong to this tenant/);
  });
});
