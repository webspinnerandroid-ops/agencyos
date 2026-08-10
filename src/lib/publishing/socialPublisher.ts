/**
 * Social Publisher Abstraction
 *
 * Resolves tenant-specific social tokens and publishes content to the
 * configured social platforms. Currently uses a mock implementation;
 * swap in the Ayrshare API (or any other provider) by replacing the
 * `publishToPlatform` function body.
 *
 * Ayrshare API reference: https://docs.ayrshare.com/reference/post
 */

import { createClient } from "@supabase/supabase-js";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

export interface PublishTarget {
  postPlatformId: string; // post_platforms.id
  socialAccountId: string; // social_accounts.id
  platform: string; // e.g. "instagram", "twitter"
  encryptedToken: string; // stored token from social_accounts
  content: string;
  mediaUrls: string[];
}

export interface PublishResult {
  postPlatformId: string;
  platform: string;
  success: boolean;
  platformPostId?: string;
  errorMessage?: string;
}

// ------------------------------------------------------------------
// Service client (no cookies — for background jobs)
// ------------------------------------------------------------------

function createServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// ------------------------------------------------------------------
// Token resolution
// ------------------------------------------------------------------

/**
 * Decrypt the stored social account token. In production, tokens are encrypted
 * at rest using the same encryption module as API keys. Falls back to plaintext
 * for development environments where tokens may be stored unencrypted.
 */
async function decryptToken(encryptedToken: string): Promise<string> {
  try {
    const { decrypt } = await import("@/lib/encryption");
    return decrypt(encryptedToken);
  } catch {
    // In development, tokens may be stored as plaintext
    return encryptedToken;
  }
}

// ------------------------------------------------------------------
// Platform publisher (Ayrshare)
// ------------------------------------------------------------------

/**
 * Publishes content to a social platform via the Ayrshare API.
 *
 * Ayrshare API reference: https://docs.ayrshare.com/reference/post
 *
 * Uses the AYRSHARE_API_KEY environment variable. Tenant-specific
 * platform access tokens are passed via platformOptions for
 * cross-posting to the tenant's own social accounts.
 */
async function publishToPlatform(
  target: PublishTarget
): Promise<{ success: boolean; platformPostId?: string; errorMessage?: string }> {
  const apiKey = process.env.AYRSHARE_API_KEY;

  if (!apiKey) {
    return {
      success: false,
      errorMessage: "AYRSHARE_API_KEY not configured. Set it in .env.local.",
    };
  }

  const accessToken = await decryptToken(target.encryptedToken);
  if (!accessToken || accessToken.length < 3) {
    return {
      success: false,
      errorMessage: `Missing or invalid token for platform "${target.platform}"`,
    };
  }

  try {
    const response = await fetch("https://app.ayrshare.com/api/post", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        post: target.content,
        platforms: [target.platform],
        mediaUrls: target.mediaUrls.length > 0 ? target.mediaUrls : undefined,
        platformOptions: {
          [target.platform]: {
            accessToken,
          },
        },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      const errorMsg =
        data.message ??
        data.errors?.join(", ") ??
        `Ayrshare returned status ${response.status}`;
      return { success: false, errorMessage: errorMsg };
    }

    // Extract the platform-specific post ID from the response
    const platformPostId =
      data.postIds?.find((p: any) => p.platform === target.platform)?.id ??
      data.id;

    return { success: true, platformPostId: String(platformPostId ?? "") };
  } catch (err: any) {
    return {
      success: false,
      errorMessage: `Ayrshare request failed: ${err.message ?? "Unknown error"}`,
    };
  }
}

// ------------------------------------------------------------------
// Main entry point
// ------------------------------------------------------------------

/**
 * Publish a single post to ALL its assigned social accounts.
 *
 * 1. Fetch the post_platforms + social_accounts join for the given post.
 * 2. For each platform, call the publisher.
 * 3. On success → update post_platforms.status = 'published' and set
 *    platform_post_id.
 * 4. Log every attempt to publishing_logs.
 * 5. Return aggregated results.
 */
export async function publishPost(
  postId: string,
  tenantId: string
): Promise<{
  allSucceeded: boolean;
  results: PublishResult[];
}> {
  const supabase = createServiceSupabase();

  // 1. Fetch the post content and its platform assignments
  const { data: post, error: postError } = await supabase
    .from("posts")
    .select(
      `
      id,
      content,
      media_urls,
      tenant_id,
      post_platforms (
        id,
        social_account_id,
        social_accounts (
          id,
          platform,
          encrypted_token
        )
      )
    `
    )
    .eq("id", postId)
    .eq("tenant_id", tenantId)
    .single();

  if (postError || !post) {
    console.error(`[socialPublisher] Post ${postId} not found for tenant ${tenantId}`, postError);
    return { allSucceeded: false, results: [] };
  }

  const platforms: Array<{
    ppId: string;
    saId: string;
    platform: string;
    encryptedToken: string;
  }> = [];

  const postPlatforms = post.post_platforms as unknown as Array<{
    id: string;
    social_account_id: string | null;
    social_accounts: {
      id: string;
      platform: string;
      encrypted_token: string;
    } | null;
  }> | null;

  if (postPlatforms) {
    for (const pp of postPlatforms) {
      if (pp.social_accounts) {
        platforms.push({
          ppId: pp.id,
          saId: pp.social_accounts.id,
          platform: pp.social_accounts.platform,
          encryptedToken: pp.social_accounts.encrypted_token,
        });
      }
    }
  }

  if (platforms.length === 0) {
    console.warn(`[socialPublisher] Post ${postId} has no assigned social accounts`);
    return { allSucceeded: false, results: [] };
  }

  // 2. Publish to each platform sequentially (can be parallelised if needed)
  const results: PublishResult[] = [];

  for (const target of platforms) {
    const outcome = await publishToPlatform({
      postPlatformId: target.ppId,
      socialAccountId: target.saId,
      platform: target.platform,
      encryptedToken: target.encryptedToken,
      content: post.content ?? "",
      mediaUrls: post.media_urls ?? [],
    });

    const result: PublishResult = {
      postPlatformId: target.ppId,
      platform: target.platform,
      success: outcome.success,
      platformPostId: outcome.platformPostId,
      errorMessage: outcome.errorMessage,
    };
    results.push(result);

    // 3. Update post_platforms record
    if (outcome.success) {
      await supabase
        .from("post_platforms")
        .update({
          status: "published",
          platform_post_id: outcome.platformPostId,
        })
        .eq("id", target.ppId);
    } else {
      await supabase
        .from("post_platforms")
        .update({ status: "failed" })
        .eq("id", target.ppId);
    }

    // 4. Insert publishing log
    await supabase.from("publishing_logs").insert({
      post_id: postId,
      platform: target.platform,
      attempt_at: new Date().toISOString(),
      success: outcome.success,
      error_message: outcome.errorMessage ?? null,
    });
  }

  const allSucceeded = results.every((r) => r.success);
  return { allSucceeded, results };
}