import { createServiceClient } from "@/lib/supabase/server";
import { buildNavSections } from "@/lib/nav-sections";
import type { NavSection } from "@/components/NavDropdown";

export interface NavConfigItem {
  href: string;
  label: string;
}

export interface NavConfigSection {
  label: string;
  items: NavConfigItem[];
}

/**
 * Validate + sanitize a raw nav structure from the DB or a client request.
 * Returns null when nothing usable remains (caller falls back to defaults).
 * Only same-app paths are accepted for item hrefs — no javascript:/external.
 */
export function sanitizeNavSections(raw: unknown): NavConfigSection[] | null {
  if (!Array.isArray(raw)) return null;
  const sections: NavConfigSection[] = [];
  for (const s of raw) {
    if (!s || typeof s !== "object") continue;
    const sec = s as Record<string, unknown>;
    const label = typeof sec.label === "string" ? sec.label.trim() : "";
    if (!label) continue;
    const items: NavConfigItem[] = [];
    for (const it of Array.isArray(sec.items) ? sec.items : []) {
      if (!it || typeof it !== "object") continue;
      const item = it as Record<string, unknown>;
      const href = typeof item.href === "string" ? item.href.trim() : "";
      const itemLabel = typeof item.label === "string" ? item.label.trim() : "";
      if (!href.startsWith("/") || href.includes("://") || !itemLabel) continue;
      items.push({ href: href.slice(0, 200), label: itemLabel.slice(0, 60) });
    }
    if (items.length > 0) sections.push({ label: label.slice(0, 40), items });
  }
  return sections.length > 0 ? sections : null;
}

/**
 * The navigation sections for a tenant: the tenant's saved config when one
 * exists, otherwise the built-in default. Never throws — a corrupt row simply
 * falls back to the default so the shell always renders.
 */
export async function getNavSections(
  tenantId: string | null | undefined,
  isSuperAdmin: boolean
): Promise<NavSection[]> {
  if (!tenantId) return buildNavSections(isSuperAdmin);
  try {
    const supabase = await createServiceClient();
    const { data } = await supabase
      .from("nav_config")
      .select("sections")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    const sanitized = sanitizeNavSections(data?.sections);
    if (sanitized) return sanitized;
  } catch {
    // fall through to the default
  }
  return buildNavSections(isSuperAdmin);
}

/** Persist a validated nav structure for a tenant (upsert). */
export async function saveNavConfig(
  tenantId: string,
  sections: NavConfigSection[]
): Promise<void> {
  const sanitized = sanitizeNavSections(sections);
  if (!sanitized) throw new Error("Invalid navigation structure");

  const supabase = await createServiceClient();
  const record = {
    tenant_id: tenantId,
    sections: sanitized,
    updated_at: new Date().toISOString(),
  };
  const { data: existing } = await supabase
    .from("nav_config")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("nav_config")
      .update(record)
      .eq("tenant_id", tenantId);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("nav_config").insert(record);
    if (error) throw error;
  }
}

/** Delete a tenant's custom nav so it falls back to the built-in default. */
export async function resetNavConfig(tenantId: string): Promise<void> {
  const supabase = await createServiceClient();
  await supabase.from("nav_config").delete().eq("tenant_id", tenantId);
}
