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
  drive_synced_at: string | null;
  drive_file_id: string | null;
  drive_error: string | null;
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

/**
 * Resolve the workspace for a knowledgebase operation. Callers inside a
 * workspace-scoped route MUST pass the route's workspaceId explicitly —
 * never rely on the cookie here, or items leak across workspaces when the
 * cookie points elsewhere.
 */
async function resolveWorkspace(workspaceId?: string): Promise<string> {
  return workspaceId ?? resolveWorkspaceId();
}

// ------------------------------------------------------------------
// Folders CRUD
// ------------------------------------------------------------------

export async function getFolders(
  parentFolderId: string | null = null,
  workspaceId?: string
): Promise<ActionResponse<KbFolder[]>> {
  try {
    const tenantId = await getTenantId();
    const wsId = await resolveWorkspace(workspaceId);
    const supabase = getAdminClient();

    let query = supabase
      .from("knowledgebase_folders")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("workspace_id", wsId)
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
  parentFolderId: string | null = null,
  workspaceId?: string
): Promise<ActionResponse<KbFolder>> {
  try {
    const tenantId = await getTenantId();
    const wsId = await resolveWorkspace(workspaceId);
    const supabase = getAdminClient();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

    const { data, error } = await supabase
      .from("knowledgebase_folders")
      .insert({
        tenant_id: tenantId,
        workspace_id: wsId,
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

export async function deleteFolder(
  folderId: string,
  workspaceId?: string
): Promise<ActionResponse> {
  try {
    const tenantId = await getTenantId();
    const wsId = await resolveWorkspace(workspaceId);
    const supabase = getAdminClient();

    const { error } = await supabase
      .from("knowledgebase_folders")
      .delete()
      .eq("id", folderId)
      .eq("tenant_id", tenantId)
      .eq("workspace_id", wsId);

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
  folderId: string | null = null,
  workspaceId?: string
): Promise<ActionResponse<KbItem[]>> {
  try {
    const tenantId = await getTenantId();
    const wsId = await resolveWorkspace(workspaceId);
    const supabase = getAdminClient();

    let query = supabase
      .from("knowledgebase_items")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("workspace_id", wsId)
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
  folderId: string | null = null,
  workspaceId?: string
): Promise<ActionResponse<KbItem>> {
  try {
    const tenantId = await getTenantId();
    const wsId = await resolveWorkspace(workspaceId);
    const supabase = getAdminClient();

    // Store a normalized URL so the crawl matches the seed row in place
    // (strip trailing slash) instead of creating a duplicate page row.
    let normalizedUrl: string;
    try {
      normalizedUrl = new URL(url).href.replace(/\/$/, "");
    } catch {
      normalizedUrl = url;
    }

    const { data, error } = await supabase
      .from("knowledgebase_items")
      .insert({
        tenant_id: tenantId,
        workspace_id: wsId,
        folder_id: folderId || null,
        name,
        type: "url",
        source_url: normalizedUrl,
        status: "pending",
      })
      .select("*")
      .single();

    if (error) throw new Error(error.message);

    // Start scraping asynchronously (fire and forget)
    scrapeUrlItem(data.id, normalizedUrl, tenantId, wsId);

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
  folderId: string | null = null,
  workspaceId?: string
): Promise<ActionResponse<KbItem>> {
  try {
    const tenantId = await getTenantId();
    const wsId = await resolveWorkspace(workspaceId);
    const supabase = getAdminClient();

    const { data, error } = await supabase
      .from("knowledgebase_items")
      .insert({
        tenant_id: tenantId,
        workspace_id: wsId,
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

export async function deleteItem(
  itemId: string,
  workspaceId?: string
): Promise<ActionResponse> {
  try {
    const tenantId = await getTenantId();
    const wsId = await resolveWorkspace(workspaceId);
    const supabase = getAdminClient();

    // Get storage_path before deleting — must be scoped to this tenant + workspace
    // or a caller could delete another workspace's storage object by item id.
    const { data: item } = await supabase
      .from("knowledgebase_items")
      .select("storage_path")
      .eq("id", itemId)
      .eq("tenant_id", tenantId)
      .eq("workspace_id", wsId)
      .single();

    // Delete from storage if file exists
    if (item?.storage_path) {
      await supabase.storage.from("tenant-assets").remove([item.storage_path]);
    }

    const { error } = await supabase
      .from("knowledgebase_items")
      .delete()
      .eq("id", itemId)
      .eq("tenant_id", tenantId)
      .eq("workspace_id", wsId);

    if (error) throw new Error(error.message);
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ------------------------------------------------------------------
// URL Scraping (crawls the whole site, staying same-domain)
// ------------------------------------------------------------------

const FETCH_UA = "AgencyOS/1.0 Knowledgebase Scraper";
const CRAWL_MAX_PAGES = 100; // hard cap so huge sites can't run forever
const CRAWL_MAX_IMAGES = 150; // per-site cap for downloaded images

/** Skip file types that are clearly not HTML pages. */
const SKIP_EXT = /(?:\.(?:png|jpe?g|gif|svg|webp|avif|ico|css|js|json|xml|pdf|zip|gz|mp4|webm|mp3|wav|mov|woff2?|ttf|ico))(?:\.|[?#]|$)/i;

/** Skip private/logout/in-page/capture destinations we must never follow. */
function isFollowableHref(href: string): boolean {
  if (!href) return false;
  const raw = href.trim();
  if (!raw || raw.startsWith("#") || raw.startsWith("mailto:") || raw.startsWith("tel:") || raw.startsWith("javascript:")) return false;
  return !SKIP_EXT.test(raw);
}

/** True when both URLs share the same hostname (stays on-site). */
function sameSite(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.hostname.toLowerCase() === ub.hostname.toLowerCase();
  } catch {
    return false;
  }
}

async function fetchHtml(fullUrl: string): Promise<string> {
  const response = await fetch(fullUrl, {
    headers: { "User-Agent": FETCH_UA },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  const type = response.headers.get("content-type") ?? "";
  // Guard against following a URL that quietly redirects to a binary asset.
  if (type && /image\/|application\/pdf|video\/|audio\//.test(type)) {
    throw new Error(`Skipping non-page content (${type})`);
  }
  return await response.text();
}

/** Insert one scraped page as a knowledgebase url item (skips duplicates). */
async function upsertPageItem(
  supabase: ReturnType<typeof getAdminClient>,
  tenantId: string,
  workspaceId: string,
  name: string,
  fullUrl: string,
  html: string
): Promise<{ text: string; title: string; images: string[] }> {
  const $ = cheerio.load(html);
  $("script, style, nav, footer, header, .nav, .footer, .header, .sidebar, .menu, noscript, iframe").remove();

  const title = $("title").text().trim() || $("h1").first().text().trim() || name;
  const metaDescription = $('meta[name="description"]').attr("content") ?? "";
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const truncatedText = bodyText.substring(0, 50000);

  // Collect same-domain image URLs only — external/CDN-hosted images stay out.
  const images: string[] = [];
  $("img").each((_, el) => {
    const src = $(el).attr("src") || $(el).attr("data-src") || "";
    if (!src) return;
    try {
      const abs = new URL(src, fullUrl).href;
      if (sameSite(abs, fullUrl)) images.push(abs);
    } catch { /* skip malformed */ }
  });

  const metadata = {
    title,
    metaDescription,
    url: fullUrl,
    scrapedAt: new Date().toISOString(),
    contentLength: bodyText.length,
    crawled: true,
  };

  // Reuse an existing row for this exact URL; otherwise insert one.
  const { data: existing } = await supabase
    .from("knowledgebase_items")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("workspace_id", workspaceId)
    .eq("type", "url")
    .eq("source_url", fullUrl)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("knowledgebase_items")
      .update({ scraped_text: truncatedText, extracted_metadata: metadata, status: "ready" })
      .eq("id", existing.id)
      .eq("tenant_id", tenantId);
  } else {
    await supabase
      .from("knowledgebase_items")
      .insert({
        tenant_id: tenantId,
        workspace_id: workspaceId,
        name: title,
        type: "url",
        source_url: fullUrl,
        scraped_text: truncatedText,
        extracted_metadata: metadata,
        status: "ready",
      });
  }

  return { text: bodyText, title, images };
}

/** Download one image and store it into the workspace knowledgebase. */
async function storeCrawledImage(
  supabase: ReturnType<typeof getAdminClient>,
  tenantId: string,
  workspaceId: string,
  imageUrl: string
): Promise<void> {
  try {
    const response = await fetch(imageUrl, {
      headers: { "User-Agent": FETCH_UA },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) return;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0 || buffer.length > 8 * 1024 * 1024) return; // skip empty / >8MB

    const type = response.headers.get("content-type")?.split(";")[0]?.trim() || "image/webp";
    const ext = type === "image/png" ? "png" : type === "image/gif" ? "gif" : type === "image/jpeg" || type === "image/jpg" ? "jpg" : type.match(/\/(svg|webp|avif|ico|bmp)$/)?.[1] ?? "webp";
    const storagePath = `${tenantId}/workspaces/${workspaceId}/knowledgebase/crawl/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from("tenant-assets")
      .upload(storagePath, buffer, { contentType: type, upsert: false });
    if (upErr) return;

    const { data: urlData } = supabase.storage.from("tenant-assets").getPublicUrl(storagePath);
    const name = imageUrl.split("/").pop()?.replace(/[?#].*/, "") || "image";

    const { data: existing } = await supabase
      .from("knowledgebase_items")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("workspace_id", workspaceId)
      .eq("type", "image")
      .eq("source_url", imageUrl)
      .maybeSingle();
    if (existing) return;

    await supabase.from("knowledgebase_items").insert({
      tenant_id: tenantId,
      workspace_id: workspaceId,
      name,
      type: "image",
      source_url: imageUrl,
      storage_path: storagePath,
      mime_type: type,
      file_size: buffer.length,
      extracted_metadata: { publicUrl: urlData.publicUrl, sourceUrl: imageUrl, crawled: true },
      status: "ready",
    });
  } catch { /* image storage is best-effort */ }
}

/**
 * Crawl the site starting at `url`, staying same-domain. Every internal page
 * becomes its own url knowledgebase item, and same-domain images are
 * downloaded into the workspace as image items. Runs fire-and-forget from
 * addUrlItem. The originally-created row represents the seed page.
 */
async function scrapeUrlItem(
  itemId: string,
  url: string,
  tenantId: string,
  workspaceId: string
) {
  const supabase = getAdminClient();
  const markStatus = async (status: "scraping" | "ready" | "error", message?: string) =>
    supabase
      .from("knowledgebase_items")
      .update({
        status,
        ...(message ? { error_message: message } : {}),
        ...(status === "ready"
          ? { extracted_metadata: { crawled: true, scrapedAt: new Date().toISOString() } }
          : {}),
      })
      .eq("id", itemId)
      .eq("tenant_id", tenantId);

  try {
    await markStatus("scraping");

    const queue: string[] = [url];
    const visited = new Set<string>();
    const imageSet = new Set<string>();
    let pageCount = 0;

    while (queue.length > 0 && pageCount < CRAWL_MAX_PAGES) {
      const current = queue.shift()!;
      const normalized = new URL(current).href.replace(/\/$/, "");
      if (visited.has(normalized)) continue;
      visited.add(normalized);

      let html: string;
      try {
        html = await fetchHtml(normalized);
      } catch {
        continue; // a failed page should never abort the crawl
      }

      const { images } = await upsertPageItem(supabase, tenantId, workspaceId, normalized, normalized, html);
      pageCount++;

      // Harvest same-domain images from this page.
      for (const img of images) {
        if (imageSet.size < CRAWL_MAX_IMAGES) imageSet.add(img);
      }

      // Discover internal pages to enqueue next.
      const $ = cheerio.load(html);
      $("a[href]").each((_, el) => {
        const href = $(el).attr("href") || "";
        if (!isFollowableHref(href)) return;
        let abs: string;
        try {
          abs = new URL(href, normalized).href;
        } catch {
          return;
        }
        if (!sameSite(abs, normalized)) return;
        const clean = abs.replace(/\/$/, "");
        if (!visited.has(clean) && !queue.includes(clean)) {
          queue.push(clean);
        }
      });
    }

    // Download harvested same-domain images (best-effort, sequential).
    let storedImages = 0;
    for (const img of imageSet) {
      if (storedImages >= CRAWL_MAX_IMAGES) break;
      await storeCrawledImage(supabase, tenantId, workspaceId, img);
      storedImages++;
    }

    await markStatus("ready");
  } catch (err: any) {
    await markStatus("error", err?.message ?? "Unknown error during crawling");
  }
}

// ------------------------------------------------------------------
// Linkable pages (used for internal links in generated content)
// ------------------------------------------------------------------

/**
 * Ready URL items in a workspace that can be internal-link targets — the
 * source of truth for the [INTERNAL LINK] resolution in generated blogs.
 * Each page carries its real URL (extracted_metadata.url) plus scraped
 * text for topic matching.
 */
export async function getWorkspaceLinkablePages(
  workspaceId: string,
  tenantId: string
): Promise<{ title: string; url: string; text: string }[]> {
  const supabase = getAdminClient();

  const { data: items } = await supabase
    .from("knowledgebase_items")
    .select("name, scraped_text, extracted_metadata")
    .eq("workspace_id", workspaceId)
    .eq("tenant_id", tenantId)
    .eq("type", "url")
    .eq("status", "ready")
    .order("created_at", { ascending: false })
    .limit(50);

  if (!items) return [];

  const pages: { title: string; url: string; text: string }[] = [];
  for (const item of items) {
    const meta = (item.extracted_metadata as Record<string, any>) ?? {};
    const url = typeof meta.url === "string" ? meta.url : "";
    if (!url) continue;
    pages.push({
      title: typeof meta.title === "string" && meta.title ? meta.title : item.name,
      url,
      text: item.scraped_text ?? "",
    });
  }
  return pages;
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