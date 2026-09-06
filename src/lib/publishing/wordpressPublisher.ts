/**
 * WordPress REST API Publisher
 *
 * Posts blog content to connected WordPress sites via the WP REST API.
 * Supports draft, publish, and schedule modes.
 */

import { createClient } from "@supabase/supabase-js";
import { encrypt, decrypt } from "@/lib/encryption";
import { renderBlogBody } from "@/lib/blog-render";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

export interface WpPublishTarget {
  postId: string;          // Agency OS post ID
  blogPlatformId: string;   // blog_platforms.id
  siteUrl: string;          // WordPress site URL
  credentials: {            // Decrypted credentials
    username?: string;
    applicationPassword?: string;
    apiKey?: string;
    apiToken?: string;
  };
  content: {
    title: string;
    body: string;
    metaDescription?: string;
    slug?: string;
    /** WordPress SEO post-meta generated with the post (seo_*, schema_*). */
    seoMeta?: Record<string, string | string[]>;
  };
  action: "draft" | "publish" | "schedule";
  scheduledAt?: string;     // ISO date for scheduling
  categoryId?: number | string; // WP category to post into (default: Uncategorized)
}

export interface WpPublishResult {
  success: boolean;
  wpPostId?: number;
  wpPostUrl?: string;
  errorMessage?: string;
  /** Which connected site this result belongs to (set by publishGeneratedContentToSites). */
  blogPlatformId?: string;
  siteName?: string;
}

// ------------------------------------------------------------------
// Service client
// ------------------------------------------------------------------

function createServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// ------------------------------------------------------------------
// WordPress REST API call
// ------------------------------------------------------------------

/**
 * Build the HTTP Authorization header from stored credentials.
 * WordPress uses Basic auth with an Application Password; some setups accept
 * a Bearer token instead.
 */
export function buildAuthHeader(credentials: Record<string, string>): string {
  if (credentials.username && credentials.applicationPassword) {
    // Basic auth with Application Password
    const encoded = Buffer.from(
      `${credentials.username}:${credentials.applicationPassword}`
    ).toString("base64");
    return `Basic ${encoded}`;
  }
  if (credentials.apiToken) {
    // Bearer token (Webflow, some WP plugin setups)
    return `Bearer ${credentials.apiToken}`;
  }
  if (credentials.apiKey) {
    return `Bearer ${credentials.apiKey}`;
  }
  return "";
}

async function postToWordPress(target: WpPublishTarget): Promise<WpPublishResult> {
  const { siteUrl, credentials, content, action, scheduledAt, categoryId } = target;

  const authHeader = buildAuthHeader(credentials);

  const apiUrl = siteUrl.replace(/\/$/, "") + "/wp-json/wp/v2/posts";

  const body: Record<string, any> = {
    title: content.title,
    content: content.body,
    excerpt: content.metaDescription || "",
    slug: content.slug || content.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    status: action === "publish" ? "publish" : "draft",
  };

  // The ONLY way to guarantee schema lands on every WP site is embedding the
  // JSON-LD directly in the post content — Google reads it from anywhere in
  // the DOM. The combined `schema_jsonld` array is generated with the post.
  const seoMeta = content.seoMeta ?? {};
  const rawJsonLd = seoMeta.schema_jsonld;
  if (typeof rawJsonLd === "string" && rawJsonLd.trim().length > 0) {
    try {
      const parsed = JSON.parse(rawJsonLd);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const scriptTag = `<script type="application/ld+json">${JSON.stringify(parsed)}</script>`;
        body.content = `${scriptTag}\n\n${body.content ?? ""}`;
      }
    } catch {
      // ignore malformed schema — never fail a publish over it
    }
  }

  // Put the post into the chosen category (default: WordPress's own
  // "Uncategorized" when none is picked — the API accepts category IDs).
  if (categoryId !== undefined && categoryId !== null && categoryId !== "") {
    body.categories = [Number(categoryId)];
  }

  // Handle scheduling
  if (action === "schedule" && scheduledAt) {
    body.status = "future";
    // Convert to UTC ISO (e.g. "2026-08-10T14:30" → "2026-08-10T20:30:00.000Z").
    // The WP REST API rejects non-UTC/local datetime strings with
    // rest_invalid_param, which caused "Some platforms failed" on schedule.
    const iso = new Date(scheduledAt).toISOString();
    body.date = iso;
  }

  try {
    const send = async (payload: Record<string, any>) => {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      return { ok: response.ok, status: response.status, data };
    };

    const { ok, status, data } = await send(body);

    if (!ok) {
      const message = data?.message || data?.code || `HTTP ${status}`;
      return { success: false, errorMessage: message };
    }

    return {
      success: true,
      wpPostId: data.id,
      wpPostUrl: data.link,
    };
  } catch (err: any) {
    return { success: false, errorMessage: err?.message || "Network error" };
  }
}

// ------------------------------------------------------------------
// Main entry point: Publish post to all connected WordPress sites
// ------------------------------------------------------------------

export async function publishToWordPress(
  postId: string,
  tenantId: string,
  action: "draft" | "publish" | "schedule" = "publish",
  scheduledAt?: string,
  categoryId?: number | string
): Promise<{ allSucceeded: boolean; results: WpPublishResult[] }> {
  const supabase = createServiceSupabase();

  // 1. Get the post content
  const { data: post, error: postError } = await supabase
    .from("posts")
    .select("content, tenant_id")
    .eq("id", postId)
    .eq("tenant_id", tenantId)
    .single();

  if (postError || !post) {
    return {
      allSucceeded: false,
      results: [{ success: false, errorMessage: "Post not found" }],
    };
  }

  const content = typeof post.content === "string" ? JSON.parse(post.content) : post.content;
  if (!content || content.type !== "blog") {
    return {
      allSucceeded: false,
      results: [{ success: false, errorMessage: "Post is not a blog post" }],
    };
  }

  // 2. Get connected WordPress platforms
  const { data: blogPlatforms } = await supabase
    .from("blog_platforms")
    .select("*")
    .eq("tenant_id", tenantId);

  const wpPlatforms = (blogPlatforms || []).filter(
    (p) => p.platform_type === "wordpress" || p.platform_type === "wordpress_jetpack"
  );

  if (wpPlatforms.length === 0) {
    return {
      allSucceeded: false,
      results: [{ success: false, errorMessage: "No WordPress sites connected" }],
    };
  }

  // 3. Publish to each WordPress site
  const results: WpPublishResult[] = [];

  for (const bp of wpPlatforms) {
    let credentials: Record<string, string> = {};
    try {
      if (bp.encrypted_credentials) {
        const decrypted = decrypt(bp.encrypted_credentials);
        credentials = JSON.parse(decrypted);
      }
    } catch {
      results.push({ success: false, errorMessage: "Failed to decrypt credentials" });
      continue;
    }

    const result = await postToWordPress({
      postId,
      blogPlatformId: bp.id,
      siteUrl: bp.site_url,
      credentials,
      content: {
        title: content.title,
        body: content.body,
        metaDescription: content.metaDescription,
        slug: content.slug,
        seoMeta: content.seoMeta,
      },
      action,
      scheduledAt,
      categoryId,
    });

    results.push(result);

    // Update the post status on success
    if (result.success) {
      const newStatus = action === "schedule" ? "scheduled" : "published";
      // Immediate publishes still get a timestamp so the post shows on the
      // calendar (posts with NULL scheduled_at are filtered out by the UI).
      const effectiveScheduledAt = action === "schedule" ? scheduledAt : new Date().toISOString();
      await supabase
        .from("posts")
        .update({ status: newStatus, scheduled_at: effectiveScheduledAt })
        .eq("id", postId);

      // Log the publish event
      await supabase.from("publishing_logs").insert({
        post_id: postId,
        platform: "wordpress",
        attempt_at: new Date().toISOString(),
        success: true,
      });
    } else {
      await supabase.from("publishing_logs").insert({
        post_id: postId,
        platform: "wordpress",
        attempt_at: new Date().toISOString(),
        success: false,
        error_message: result.errorMessage,
      });
    }
  }

  const allSucceeded = results.every((r) => r.success);
  return { allSucceeded, results };
}
// ============================================================================
// Direct publish of generated content (not saved in `posts`) to connected
// sites — used by the Generate Content page. Supports CREATE NEW and
// OVERWRITE EXISTING modes, and uploads generated images into each site's
// media library so the published post is self-contained (images replaced
// when overwriting).
// ============================================================================

export interface GeneratedContentTarget {
  blogPlatformId: string;
  /** create = new post/page, overwrite = replace an existing post/page. */
  mode: "create" | "overwrite";
  /** Which WP object the content maps to: posts (blog) or pages. */
  kind: "post" | "page";
  /** WP object id — required when mode === "overwrite". */
  wpPostId?: number | string;
  /** Upload the generated images to this site's media library and embed them. */
  includeImages: boolean;
  /** WP category id for the post (default: site's default category). */
  categoryId?: number | string;
}

export interface GeneratedContentPayload {
  title: string;
  /** Markdown body — converted to clean HTML before posting. */
  body: string;
  slug?: string;
  metaDescription?: string;
  /** WordPress SEO post-meta generated with the post (seo_*, schema_*). */
  seoMeta?: Record<string, string | string[]>;
  images: {
    url: string;
    alt?: string;
    placement?: "featured" | "inline";
    description?: string;
  }[];
}

/** Clean HTML for WordPress — renderBlogBody adds Tailwind classes for the app UI. */
function markdownToPublishHtml(markdown: string): string {
  try {
    return renderBlogBody(markdown).replace(/\sclass="[^"]*"/g, "");
  } catch {
    return markdown;
  }
}

/**
 * Download an image from its CDN URL and upload it into a WordPress site's
 * media library. Returns the new media id + source URL, or null on failure
 * (never throws — a failed image must not break the publish).
 */
async function uploadImageToWordPress(
  siteUrl: string,
  authHeader: string,
  image: { url: string; alt?: string }
): Promise<{ id: number; sourceUrl: string } | null> {
  try {
    const imgRes = await fetch(image.url, { signal: AbortSignal.timeout(30_000) });
    if (!imgRes.ok) return null;
    const bytes = Buffer.from(await imgRes.arrayBuffer());
    const contentType = imgRes.headers.get("content-type") ?? "image/jpeg";

    // Filename from the CDN URL when it has a usable image extension,
    // otherwise synthesize one from the content type.
    let filename = "";
    try {
      const last = new URL(image.url).pathname.split("/").pop() ?? "";
      if (/\.(png|jpe?g|webp|gif|avif|svg|heic)$/i.test(last)) filename = last;
    } catch {
      // unparsable URL — synthesize below
    }
    if (!filename) {
      const ext = contentType.includes("png")
        ? "png"
        : contentType.includes("webp")
          ? "webp"
          : contentType.includes("gif")
            ? "gif"
            : "jpg";
      filename = `image-${Date.now()}.${ext}`;
    }

    const res = await fetch(`${siteUrl}/wp-json/wp/v2/media`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
      },
      body: bytes,
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return null;
    const data = await res.json();

    // Best-effort: attach the alt text so the image is accessible on the site.
    if (data?.id && image.alt) {
      try {
        await fetch(`${siteUrl}/wp-json/wp/v2/media/${data.id}`, {
          method: "POST",
          headers: {
            Authorization: authHeader,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ alt_text: image.alt.slice(0, 200) }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        // alt text is a nicety — ignore failures
      }
    }

    return { id: data?.id as number, sourceUrl: data?.source_url ?? data?.link ?? "" };
  } catch {
    return null;
  }
}

/**
 * List a site's existing posts or pages so the UI can offer "overwrite"
 * targets. Best-effort: unreachable/misconfigured sites return [].
 */
export async function listSiteContent(
  siteUrl: string,
  authHeader: string,
  kind: "post" | "page",
  search?: string,
  perPage = 25
): Promise<
  { id: number; title: string; link: string; slug: string; date: string | null }[]
> {
  try {
    const base = `${siteUrl.replace(/\/$/, "")}/wp-json/wp/v2/${kind}s`;
    const params = new URLSearchParams({
      per_page: String(perPage),
      orderby: "modified",
      order: "desc",
    });
    if (search && search.trim()) params.set("search", search.trim());
    const res = await fetch(`${base}?${params.toString()}`, {
      headers: authHeader ? { Authorization: authHeader } : {},
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as any[];
    if (!Array.isArray(data)) return [];
    return data.map((p) => ({
      id: p?.id,
      title:
        (typeof p?.title?.rendered === "string" ? p.title.rendered : "") ||
        p?.title ||
        "Untitled",
      link: p?.link ?? "",
      slug: p?.slug ?? "",
      date: p?.date ?? null,
    }));
  } catch {
    return [];
  }
}

/**
 * Publish a freshly generated post (title/body/images from the Generate
 * Content page) to a chosen set of connected sites. Each target can create
 * a new post or overwrite an existing one, and can optionally upload the
 * generated images into the site's media library (embedding them inline and
 * setting the featured image).
 *
 * Every site is fetched tenant-scoped by id; a failure on one site never
 * blocks the others.
 */
export async function publishGeneratedContentToSites(
  tenantId: string,
  targets: GeneratedContentTarget[],
  content: GeneratedContentPayload
): Promise<{ allSucceeded: boolean; results: WpPublishResult[] }> {
  const supabase = createServiceSupabase();
  const results: WpPublishResult[] = [];

  for (const target of targets) {
    const { data: bp, error: bpError } = await supabase
      .from("blog_platforms")
      .select("id, site_url, site_name, encrypted_credentials")
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

    let credentials: Record<string, string> = {};
    try {
      if (bp.encrypted_credentials) {
        credentials = JSON.parse(decrypt(bp.encrypted_credentials) ?? "{}");
      }
    } catch {
      results.push({
        success: false,
        blogPlatformId: target.blogPlatformId,
        siteName: bp.site_name,
        errorMessage: "Failed to decrypt credentials",
      });
      continue;
    }

    const authHeader = buildAuthHeader(credentials);
    if (!authHeader) {
      results.push({
        success: false,
        blogPlatformId: target.blogPlatformId,
        siteName: bp.site_name,
        errorMessage: "Site credentials are missing an authentication method",
      });
      continue;
    }

const siteUrl = bp.site_url.replace(/\/$/, "");
    const kind = target.kind === "page" ? "page" : "post";
    const endpoint = `/wp-json/wp/v2/${kind}s`;

    // 1. Upload images and rewrite the body so it points at THIS site's
    //    media library (self-contained post, no hot-linking our CDN).
    let bodyHtml = markdownToPublishHtml(content.body ?? "");
    let featuredMediaId: number | null = null;
    if (
      target.includeImages &&
      Array.isArray(content.images) &&
      content.images.length > 0
    ) {
      const urlToWpUrl = new Map<string, string>();
      let firstUploadedId: number | null = null;
      for (const img of content.images) {
        if (!img.url) continue;
        const uploaded = await uploadImageToWordPress(siteUrl, authHeader, {
          url: img.url,
          alt: img.alt || img.description || "",
        });
        if (!uploaded) continue;
        if (firstUploadedId == null) firstUploadedId = uploaded.id;
        if (featuredMediaId == null && img.placement === "featured") {
          featuredMediaId = uploaded.id;
        }
        urlToWpUrl.set(img.url, uploaded.sourceUrl || String(uploaded.id));
      }
      // Fall back to the first uploaded image as the featured image.
      if (featuredMediaId == null) featuredMediaId = firstUploadedId;
      for (const [oldUrl, newUrl] of urlToWpUrl) {
        bodyHtml = bodyHtml.split(oldUrl).join(newUrl);
      }
    }

    // 2. Build the WP payload. Title, content (schema embedded — same
    //    guarantee as the posts publisher), excerpt, slug, status.
    const payload: Record<string, any> = {
      title: content.title,
      content: bodyHtml,
      excerpt: content.metaDescription || "",
      slug:
        content.slug ||
        content.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      status: "publish",
    };
    if (featuredMediaId != null) payload.featured_media = featuredMediaId;
    if (target.categoryId !== undefined && target.categoryId !== null && target.categoryId !== "") {
      payload.categories = [Number(target.categoryId)];
    }

    // Embed the JSON-LD schema directly in the content (same approach as the
    // posts publisher — Google reads it from anywhere in the DOM).
    const seoMeta = content.seoMeta ?? {};
    const rawJsonLd = seoMeta.schema_jsonld;
    if (typeof rawJsonLd === "string" && rawJsonLd.trim().length > 0) {
      try {
        const parsed = JSON.parse(rawJsonLd);
        if (Array.isArray(parsed) && parsed.length > 0) {
          payload.content = `<script type="application/ld+json">${JSON.stringify(
            parsed
          )}</script>\n\n${payload.content}`;
        }
      } catch {
        // ignore malformed schema — never fail a publish over it
      }
    }

    // 3. Create or overwrite.
    if (target.mode === "overwrite" && (target.wpPostId === undefined || target.wpPostId === null || target.wpPostId === "")) {
      results.push({
        success: false,
        blogPlatformId: target.blogPlatformId,
        siteName: bp.site_name,
        errorMessage: "No existing post/page selected to overwrite",
      });
      continue;
    }

    const apiUrl =
      siteUrl +
      endpoint +
      (target.mode === "overwrite" ? `/${target.wpPostId}` : "");

    try {
      const res = await fetch(apiUrl, {
        method: target.mode === "overwrite" ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(60_000),
      });
      const data = await res.json();
      if (!res.ok) {
        results.push({
          success: false,
          blogPlatformId: target.blogPlatformId,
          siteName: bp.site_name,
          errorMessage: data?.message || data?.code || `HTTP ${res.status}`,
        });
        continue;
      }
      results.push({
        success: true,
        blogPlatformId: target.blogPlatformId,
        siteName: bp.site_name,
        wpPostId: data?.id,
        wpPostUrl: data?.link,
      });
    } catch (err: any) {
      results.push({
        success: false,
        blogPlatformId: target.blogPlatformId,
        siteName: bp.site_name,
        errorMessage: err?.message || "Network error",
      });
    }
  }

  const allSucceeded =
    results.length > 0 && results.every((r) => r.success);
  return { allSucceeded, results };
}

// ============================================================================
// Saved-post payload builder — turns a `posts` table row into the same
// GeneratedContentPayload the Generate page sends, so the connected-sites
// publish (create/overwrite) works for saved posts too (the Publish button
// flow). Pure function: no DB, no request context.
// ============================================================================

/**
 * Build the publish payload for a saved post row. The row's `content` JSON
 * holds the blog fields (title/body/slug/metaDescription/seoMeta) and
 * `media_urls` holds generated images. Inline markdown images in the body
 * that aren't in media_urls are appended (deduped). Returns null when the
 * post has no body to publish.
 */
export function buildSavedPostPublishPayload(post: {
  title: string | null;
  content: unknown;
  media_urls?: unknown;
}): { content: GeneratedContentPayload } | null {
  const parsed =
    typeof post.content === "string"
      ? (() => {
          try {
            return JSON.parse(post.content);
          } catch {
            return null;
          }
        })()
      : post.content;
  const body = typeof parsed?.body === "string" ? parsed.body : "";
  if (!body.trim()) return null;

  const title =
    (typeof parsed?.title === "string" && parsed.title.trim()
      ? parsed.title
      : post.title) ?? "Untitled Post";

  const mediaUrls = Array.isArray(post.media_urls)
    ? (post.media_urls.filter((u): u is string => typeof u === "string")
      )
    : [];
  const images: GeneratedContentPayload["images"] = [];
  const seen = new Set<string>();

  // First stored media URL is the featured image; the rest are inline.
  if (mediaUrls[0]) {
    seen.add(mediaUrls[0]);
    images.push({ url: mediaUrls[0], placement: "featured" });
  }
  for (const url of mediaUrls.slice(1)) {
    if (!seen.has(url)) {
      seen.add(url);
      images.push({ url, placement: "inline" });
    }
  }
  // Inline images embedded in the body markdown (deduped against media_urls).
  const imageRe = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = imageRe.exec(body))) {
    if (!seen.has(m[2])) {
      seen.add(m[2]);
      images.push({ url: m[2], alt: m[1] || "", placement: "inline" });
    }
  }

  return {
    content: {
      title,
      body,
      slug: typeof parsed?.slug === "string" ? parsed.slug : undefined,
      metaDescription:
        typeof parsed?.metaDescription === "string"
          ? parsed.metaDescription
          : undefined,
      seoMeta:
        parsed?.seoMeta && typeof parsed.seoMeta === "object"
          ? parsed.seoMeta
          : undefined,
      images,
    },
  };
}