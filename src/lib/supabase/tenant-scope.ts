/**
 * tenant-scope.ts
 *
 * Enforced multi-tenant scoping for service-role Supabase clients.
 *
 * The service_role key bypasses RLS, so every query must scope by
 * tenant_id itself. This module makes that scoping IMPOSSIBLE to forget:
 *
 *   const scoped = tenantScopedClient(supabase, tenantId);
 *   await scoped.from("posts").select("*").eq("id", postId);
 *   // -> posts filtered by tenant_id = tenantId automatically
 *
 * Rules enforced by the proxy:
 *  - .select() / .update() / .delete() chains get
 *    .eq("tenant_id", tenantId) appended automatically.
 *  - .insert() / .upsert() payloads get tenant_id FORCED in — a caller
 *    cannot spoof another tenant by passing tenant_id in the payload.
 *  - Tables that have no tenant_id column (join-scoped child tables) pass
 *    through unscoped — see NO_TENANT_TABLES.
 *
 * The helper throws a TenantScopeError if tenantId is missing, so it can
 * be used as the only data-access path for tenant-owned data.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export class TenantScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantScopeError";
  }
}

/**
 * Tables without their own tenant_id column. These are child/join tables
 * scoped through their parent (e.g. posts -> post_platforms) and must NOT
 * get an automatic tenant_id filter applied.
 */
export const NO_TENANT_TABLES = new Set([
  "comments",
  "post_platforms",
  "publishing_logs",
  "analytics_snapshots",
]);

function isNoTenantTable(table: string): boolean {
  return NO_TENANT_TABLES.has(table);
}

/**
 * Wrap a client so that every .from(table) chain is automatically scoped
 * to tenantId. Throws TenantScopeError when tenantId is empty.
 *
 * Usage:
 *   const scoped = tenantScopedClient(await createServiceClient(), tenantId);
 *   const { data } = await scoped.from("posts").select("*").single();
 */
export function tenantScopedClient(
  client: SupabaseClient,
  tenantId: string
): SupabaseClient {
  if (!tenantId) {
    throw new TenantScopeError("tenantScopedClient requires a tenantId");
  }

  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (prop !== "from") {
        // Preserve method `this` binding for non-from calls (rpc, auth, ...)
        return typeof value === "function" ? value.bind(target) : value;
      }

      // Intercept .from(table) and wrap the returned query builder.
      return (table: string) => {
        const qb = target.from(table);
        if (isNoTenantTable(table)) return qb;
        return scopedQueryBuilder(qb, tenantId);
      };
    },
  }) as SupabaseClient;
}

/**
 * Wraps a PostgrestQueryBuilder so reads/updates/deletes are filtered by
 * tenant_id and inserts get tenant_id forced into the payload.
 */
function scopedQueryBuilder(qb: object, tenantId: string): object {
  // The builder API is dynamic — a Proxy is the only way to intercept
  // every chainable method, so `any` is required here by construction.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const target = qb as any;
  return new Proxy(target, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get(tgt: any, prop, receiver) {
      // Never let the builder be treated as a thenable by await/async — the
      // query result is what gets awaited, not the builder itself.
      if (prop === "then") return undefined;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const value = Reflect.get(tgt, prop, receiver) as any;
      if (typeof value !== "function") return value;

      if (prop === "select" || prop === "update" || prop === "delete") {
        return (...args: unknown[]) => {
          const chain = value.apply(tgt, args);
          return chain.eq("tenant_id", tenantId);
        };
      }

      if (prop === "insert" || prop === "upsert") {
        return (...args: unknown[]) => {
          const [payload, ...rest] = args;
          const scopedPayload = scopeInsertPayload(payload, tenantId);
          return value.call(tgt, scopedPayload, ...rest);
        };
      }

      return value.bind(tgt);
    },
  });
}

/**
 * Forces tenant_id into an insert/upsert payload (single object or array).
 * A caller-supplied tenant_id is overwritten — scoping is enforced, not
 * caller-controlled.
 */
export function scopeInsertPayload(payload: unknown, tenantId: string): unknown {
  if (Array.isArray(payload)) {
    return payload.map((row) => ({ ...row, tenant_id: tenantId }));
  }
  if (payload && typeof payload === "object") {
    return { ...(payload as Record<string, unknown>), tenant_id: tenantId };
  }
  return payload;
}

/**
 * Verifies a fetched row belongs to the tenant. Throws TenantScopeError if
 * the row is missing or its tenant_id doesn't match. Use after by-id
 * lookups where the caller passes an id that could belong to another tenant.
 */
export function assertTenantOwner<T extends { tenant_id?: string | null }>(
  row: T | null | undefined,
  tenantId: string,
  label = "record"
): T {
  if (!row) {
    throw new TenantScopeError(`${label} not found`);
  }
  if (row.tenant_id !== tenantId) {
    throw new TenantScopeError(`${label} does not belong to this tenant`);
  }
  return row;
}
