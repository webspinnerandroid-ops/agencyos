// ============================================================================
// Connected-sites publisher — dispatches the "Publish to Connected Sites"
// dialog targets to the right platform backend:
//
//   wordpress / wordpress_jetpack → WordPress REST API (wordpressPublisher.ts)
//   ghost                         → Ghost Admin API (JWT)
//   medium                        → Medium REST API (create only)
//   webflow                       → Webflow CMS API v2
//   builtin_cms                   → this app's own site_pages CMS
//
// Every target site is fetched tenant-scoped; a failure on one site never
// blocks the others. When a saved post id is supplied, each attempt is
// recorded in publishing_logs (with site name + live URL) so the dashboard
// and Posts list can show per-post publish history with links.
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import { createHmac } from "crypto";
import { decrypt } from "@/lib/encryption";
import { markdownBodyToCmsBlocks, newBlockId, slugify } from "@/lib/cms";
import {
  buildAuthHeader,
  listSiteContent,
  markdownToPublishHtml,
  publishGeneratedContentToSites,
  type GeneratedContentPayload,
  type GeneratedContentTarget,
  type WpPublishResult,
} from "./wordpressPublisher";

// ----------------------------------------------------------------------------
// Constants + service client
// ----------------------------------------------------------------------------

/** Sentinel blog_platforms id used by the built-in CMS target (no DB row). */
export const BUILTIN_CMS_PLATFORM_ID = "builtin_cms";

export interface SiteContentItem {
  id: number | string;
  title: string;
  link: string;
  slug: string;
  date: string | null;
}

function createServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

/** Record one publish attempt for a saved post (no-op when postId is null). */
async function logPublishAttempt(
  supabase: ReturnType<typeof createServiceSupabase>,
  entry: {
    postId: string | null;
    platform: string;
    success: boolean;
    errorMessage?: string;
    siteName?: string;
    targetUrl?: string;
  }
): Promise<void> {
  if (!entry.postId) return;
  try {
    await supabase.from("publishing_logs").insert({
      post_id: entry.postId,
      platform: entry.platform,
      attempt_at: new Date().toISOString(),
      success: entry.success,
      error_message: entry.errorMessage ?? null,
      site_name: entry.siteName ?? null,
      target_url: entry.targetUrl ?? null,
    });
  } catch {
    // Logging must never break a publish.
  }
}

function slugFromTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "post";
}

// ----------------------------------------------------------------------------
// Dispatcher
// ----------------------------------------------------------------------------

/**
 * Publish generated content to a chosen set of connected sites (any platform).
 * Creates a new post/page on each site, or overwrites an existing one (where
 * the platform's API supports it). Optionally uploads the generated images
 * into each site so the published piece is self-contained.
 */
export async function publishToConnectedSites(
  tenantId: string,
  targets: GeneratedContentTarget[],
  content: GeneratedContentPayload,
  postId?: string | null
): Promise<{ allSucceeded: boolean; results: WpPublishResult[] }> {
  const supabase = createServiceSupabase();
  const results: WpPublishResult[] = [];

  for (const target of targets) {
    // ---- Built-in CMS (no blog_platforms row) ----
    if (target.blogPlatformId === BUILTIN_CMS_PLATFORM_ID) {
      const builtin = await publishToBuiltinCms(tenantId, [target], content);
      const result = builtin.results[0];
      results.push(result);
      await logPublishAttempt(supabase, {
        postId: postId ?? null,
        platform: "builtin_cms",
        success: result.success,
        errorMessage: result.errorMessage,
        siteName: "Built-in website",
        targetUrl: result.wpPostUrl,
      });
      // Keep the saved post's "On site" badge in sync with the built-in CMS.
      if (postId && result.success && result.wpPostUrl?.startsWith("/site/")) {
        const slug = result.wpPostUrl.replace(/^\/site\//, "").replace(/\/$/, "");
        try {
          await supabase
            .from("posts")
            .update({ cms_published_at: new Date().toISOString(), cms_slug: slug })
            .eq("id", postId)
            .eq("tenant_id", tenantId);
        } catch {
          // badge is cosmetic — never fail a publish over it
        }
      }
      continue;
    }

    // ---- Connected platform row ----
    const { data: bp, error: bpError } = await supabase
      .from("blog_platforms")
      .select("id, site_url, site_name, platform_type, encrypted_credentials")
      .eq("id", target.blogPlatformId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (bpError || !bp) {
      results.push({
        success: false,
        blogPlatformId: target.blogPlatformId,
        errorMessage: "Connected site not found",
      });
      continue;
    }

    const platformType = bp.platform_type as string;
    const siteName = bp.site_name || bp.site_url;

    let credentials: Record<string, string> = {};
    try {
      if (bp.encrypted_credentials) {
        credentials = JSON.parse(decrypt(bp.encrypted_credentials) ?? "{}");
      }
    } catch {
      results.push({
        success: false,
        blogPlatformId: target.blogPlatformId,
        siteName,
        errorMessage: "Failed to decrypt credentials",
      });
      continue;
    }

    let result: WpPublishResult;
    if (platformType === "wordpress" || platformType === "wordpress_jetpack") {
      const wp = await publishGeneratedContentToSites(tenantId, [target], content);
      result = wp.results[0] ?? {
        success: false,
        errorMessage: "WordPress publish failed",
      };
    } else if (platformType === "ghost") {
      result = await publishToGhost(bp.site_url, credentials, target, content);
    } else if (platformType === "medium") {
      result = await publishToMedium(credentials, target, content);
    } else if (platformType === "webflow") {
      result = await publishToWebflow(bp.site_url, credentials, target, content);
    } else {
      results.push({
        success: false,
        blogPlatformId: target.blogPlatformId,
        siteName,
        errorMessage: `Publishing to ${platformType} is not supported yet`,
      });
      continue;
    }
    result.blogPlatformId = target.blogPlatformId;
    result.siteName = siteName;

    results.push(result);
    await logPublishAttempt(supabase, {
      postId: postId ?? null,
      platform: platformType,
      success: result.success,
      errorMessage: result.errorMessage,
      siteName,
      targetUrl: result.wpPostUrl,
    });
  }

  const allSucceeded = results.length > 0 && results.every((r) => r.success);
  return { allSucceeded, results };
}

// ----------------------------------------------------------------------------
// Built-in CMS (site_pages)
// ----------------------------------------------------------------------------

/**
 * Publish to the tenant's OWN website built in this system (site_pages).
 * kind "page" → a page row; kind "post" → a blog_post row. Overwrite targets
 * a specific page id; create upserts by (tenant, slug) like the saved-post
 * "Your Website (CMS)" flow. Images become CMS image blocks (URLs are stored
 * as-is — no external upload needed for the built-in site).
 */
export async function publishToBuiltinCms(
  tenantId: string,
  targets: GeneratedContentTarget[],
  content: GeneratedContentPayload
): Promise<{ allSucceeded: boolean; results: WpPublishResult[] }> {
  const supabase = createServiceSupabase();
  const results: WpPublishResult[] = [];

  for (const target of targets) {
    const kind = target.kind === "page" ? "page" : "blog_post";
    const slug = content.slug || slugify(content.title) || "page";
    const now = new Date().toISOString();
    const blocks = markdownBodyToCmsBlocks(content.body ?? "");

    // Optional featured image becomes the first block when images are enabled.
    const firstImage = content.images?.[0];
    if (target.includeImages && firstImage?.url) {
      blocks.unshift({
        id: newBlockId(),
        kind: "image",
        url: firstImage.url,
        alt: firstImage.alt || firstImage.description || "",
        style: {},
      });
    }

    const patch = {
      title: content.title,
      slug,
      blocks,
      kind,
      is_published: true,
      preview_token: crypto.randomUUID(),
      published_at: now,
      updated_at: now,
    };

    try {
      if (target.mode === "overwrite") {
        if (target.wpPostId === undefined || target.wpPostId === null || target.wpPostId === "") {
          results.push({
            success: false,
            blogPlatformId: target.blogPlatformId,
            siteName: "Built-in website",
            errorMessage: "No existing page selected to overwrite",
          });
          continue;
        }
        const { data: existing } = await supabase
          .from("site_pages")
          .select("id")
          .eq("id", target.wpPostId)
          .eq("tenant_id", tenantId)
          .maybeSingle();
        if (!existing) {
          results.push({
            success: false,
            blogPlatformId: target.blogPlatformId,
            siteName: "Built-in website",
            errorMessage: "Page not found to overwrite",
          });
          continue;
        }
        await supabase
          .from("site_pages")
          .update(patch)
          .eq("id", existing.id)
          .eq("tenant_id", tenantId);
        results.push({
          success: true,
          blogPlatformId: target.blogPlatformId,
          siteName: "Built-in website",
          wpPostId: existing.id,
          wpPostUrl: `/site/${slug}`,
        });
      } else {
        // Create — upsert by (tenant, slug) so re-publishing a page keeps one
        // row instead of stacking duplicates.
        const { data: existing } = await supabase
          .from("site_pages")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("slug", slug)
          .maybeSingle();
        if (existing) {
          await supabase
            .from("site_pages")
            .update(patch)
            .eq("id", existing.id)
            .eq("tenant_id", tenantId);
        } else {
          await supabase.from("site_pages").insert({
            ...patch,
            tenant_id: tenantId,
            workspace_id: null,
            client_id: null,
          });
        }
        results.push({
          success: true,
          blogPlatformId: target.blogPlatformId,
          siteName: "Built-in website",
          wpPostUrl: `/site/${slug}`,
        });
      }
    } catch (err: any) {
      results.push({
        success: false,
        blogPlatformId: target.blogPlatformId,
        siteName: "Built-in website",
        errorMessage: err?.message || "Built-in CMS publish failed",
      });
    }
  }

  const allSucceeded = results.length > 0 && results.every((r) => r.success);
  return { allSucceeded, results };
}

// ----------------------------------------------------------------------------
// Ghost Admin API
// ----------------------------------------------------------------------------

/** Build the Ghost Admin API JWT from an "<id>:<secret>" admin API key. */
export function ghostAuthHeader(adminApiKey: string): string {
  const [id, secret] = adminApiKey.split(":");
  if (!id || !secret) return "";
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  const header = b64({ alg: "HS256", kid: id, typ: "JWT" });
  const payload = b64({ iat: now, exp: now + 300, aud: "/admin/" });
  const sig = createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `Ghost ${header}.${payload}.${sig}`;
}

async function ghostUploadImage(
  base: string,
  auth: string,
  image: { url: string; alt?: string }
): Promise<string | null> {
  try {
    const imgRes = await fetch(image.url, { signal: AbortSignal.timeout(30_000) });
    if (!imgRes.ok) return null;
    const bytes = Buffer.from(await imgRes.arrayBuffer());
    const contentType = imgRes.headers.get("content-type") ?? "image/jpeg";
    const ext = contentType.includes("png")
      ? "png"
      : contentType.includes("webp")
        ? "webp"
        : contentType.includes("gif")
          ? "gif"
          : "jpg";
    const fd = new FormData();
    fd.append(
      "file",
      new Blob([bytes], { type: contentType }),
      `image-${Date.now()}.${ext}`
    );
    const res = await fetch(`${base}/images/upload/`, {
      method: "POST",
      headers: { Authorization: auth },
      body: fd,
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.images?.[0]?.url ?? null;
  } catch {
    return null;
  }
}

export async function publishToGhost(
  siteUrl: string,
  credentials: Record<string, string>,
  target: GeneratedContentTarget,
  content: GeneratedContentPayload
): Promise<WpPublishResult> {
  const adminApiKey = credentials.adminApiKey || credentials.apiKey;
  if (!adminApiKey) {
    return { success: false, errorMessage: "Ghost Admin API key missing" };
  }
  const auth = ghostAuthHeader(adminApiKey);
  if (!auth) {
    return { success: false, errorMessage: "Ghost Admin API key is malformed" };
  }
  const base = siteUrl.replace(/\/$/, "") + "/ghost/api/admin";

  let bodyHtml = markdownToPublishHtml(content.body ?? "");
  let featureImage: string | null = null;
  if (target.includeImages && Array.isArray(content.images) && content.images.length > 0) {
    const urlToGhost = new Map<string, string>();
    for (const img of content.images) {
      if (!img.url) continue;
      const uploaded = await ghostUploadImage(base, auth, {
        url: img.url,
        alt: img.alt || img.description || "",
      });
      if (!uploaded) continue;
      if (featureImage == null && img.placement === "featured") featureImage = uploaded;
      urlToGhost.set(img.url, uploaded);
    }
    if (featureImage == null && content.images[0]?.url) {
      featureImage = urlToGhost.get(content.images[0].url) ?? null;
    }
    for (const [oldUrl, newUrl] of urlToGhost) {
      bodyHtml = bodyHtml.split(oldUrl).join(newUrl);
    }
  }

  const post: Record<string, unknown> = {
    title: content.title,
    html: bodyHtml,
    status: "published",
    slug: content.slug || slugFromTitle(content.title),
  };
  if (content.metaDescription) post.meta_description = content.metaDescription;
  if (featureImage) post.feature_image = featureImage;

  try {
    const isOverwrite = target.mode === "overwrite" && target.wpPostId != null && target.wpPostId !== "";
    const url = isOverwrite
      ? `${base}/posts/${target.wpPostId}/`
      : `${base}/posts/`;
    const res = await fetch(url, {
      method: isOverwrite ? "PUT" : "POST",
      headers: { "Content-Type": "application/json", Authorization: auth },
      body: JSON.stringify({ posts: [post] }),
      signal: AbortSignal.timeout(60_000),
    });
    const data = await res.json();
    if (!res.ok) {
      const firstError = data?.errors?.[0];
      return {
        success: false,
        errorMessage:
          firstError?.message ||
          firstError?.context ||
          data?.errors?.map((e: any) => e.message).join("; ") ||
          `HTTP ${res.status}`,
      };
    }
    const created = data?.posts?.[0];
    return {
      success: true,
      wpPostId: created?.id ?? target.wpPostId,
      wpPostUrl: created?.url,
    };
  } catch (err: any) {
    return { success: false, errorMessage: err?.message || "Network error" };
  }
}

async function listGhostPosts(
  base: string,
  auth: string,
  search?: string
): Promise<SiteContentItem[]> {
  try {
    const params = new URLSearchParams({ limit: "all", order: "updated_at desc" });
    if (search && search.trim()) {
      params.set("filter", `title:~'${search.trim().replace(/'/g, "")}'`);
    }
    const res = await fetch(`${base}/posts/?${params.toString()}`, {
      headers: { Authorization: auth },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return ((data?.posts as any[]) ?? []).map((p) => ({
      id: p?.id,
      title: p?.title ?? "Untitled",
      link: p?.url ?? "",
      slug: p?.slug ?? "",
      date: p?.updated_at ?? p?.published_at ?? null,
    }));
  } catch {
    return [];
  }
}

// ----------------------------------------------------------------------------
// Medium REST API (create only — the API exposes no post listing/update)
// ----------------------------------------------------------------------------

export async function publishToMedium(
  credentials: Record<string, string>,
  target: GeneratedContentTarget,
  content: GeneratedContentPayload
): Promise<WpPublishResult> {
  const token = credentials.apiToken || credentials.apiKey;
  if (!token) {
    return { success: false, errorMessage: "Medium integration token missing" };
  }
  if (target.mode === "overwrite") {
    return {
      success: false,
      errorMessage:
        "Medium's API doesn't support overwriting existing posts — create a new post instead.",
    };
  }
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  try {
    const meRes = await fetch("https://api.medium.com/v1/me", {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    const me = await meRes.json();
    const userId = me?.data?.id;
    if (!meRes.ok || !userId) {
      return {
        success: false,
        errorMessage: me?.errors?.[0]?.message || "Failed to authenticate with Medium",
      };
    }
    const body: Record<string, unknown> = {
      title: content.title,
      contentFormat: "html",
      content: markdownToPublishHtml(content.body ?? ""),
      publishStatus: "public",
      tags: [],
    };
    const res = await fetch(`https://api.medium.com/v1/users/${userId}/posts`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const data = await res.json();
    if (!res.ok) {
      return {
        success: false,
        errorMessage: data?.errors?.[0]?.message || `HTTP ${res.status}`,
      };
    }
    return {
      success: true,
      wpPostId: data?.data?.id,
      wpPostUrl: data?.data?.url,
    };
  } catch (err: any) {
    return { success: false, errorMessage: err?.message || "Network error" };
  }
}

// ----------------------------------------------------------------------------
// Webflow CMS API v2
// ----------------------------------------------------------------------------

interface WebflowTarget {
  host: string;
  siteId: string;
  collectionId: string;
  collectionSlug?: string;
  fields: {
    name?: string;
    slug?: string;
    richText?: string;
    image?: string;
    summary?: string;
  };
}

async function resolveWebflowTarget(
  siteUrl: string,
  token: string
): Promise<{ target: WebflowTarget; error?: string }> {
  const headers = { Authorization: `Bearer ${token}` };
  const host = siteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "").toLowerCase();

  const sitesRes = await fetch("https://api.webflow.com/v2/sites", {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  const sitesData = await sitesRes.json();
  if (!sitesRes.ok) {
    return {
      target: null as unknown as WebflowTarget,
      error: sitesData?.message || `Webflow API error ${sitesRes.status}`,
    };
  }
  const sites: any[] = sitesData?.sites ?? [];
  const matchesDomain = (s: any) =>
    (s?.customDomains ?? []).some(
      (d: any) => String(d?.url ?? "").toLowerCase() === host
    );
  const site = sites.find(
    (s) =>
      matchesDomain(s) ||
      String(s?.shortName ?? "").toLowerCase() === host ||
      String(s?.name ?? "").toLowerCase() === host
  );
  if (!site) {
    return {
      target: null as unknown as WebflowTarget,
      error: `Could not find a Webflow site matching "${host}"`,
    };
  }
  const siteId = site.id;

  const collRes = await fetch(
    `https://api.webflow.com/v2/sites/${siteId}/collections`,
    { headers, signal: AbortSignal.timeout(15_000) }
  );
  const collData = await collRes.json();
  const collections: any[] = collData?.collections ?? [];
  // Prefer a blog-ish collection (name/slug contains post/blog), else the
  // first collection with a rich-text field (the natural "post body").
  const collection =
    collections.find((c) => /post|blog/i.test(`${c.name ?? ""} ${c.slug ?? ""}`)) ||
    collections.find((c) =>
      (c?.fields ?? []).some((f: any) => f?.type === "RichText")
    ) ||
    (collections.length === 1 ? collections[0] : undefined);
  if (!collection) {
    return {
      target: null as unknown as WebflowTarget,
      error: "No CMS collection found to publish into",
    };
  }
  const collectionId = collection.id;
  const fields = collection.fields ?? [];
  const field = (pred: (f: any) => boolean) => fields.find(pred);
  const target: WebflowTarget = {
    host,
    siteId,
    collectionId,
    collectionSlug: collection.slug,
    fields: {
      name: field((f) => f?.slug === "name")?.slug ?? "name",
      slug: field((f) => f?.type === "Slug")?.slug,
      richText: field((f) => f?.type === "RichText")?.slug,
      image: field((f) => f?.type === "ImageRef")?.slug,
      summary: field(
        (f) => f?.type === "PlainText" && f?.slug !== "name"
      )?.slug,
    },
  };
  return { target };
}

async function webflowUploadAsset(
  siteId: string,
  token: string,
  image: { url: string; alt?: string }
): Promise<string | null> {
  try {
    const imgRes = await fetch(image.url, { signal: AbortSignal.timeout(30_000) });
    if (!imgRes.ok) return null;
    const bytes = Buffer.from(await imgRes.arrayBuffer());
    const contentType = imgRes.headers.get("content-type") ?? "image/jpeg";
    const ext = contentType.includes("png")
      ? "png"
      : contentType.includes("webp")
        ? "webp"
        : contentType.includes("gif")
          ? "gif"
          : "jpg";
    const fd = new FormData();
    fd.append("file", new Blob([bytes], { type: contentType }), `image-${Date.now()}.${ext}`);
    fd.append("fileName", `image-${Date.now()}.${ext}`);
    fd.append("contentType", contentType);
    if (image.alt) fd.append("altText", image.alt.slice(0, 200));
    const res = await fetch(`https://api.webflow.com/v2/sites/${siteId}/assets`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.asset?.id ?? null;
  } catch {
    return null;
  }
}

export async function publishToWebflow(
  siteUrl: string,
  credentials: Record<string, string>,
  target: GeneratedContentTarget,
  content: GeneratedContentPayload
): Promise<WpPublishResult> {
  const token = credentials.apiToken || credentials.apiKey;
  if (!token) {
    return { success: false, errorMessage: "Webflow API token missing" };
  }
  try {
    const { target: wf, error } = await resolveWebflowTarget(siteUrl, token);
    if (error) return { success: false, errorMessage: error };

    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    const fieldData: Record<string, unknown> = {
      [wf.fields.name ?? "name"]: content.title,
    };
    if (wf.fields.slug) {
      fieldData[wf.fields.slug] = content.slug || slugFromTitle(content.title);
    }
    if (wf.fields.richText) {
      fieldData[wf.fields.richText] = markdownToPublishHtml(content.body ?? "");
    }
    if (wf.fields.summary && content.metaDescription) {
      fieldData[wf.fields.summary] = content.metaDescription.slice(0, 300);
    }
    if (wf.fields.image && target.includeImages && content.images?.[0]?.url) {
      const assetId = await webflowUploadAsset(wf.siteId, token, {
        url: content.images[0].url,
        alt: content.images[0].alt || content.images[0].description || "",
      });
      if (assetId) fieldData[wf.fields.image] = assetId;
    }

    const isOverwrite =
      target.mode === "overwrite" &&
      target.wpPostId != null &&
      target.wpPostId !== "";
    const base = `https://api.webflow.com/v2/collections/${wf.collectionId}/items`;
    const res = await fetch(
      isOverwrite ? `${base}/${target.wpPostId}` : base,
      {
        method: isOverwrite ? "PATCH" : "POST",
        headers,
        body: JSON.stringify(
          isOverwrite
            ? { fieldData }
            : { isArchived: false, isDraft: false, fieldData }
        ),
        signal: AbortSignal.timeout(60_000),
      }
    );
    const data = await res.json();
    if (!res.ok) {
      return {
        success: false,
        errorMessage: data?.message || data?.error || `HTTP ${res.status}`,
      };
    }
    const item = data?.item;
    const itemSlug = item?.fieldData?.slug ?? content.slug ?? "";
    const liveUrl =
      item?.__liveUrl ||
      (wf.collectionSlug && itemSlug
        ? `https://${wf.host}/${wf.collectionSlug}/${itemSlug}`
        : undefined);
    return {
      success: true,
      wpPostId: item?.id ?? target.wpPostId,
      wpPostUrl: liveUrl,
    };
  } catch (err: any) {
    return { success: false, errorMessage: err?.message || "Network error" };
  }
}

async function listWebflowItems(
  siteUrl: string,
  credentials: Record<string, string>,
  search?: string
): Promise<SiteContentItem[]> {
  const token = credentials.apiToken || credentials.apiKey;
  if (!token) return [];
  try {
    const { target, error } = await resolveWebflowTarget(siteUrl, token);
    if (error) return [];
    const res = await fetch(
      `https://api.webflow.com/v2/collections/${target.collectionId}/items?limit=100`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
      }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const needle = search?.trim().toLowerCase() ?? "";
    return ((data?.items as any[]) ?? [])
      .filter(
        (i) =>
          !needle ||
          String(i?.fieldData?.name ?? "").toLowerCase().includes(needle) ||
          String(i?.fieldData?.slug ?? "").toLowerCase().includes(needle)
      )
      .map((i) => ({
        id: i?.id,
        title: i?.fieldData?.name ?? "Untitled",
        link: i?.__liveUrl ?? "",
        slug: i?.fieldData?.slug ?? "",
        date: i?.updatedOn ?? i?.createdOn ?? null,
      }));
  } catch {
    return [];
  }
}

// ----------------------------------------------------------------------------
// Listing (overwrite picker) — dispatched by platform type
// ----------------------------------------------------------------------------

/**
 * List a connected site's existing posts/pages for the overwrite picker.
 * `kind` is "post" or "page"; platforms that only have one content model
 * (Ghost, Webflow, Medium) treat it as "post". Best-effort — unreachable or
 * misconfigured sites return [].
 */
export async function listSiteContentForPlatform(
  platformType: string,
  bp: { site_url: string; site_name?: string; encrypted_credentials?: string | null },
  kind: "post" | "page",
  search?: string
): Promise<SiteContentItem[]> {
  if (platformType === "wordpress" || platformType === "wordpress_jetpack") {
    let credentials: Record<string, string> = {};
    try {
      if (bp.encrypted_credentials) {
        credentials = JSON.parse(decrypt(bp.encrypted_credentials) ?? "{}");
      }
    } catch {
      return [];
    }
    const authHeader = buildAuthHeader(credentials);
    if (!authHeader) return [];
    return listSiteContent(bp.site_url, authHeader, kind, search);
  }

  if (platformType === "ghost") {
    let credentials: Record<string, string> = {};
    try {
      if (bp.encrypted_credentials) {
        credentials = JSON.parse(decrypt(bp.encrypted_credentials) ?? "{}");
      }
    } catch {
      return [];
    }
    const adminApiKey = credentials.adminApiKey || credentials.apiKey;
    if (!adminApiKey) return [];
    const auth = ghostAuthHeader(adminApiKey);
    if (!auth) return [];
    const base = bp.site_url.replace(/\/$/, "") + "/ghost/api/admin";
    return listGhostPosts(base, auth, search);
  }

  if (platformType === "webflow") {
    let credentials: Record<string, string> = {};
    try {
      if (bp.encrypted_credentials) {
        credentials = JSON.parse(decrypt(bp.encrypted_credentials) ?? "{}");
      }
    } catch {
      return [];
    }
    return listWebflowItems(bp.site_url, credentials, search);
  }

  // Medium's API exposes no post listing; other platforms aren't wired yet.
  return [];
}