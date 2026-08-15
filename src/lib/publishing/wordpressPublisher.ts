/**
 * WordPress REST API Publisher
 *
 * Posts blog content to connected WordPress sites via the WP REST API.
 * Supports draft, publish, and schedule modes.
 */

import { createClient } from "@supabase/supabase-js";
import { encrypt, decrypt } from "@/lib/encryption";

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
    /** Rank Math post-meta keys (rank_math_*) generated with the post. */
    rankMath?: Record<string, string | string[]>;
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

async function postToWordPress(target: WpPublishTarget): Promise<WpPublishResult> {
  const { siteUrl, credentials, content, action, scheduledAt, categoryId } = target;

  // Build auth header based on credential type
  let authHeader = "";
  if (credentials.username && credentials.applicationPassword) {
    // Basic auth with Application Password
    const encoded = Buffer.from(
      `${credentials.username}:${credentials.applicationPassword}`
    ).toString("base64");
    authHeader = `Basic ${encoded}`;
  } else if (credentials.apiToken) {
    // Bearer token (Webflow, some WP plugin setups)
    authHeader = `Bearer ${credentials.apiToken}`;
  } else if (credentials.apiKey) {
    authHeader = `Bearer ${credentials.apiKey}`;
  }

  const apiUrl = siteUrl.replace(/\/$/, "") + "/wp-json/wp/v2/posts";

  const body: Record<string, any> = {
    title: content.title,
    content: content.body,
    excerpt: content.metaDescription || "",
    slug: content.slug || content.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    status: action === "publish" ? "publish" : "draft",
  };

  // Rank Math registers its fields as top-level REST params on wp/v2/posts
  // (rank_math_title, rank_math_description, rank_math_focus_keyword,
  // rank_math_schema_*). Send them when the post carries a generated payload;
  // if the site doesn't have Rank Math the API rejects the unknown params
  // with rest_invalid_param and we retry without them so publishing never
  // breaks on a plugin-less site.
  const rankMath = content.rankMath ?? {};
  for (const [key, value] of Object.entries(rankMath)) {
    if (typeof value === "string") body[key] = value;
    else body[key] = value;
  }
  const rankMathKeys = Object.keys(rankMath);

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

    let { ok, status, data } = await send(body);

    // A site without Rank Math rejects the extra rank_math_* params — retry
    // without them (rest_invalid_param: "Invalid parameter(s): rank_math_...").
    if (
      !ok &&
      status === 400 &&
      rankMathKeys.length > 0 &&
      typeof data?.code === "string" &&
      data.code === "rest_invalid_param" &&
      /rank_math/i.test(JSON.stringify(data?.data ?? data?.message ?? ""))
    ) {
      const stripped = { ...body };
      for (const key of rankMathKeys) delete stripped[key];
      const retry = await send(stripped);
      ok = retry.ok;
      status = retry.status;
      data = retry.data;
    }

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
        rankMath: content.rankMath,
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