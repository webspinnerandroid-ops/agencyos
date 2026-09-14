// ============================================================================
// api-keys.ts — machine API key auth (Phase 7).
//
// Scoped, revocable keys for machine access to agency-os (the orchestrator
// role from the original plan). Keys are shown ONCE at creation; only an
// HMAC-SHA256 digest is stored, so a DB dump cannot leak usable credentials.
// RLS-closed table (migration 106.6) — service-role reads only.
// ============================================================================

import crypto from "crypto";
import { createServiceClient } from "@/lib/supabase/server";

export type MachineScope = "read" | "write:clients" | "export" | "workflow";

const SCOPES: MachineScope[] = ["read", "write:clients", "export", "workflow"];

function pepper(): string {
  return (
    process.env.MACHINE_KEY_PEPPER ??
    process.env.AUTH_COOKIE_SECRET ??
    "agency-os-machine-key-pepper"
  );
}

function hashKey(raw: string): string {
  return crypto.createHmac("sha256", pepper()).update(raw).digest("hex");
}

export interface CreatedMachineKey {
  id: string;
  /** The raw key — the ONLY time it is ever returned. */
  rawKey: string;
  name: string;
  scopes: MachineScope[];
}

/** Mint a new machine key. Super-admin/admin callers only (route enforces). */
export async function createMachineKey(input: {
  tenantId: string;
  name: string;
  scopes?: MachineScope[];
  createdBy?: string | null;
}): Promise<CreatedMachineKey> {
  const supabase = await createServiceClient();
  const raw = `blm_${crypto.randomBytes(24).toString("base64url")}`;
  const scopes = (input.scopes ?? ["read"]).filter((s): s is MachineScope =>
    SCOPES.includes(s)
  );
  if (scopes.length === 0) scopes.push("read");

  const { data, error } = await supabase
    .from("machine_api_keys")
    .insert({
      tenant_id: input.tenantId,
      name: input.name.slice(0, 100),
      key_hash: hashKey(raw),
      scopes,
      created_by: input.createdBy ?? null,
    })
    .select("id, name, scopes")
    .single();
  if (error || !data) throw new Error(`createMachineKey failed: ${error?.message}`);
  return {
    id: data.id as string,
    rawKey: raw,
    name: data.name as string,
    scopes: data.scopes as MachineScope[],
  };
}

export interface MachineAuthContext {
  keyId: string;
  tenantId: string;
  scopes: MachineScope[];
  name: string;
}

/**
 * Authenticate a raw machine key (from the Authorization: Bearer header).
 * Returns null on unknown/revoked keys. Best-effort updates last_used_at.
 */
export async function authenticateMachineKey(
  authHeader: string | null
): Promise<MachineAuthContext | null> {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(blm_[A-Za-z0-9_-]+)$/);
  if (!match) return null;
  const raw = match[1];

  const supabase = await createServiceClient();
  const { data } = await supabase
    .from("machine_api_keys")
    .select("id, tenant_id, scopes, revoked_at, name")
    .eq("key_hash", hashKey(raw))
    .maybeSingle();
  if (!data) return null;
  if (data.revoked_at) return null;

  // Fire-and-forget usage stamp.
  void supabase
    .from("machine_api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id as string);

  return {
    keyId: data.id as string,
    tenantId: data.tenant_id as string,
    scopes: (data.scopes as MachineScope[]) ?? ["read"],
    name: (data.name as string) ?? "machine key",
  };
}

export function hasScope(ctx: MachineAuthContext, needed: MachineScope): boolean {
  return ctx.scopes.includes(needed);
}

/** Revoke immediately (route handler + admin UI). */
export async function revokeMachineKey(
  tenantId: string,
  keyId: string
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createServiceClient();
  const { error } = await supabase
    .from("machine_api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", keyId)
    .eq("tenant_id", tenantId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function listMachineKeys(
  tenantId: string
): Promise<{ id: string; name: string; scopes: string[]; revoked_at: string | null; last_used_at: string | null; created_at: string }[]> {
  const supabase = await createServiceClient();
  const { data, error } = await supabase
    .from("machine_api_keys")
    .select("id, name, scopes, revoked_at, last_used_at, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (error) return [];
  return (data ?? []) as {
    id: string;
    name: string;
    scopes: string[];
    revoked_at: string | null;
    last_used_at: string | null;
    created_at: string;
  }[];
}
