"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { getTenantId } from "@/lib/auth";
import { encrypt, decrypt } from "@/lib/encryption";

/**
 * Convert a hex string to a Buffer for BYTEA storage.
 * Postgres BYTEA accepts hex-encoded strings via the Supabase JS client
 * when passed as a Buffer (or when prefixed with \\x).
 */
function hexToBuffer(hex: string): Buffer {
  return Buffer.from(hex, "hex");
}

/**
 * Convert a BYTEA value returned by Supabase (Buffer or hex string) back
 * to a plain hex string for our encrypt/decrypt functions.
 */
function byteaToHex(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Buffer.isBuffer(value)) return value.toString("hex");
  if (typeof value === "string") return value.replace(/^\\x/, "");
  return "";
}

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

export interface AiProvider {
  id: string;
  name: string;
  base_url: string;
  type: string;
}

export interface AiModel {
  id: string;
  provider_id: string;
  model_identifier: string;
  supported_tasks: string[];
  provider?: AiProvider;
}

export interface TenantApiKey {
  id: string;
  tenant_id: string;
  provider_id: string;
  is_active: boolean;
  created_at: string;
  provider?: AiProvider;
  masked_key?: string;
}

export interface TaskModelMapping {
  id: string;
  tenant_id: string;
  task: string;
  model_id: string;
  client_id: string | null;
  model?: AiModel;
}

export interface ActionResponse<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

// ------------------------------------------------------------------
// AI Providers
// ------------------------------------------------------------------

export async function getProviders(): Promise<ActionResponse<AiProvider[]>> {
  try {
    const supabase = await createServiceClient();
    const { data, error } = await supabase
      .from("ai_providers")
      .select("*")
      .order("name");

    if (error) throw new Error(error.message);

    return { success: true, data: data as AiProvider[] };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ------------------------------------------------------------------
// AI Models
// ------------------------------------------------------------------

export async function getModels(
  providerId?: string
): Promise<ActionResponse<AiModel[]>> {
  try {
    const supabase = await createServiceClient();
    let query = supabase
      .from("ai_models")
      .select("*, provider:ai_providers(*)")
      .order("model_identifier");

    if (providerId) {
      query = query.eq("provider_id", providerId);
    }

    const { data, error } = await query;

    if (error) throw new Error(error.message);

    // Defense-in-depth: migrations 013/014 should have removed the legacy
    // DeepSeek rows, but on databases where those haven't run yet, filter
    // out the dead "deepseek-chat"/"deepseek-reasoner" models here so they
    // never appear in the AI Settings picker.
    const LEGACY_DEEPSEEK = new Set(["deepseek-chat", "deepseek-reasoner"]);
    const filtered = (data ?? []).filter(
      (m: AiModel) => !LEGACY_DEEPSEEK.has(m.model_identifier.toLowerCase())
    );

    return { success: true, data: filtered };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ------------------------------------------------------------------
// Tenant API Keys (CRUD)
// ------------------------------------------------------------------

export async function getTenantApiKeys(): Promise<ActionResponse<TenantApiKey[]>> {
  try {
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();

    const { data, error } = await supabase
      .from("tenant_api_keys")
      .select("*, provider:ai_providers(*)")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);

    // Mask the keys for display — we never send encrypted bytes to the client.
    // We only return metadata + a "last 4" style masked key label.
    const mapped: TenantApiKey[] = (data ?? []).map((row: any) => {
      let masked_key = "••••••••";
      try {
        if (row.encrypted_key) {
          // Convert BYTEA → hex string, then decrypt
          const hexStr = byteaToHex(row.encrypted_key);
          if (hexStr.length > 0) {
            const decrypted = decrypt(hexStr);
            if (decrypted.length > 4) {
              masked_key = `••••${decrypted.slice(-4)}`;
            } else {
              masked_key = "••••";
            }
          }
        }
      } catch {
        masked_key = "(encrypted)";
      }
      return {
        ...row,
        masked_key,
        encrypted_key: undefined, // NEVER leak the encrypted blob
      };
    });

    return { success: true, data: mapped };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function addApiKey(
  providerId: string,
  rawKey: string
): Promise<ActionResponse<TenantApiKey>> {
  try {
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();

    // Check if an active key already exists for this provider
    const { data: existing } = await supabase
      .from("tenant_api_keys")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("provider_id", providerId)
      .eq("is_active", true)
      .limit(1);

    if (existing && existing.length > 0) {
      return {
        success: false,
        error: "An active key already exists for this provider. Deactivate or delete it first.",
      };
    }

    // Encrypt the raw key → hex string, then convert to Buffer for BYTEA
    const encryptedHex = encrypt(rawKey);
    const encryptedBuffer = hexToBuffer(encryptedHex);

    const { data, error } = await supabase
      .from("tenant_api_keys")
      .insert({
        tenant_id: tenantId,
        provider_id: providerId,
        encrypted_key: encryptedBuffer,
        is_active: true,
      })
      .select("*, provider:ai_providers(*)")
      .single();

    if (error) throw new Error(error.message);

    revalidatePath("/dashboard/settings/ai");

    return {
      success: true,
      data: {
        ...data,
        masked_key: `••••${rawKey.slice(-4)}`,
        encrypted_key: undefined,
      } as TenantApiKey,
    };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function toggleApiKey(
  keyId: string,
  isActive: boolean
): Promise<ActionResponse> {
  try {
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();

    const { error } = await supabase
      .from("tenant_api_keys")
      .update({ is_active: isActive })
      .eq("id", keyId)
      .eq("tenant_id", tenantId);

    if (error) throw new Error(error.message);

    revalidatePath("/dashboard/settings/ai");
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function deleteApiKey(keyId: string): Promise<ActionResponse> {
  try {
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();

    const { error } = await supabase
      .from("tenant_api_keys")
      .delete()
      .eq("id", keyId)
      .eq("tenant_id", tenantId);

    if (error) throw new Error(error.message);

    revalidatePath("/dashboard/settings/ai");
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ------------------------------------------------------------------
// Task → Model Mappings
// ------------------------------------------------------------------

const VALID_TASKS = ["blog_generation", "social_caption", "image_generation"] as const;
export type ValidTask = (typeof VALID_TASKS)[number];

export async function getTaskModelMappings(): Promise<
  ActionResponse<TaskModelMapping[]>
> {
  try {
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();

    const { data, error } = await supabase
      .from("task_model_mappings")
      .select("*, model:ai_models(*, provider:ai_providers(*))")
      .eq("tenant_id", tenantId)
      .order("task");

    if (error) throw new Error(error.message);

    return { success: true, data: data as TaskModelMapping[] };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function saveTaskModelMapping(
  task: ValidTask,
  modelId: string
): Promise<ActionResponse<TaskModelMapping>> {
  try {
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();

    // Check if a mapping already exists for this tenant + task (client_id IS NULL)
    const { data: existing } = await supabase
      .from("task_model_mappings")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("task", task)
      .is("client_id", null)
      .limit(1);

    let data;

    if (existing && existing.length > 0) {
      // Update existing mapping
      const { data: updated, error } = await supabase
        .from("task_model_mappings")
        .update({ model_id: modelId })
        .eq("id", existing[0].id)
        .select("*, model:ai_models(*, provider:ai_providers(*))")
        .single();

      if (error) throw new Error(error.message);
      data = updated;
    } else {
      // Insert new mapping
      const { data: inserted, error } = await supabase
        .from("task_model_mappings")
        .insert({
          tenant_id: tenantId,
          task,
          model_id: modelId,
          client_id: null,
        })
        .select("*, model:ai_models(*, provider:ai_providers(*))")
        .single();

      if (error) throw new Error(error.message);
      data = inserted;
    }

    revalidatePath("/dashboard/settings/ai");
    return { success: true, data: data as TaskModelMapping };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
