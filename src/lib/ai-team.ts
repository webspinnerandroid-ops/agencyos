"use server";

import { getTenantId, requireRole } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { tenantScopedClient } from "@/lib/supabase/tenant-scope";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export interface AiEmployee {
  id: string;
  key: string;
  name: string;
  role: string;
  description: string | null;
  status: "built" | "partial" | "planned";
  integrations: string | null;
  settingsHref: string | null;
  icon: string | null;
  sortOrder: number | null;
}

export interface TenantAiEmployee extends AiEmployee {
  hired: boolean;
  active: boolean;
  hiredAt: string | null;
}

export interface ActionResponse<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

// Map DB column names -> camelCase for the UI.
function toEmployee(row: Record<string, unknown>): AiEmployee {
  return {
    id: row.id as string,
    key: row.key as string,
    name: row.name as string,
    role: row.role as string,
    description: (row.description as string) ?? null,
    status: (row.status as AiEmployee["status"]) ?? "built",
    integrations: (row.integrations as string) ?? null,
    settingsHref: (row.settings_href as string) ?? null,
    icon: (row.icon as string) ?? null,
    sortOrder: (row.sort_order as number) ?? 0,
  };
}

// ----------------------------------------------------------------------------
// Roster
// ----------------------------------------------------------------------------

/**
 * Returns this tenant's hired roster joined with the catalog. The query
 * starts from tenant_ai_employees (which carries tenant_id and is auto-scoped
 * by tenantScopedClient), then joins the global ai_employees catalog — so no
 * cross-tenant data is ever fetched.
 */
export async function getTeamRoster(): Promise<ActionResponse<TenantAiEmployee[]>> {
  try {
    const tenantId = await getTenantId();
    const supabase = tenantScopedClient(await createServiceClient(), tenantId);

    const { data, error } = await supabase
      .from("tenant_ai_employees")
      .select(
        "hired, active, hired_at, " +
          "ai_employees(id, key, name, role, description, status, integrations, settings_href, icon, sort_order)"
      );

    if (error) throw new Error(error.message);

    const rows = (data ?? []) as unknown as Record<string, unknown>[];

    const roster: TenantAiEmployee[] = rows
      .map((row) => {
        const emp = (row.ai_employees as unknown as Record<string, unknown>) ?? {};
        return {
          ...toEmployee(emp),
          hired: (row.hired as boolean) ?? true,
          active: (row.active as boolean) ?? true,
          hiredAt: (row.hired_at as string) ?? null,
        };
      })
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

    return { success: true, data: roster };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ----------------------------------------------------------------------------
// Per-agent configuration (custom instructions, guidelines, assets)
// ----------------------------------------------------------------------------

export interface EmployeeConfig {
  customInstructions: string;
  guidelines: string;
  assets: string;
}

const EMPTY_CONFIG: EmployeeConfig = {
  customInstructions: "",
  guidelines: "",
  assets: "",
};

/** Reads the employee's catalog row (global, no tenant scope needed). */
async function findEmployeeByKey(
  employeeKey: string
): Promise<{ id: string } | null> {
  const catalogClient = await createServiceClient();
  const { data } = await catalogClient
    .from("ai_employees")
    .select("id")
    .eq("key", employeeKey)
    .maybeSingle();
  return data ?? null;
}

/** Returns the tenant's saved config for one employee (empty by default). */
export async function getEmployeeConfig(
  employeeKey: string
): Promise<ActionResponse<EmployeeConfig>> {
  try {
    const tenantId = await getTenantId();
    const supabase = tenantScopedClient(await createServiceClient(), tenantId);
    const emp = await findEmployeeByKey(employeeKey);
    if (!emp) return { success: false, error: `Unknown AI employee: ${employeeKey}` };

    const { data, error } = await supabase
      .from("tenant_ai_employees")
      .select("metadata")
      .eq("employee_id", emp.id)
      .maybeSingle();
    if (error) throw new Error(error.message);

    const metadata = (data?.metadata ?? {}) as Record<string, unknown>;
    const config = (metadata.config ?? {}) as Partial<EmployeeConfig>;
    return {
      success: true,
      data: {
        customInstructions: config.customInstructions ?? "",
        guidelines: config.guidelines ?? "",
        assets: config.assets ?? "",
      },
    };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/** Saves the tenant's custom instructions/guidelines/assets for one employee. */
export async function setEmployeeConfig(
  employeeKey: string,
  config: Partial<EmployeeConfig>
): Promise<ActionResponse> {
  try {
    const tenantId = await getTenantId();
    await requireRole("agency_editor");
    const supabase = tenantScopedClient(await createServiceClient(), tenantId);
    const emp = await findEmployeeByKey(employeeKey);
    if (!emp) return { success: false, error: `Unknown AI employee: ${employeeKey}` };

    // Merge into existing metadata so we never clobber other fields.
    const { data: existing } = await supabase
      .from("tenant_ai_employees")
      .select("metadata")
      .eq("employee_id", emp.id)
      .maybeSingle();
    const current = { ...EMPTY_CONFIG, ...((existing?.metadata as Record<string, unknown>)?.config ?? {}) };
    const merged = {
      ...(existing?.metadata as Record<string, unknown> | undefined),
      config: {
        customInstructions:
          config.customInstructions !== undefined
            ? config.customInstructions
            : current.customInstructions,
        guidelines:
          config.guidelines !== undefined ? config.guidelines : current.guidelines,
        assets: config.assets !== undefined ? config.assets : current.assets,
      },
    };

    const { error } = await supabase
      .from("tenant_ai_employees")
      .update({ metadata: merged })
      .eq("employee_id", emp.id);
    if (error) throw new Error(error.message);

    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ----------------------------------------------------------------------------
// Hire / fire / activate
// ----------------------------------------------------------------------------

/**
 * Hire or fire an AI employee for this tenant. `hired=false` removes them
 * from the team UI; `hired=true` adds them back.
 */
export async function setEmployeeHired(
  employeeKey: string,
  hired: boolean
): Promise<ActionResponse> {
  try {
    const tenantId = await getTenantId();
    await requireRole("agency_editor");
    const supabase = tenantScopedClient(await createServiceClient(), tenantId);

    // Look up the catalog row (global, no tenant scope needed).
    const catalogClient = await createServiceClient();
    const { data: emp, error: empErr } = await catalogClient
      .from("ai_employees")
      .select("id")
      .eq("key", employeeKey)
      .maybeSingle();
    if (empErr) throw new Error(empErr.message);
    if (!emp) throw new Error(`Unknown AI employee: ${employeeKey}`);

    // Upsert the tenant join row. The scoped client forces tenant_id.
    const { error } = await supabase
      .from("tenant_ai_employees")
      .upsert(
        { employee_id: emp.id, hired, active: true },
        { onConflict: "tenant_id,employee_id" }
      );
    if (error) throw new Error(error.message);

    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Enable/disable an employee's background work for this tenant. `active=false`
 * keeps them hired but pauses their work.
 */
export async function setEmployeeActive(
  employeeKey: string,
  active: boolean
): Promise<ActionResponse> {
  try {
    const tenantId = await getTenantId();
    await requireRole("agency_editor");
    const supabase = tenantScopedClient(await createServiceClient(), tenantId);

    const catalogClient = await createServiceClient();
    const { data: emp, error: empErr } = await catalogClient
      .from("ai_employees")
      .select("id")
      .eq("key", employeeKey)
      .maybeSingle();
    if (empErr) throw new Error(empErr.message);
    if (!emp) throw new Error(`Unknown AI employee: ${employeeKey}`);

    const { error } = await supabase
      .from("tenant_ai_employees")
      .upsert(
        { employee_id: emp.id, active },
        { onConflict: "tenant_id,employee_id" }
      );
    if (error) throw new Error(error.message);

    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
