"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { getTenantId } from "@/lib/auth";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import * as cheerio from "cheerio";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

export interface KbFolder {
  id: string;
  workspace_id: string;
  parent_folder_id: string | null;
  name: string;
  slug: string;
  created_at: string;
}

export interface KbItem {
  id: string;
  folder_id: string | null;
  workspace_id: string;
  name: string;
  type: "url" | "doc" | "image" | "video" | "text";
  source_url: string | null;
  original_filename: string | null;
  storage_path: string | null;
  mime_type: string | null;
  file_size: number | null;
  scraped_text: string | null;
  extracted_metadata: Record<string, any>;
  status: "pending" | "scraping" | "extracting" | "ready" | "error";
  error_message: string | null;
  created_at: string;
}

export interface ActionResponse<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

import { getDefaultWorkspace } from "./workspace";

async function resolveWorkspaceId(): Promise<string> {
  const wsId = await getCurrentWorkspaceId();
  if (wsId) return wsId;
  // Auto-select default workspace if none selected
  const def = await getDefaultWorkspace();
  if (!def.success || !def.data) throw new Error("No workspace available. Create one in dashboard/workspaces.");
  return def.data.id;
}

// ------------------------------------------------------------------
// Folders CRUD
// ------------------------------------------------------------------

export async function getFolders(
  parentFolderId: string | null = null
): Promise<ActionResponse<KbFolder[]>> {
  try {
    const tenantId = await getTenantId();
    const workspaceId = await resolveWorkspaceId();
    const supabase = getAdminClient();

    let query = supabase
      .from("knowledgebase_folders")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("workspace_id", workspaceId)
      .order("name");

    if (parentFolderId === null) {
      query = query.is("parent_folder_id", null);
    } else {
      query = query.eq("parent_folder_id", parentFolderId);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return { success: true, data: data as KbFolder[] };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function createFolder(
  name: string,
  parentFolderId: string | null = null
): Promise<ActionResponse<KbFolder>> {
  try {
    const tenantId = await getTenantId();
    const workspaceId = await resolveWorkspaceId();
    const supabase = getAdminClient();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

    const { data, error } = await supabase
      .from("knowledgebase_folders")
      .insert({
        tenant_id: tenantId,
        workspace_id: workspaceId,
        name,
        slug,
        parent_folder_id: parentFolderId || null,
      })
      .select("*")
      .single();

    if (error) throw new Error(error.message);
    return { success: true, data: data as KbFolder };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function deleteFolder(folderId: string): Promise<ActionResponse> {
  try {
    const tenantId = await getTenantId();
    const supabase = getAdminClient();

    const { error } = await supabase
      .from("knowledgebase_folders")
      .delete()
      .eq("id", folderId)
      .eq("tenant_id", tenantId);

    if (error) throw new Error(error.message);
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ------------------------------------------------------------------
// Items CRUD
// ------------------------------------------------------------------

export async function getItems(
  folderId: string | null = null
): Promise<ActionResponse<KbItem[]>> {
  try {
    const tenantId = await getTenantId();
    const workspaceId = await resolveWorkspaceId();
    const supabase = getAdminClient();

    let query = supabase
      .from("knowledgebase_items")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });

    if (folderId === null) {
      query = query.is("folder_id", null);
    } else {
      query = query.eq("folder_id", folderId);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return { success: true, data: data as KbItem[] };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ------------------------------------------------------------------
// Add URL item (scrape in background)
// ------------------------------------------------------------------

export async function addUrlItem(
  name: string,
  url: string,
  folderId: string | null = null
): Promise<ActionResponse<KbItem>> {
  try {
    const tenantId = await getTenantId();
    const workspaceId = await resolveWorkspaceId();
    const supabase = getAdminClient();

    const { data, error } = await supabase
      .from("knowledgebase_items")
      .insert({
        tenant_id: tenantId,
        workspace_id: workspaceId,
        folder_id: folderId || null,
        name,
        type: "url",
        source_url: url,
        status: "pending",
      })
      .select("*")
      .single();

    if (error) throw new Error(error.message);

    // Start scraping asynchronously (fire and forget)
    scrapeUrlItem(data.id, url, tenantId, workspaceId);

    return { success: true, data: data as KbItem };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ------------------------------------------------------------------
// Add text item
// ------------------------------------------------------------------

export async function addTextItem(
  name: string,
  text: string,
  folderId: string | null = null
): Promise<ActionResponse<KbItem>> {
  try {
    const tenantId = await getTenantId();
    const workspaceId = await resolveWorkspaceId();
    const supabase = getAdminClient();

    const { data, error } = await supabase
      .from("knowledgebase_items")
      .insert({
        tenant_id: tenantId,
        workspace_id: workspaceId,
        folder_id: folderId || null,
        name,
        type: "text",
        scraped_text: text,
        status: "ready",
      })
      .select("*")
      .single();

    if (error) throw new Error(error.message);
    return { success: true, data: data as KbItem };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ------------------------------------------------------------------
// Delete item
// ------------------------------------------------------------------

export async function deleteItem(itemId: string): Promise<ActionResponse> {
  try {
    const tenantId = await getTenantId();
    const supabase = getAdminClient();

    // Get storage_path before deleting
    const { data: item } = await supabase
      .from("knowledgebase_items")
      .select("storage_path")
      .eq("id", itemId)
      .single();

    // Delete from storage if file exists
    if (item?.storage_path) {
      await supabase.storage.from("tenant-assets").remove([item.storage_path]);
    }

    const { error } = await supabase
      .from("knowledgebase_items")
      .delete()
      .eq("id", itemId)
      .eq("tenant_id", tenantId);

    if (error) throw new Error(error.message);
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ------------------------------------------------------------------
// URL Scraping (inline, called from addUrlItem)
// ------------------------------------------------------------------

async function scrapeUrlItem(
  itemId: string,
  url: string,
  tenantId: string,
  workspaceId: string
) {
  const supabase = getAdminClient();

  try {
    // Mark as scraping
    await supabase
      .from("knowledgebase_items")
      .update({ status: "scraping" })
      .eq("id", itemId);

    const response = await fetch(url, {
      headers: { "User-Agent": "AgencyOS/1.0 Knowledgebase Scraper" },
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    const html = await response.text();
    const $ = cheerio.load(html);

    // Remove scripts, styles, nav, footer
    $("script, style, nav, footer, header, .nav, .footer, .header, .sidebar, .menu").remove();

    const title = $("title").text().trim() || $("h1").first().text().trim();
    const metaDescription = $('meta[name="description"]').attr("content") ?? "";
    const bodyText = $("body").text().replace(/\s+/g, " ").trim();
    const truncatedText = bodyText.substring(0, 50000);

    const metadata = {
      title,
      metaDescription,
      url,
      scrapedAt: new Date().toISOString(),
      contentLength: bodyText.length,
    };

    await supabase
      .from("knowledgebase_items")
      .update({
        scraped_text: truncatedText,
        extracted_metadata: metadata,
        status: "ready",
      })
      .eq("id", itemId);
  } catch (err: any) {
    await supabase
      .from("knowledgebase_items")
      .update({
        status: "error",
        error_message: err?.message ?? "Unknown error during scraping",
      })
      .eq("id", itemId);
  }
}

// ------------------------------------------------------------------
// Get all ready items for a workspace (used by AI orchestrator)
// ------------------------------------------------------------------

export async function getWorkspaceKnowledgeContext(
  workspaceId: string,
  tenantId: string
): Promise<string> {
  const supabase = getAdminClient();

  const { data: items } = await supabase
    .from("knowledgebase_items")
    .select("name, type, scraped_text, extracted_metadata, folder:knowledgebase_folders(name)")
    .eq("workspace_id", workspaceId)
    .eq("tenant_id", tenantId)
    .eq("status", "ready")
    .order("created_at", { ascending: false })
    .limit(50);

  if (!items || items.length === 0) return "";

  const parts: string[] = ["KNOWLEDGEBASE CONTEXT:"];

  for (const item of items) {
    const folderName = (item as any).folder?.name ?? "Root";
    const typeLabel = item.type === "url" ? "Scraped URL" : item.type === "text" ? "Text" : "Document";
    const source = item.type === "url" ? ` (${(item.extracted_metadata as any)?.url ?? ""})` : "";

    parts.push(`\n--- ${folderName} > ${item.name} [${typeLabel}]${source} ---`);
    if (item.scraped_text) {
      const preview = item.scraped_text.substring(0, 3000);
      parts.push(preview);
    }
  }

  return parts.join("\n");
}