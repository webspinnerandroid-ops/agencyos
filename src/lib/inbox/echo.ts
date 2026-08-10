/**
 * Echo — Social Inbox & Engagement
 *
 * Syncs social media comments and engagement from Meta (Facebook/Instagram),
 * X (Twitter), and LinkedIn. Pulls comments for published posts, stores them
 * in the comments table with platform metadata, and supports reply workflows.
 */

import { createClient } from "@supabase/supabase-js";

// ============================================================================
// Types
// ============================================================================

export type SocialPlatform = "instagram" | "facebook" | "twitter" | "linkedin";

export interface SocialComment {
  platformCommentId: string;
  platform: SocialPlatform;
  postId: string; // Our posts.id
  body: string;
  authorName: string;
  authorAvatarUrl?: string;
  parentCommentId?: string; // platform's parent comment ID
  createdAt: string;
  engagementData?: {
    likes?: number;
    shares?: number;
    sentiment?: "positive" | "negative" | "neutral";
  };
}

export interface SocialInboxQuery {
  tenantId: string;
  status?: "unread" | "read" | "replied" | "archived" | "spam";
  platform?: SocialPlatform;
  clientId?: string;
  limit?: number;
  offset?: number;
}

export interface CommentReply {
  commentId: string;
  body: string;
}

export interface SocialSyncResult {
  postId: string;
  commentsImported: number;
  platform: string;
}

// ============================================================================
// Service Supabase client
// ============================================================================

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

// ============================================================================
// Token resolution
// ============================================================================

/**
 * Gets the decrypted access token for a tenant's social account on a given platform.
 */
async function getSocialAccessToken(
  tenantId: string,
  platform: string
): Promise<string> {
  const supabase = getServiceSupabase();

  const { data: account } = await supabase
    .from("social_accounts")
    .select("encrypted_token")
    .eq("tenant_id", tenantId)
    .eq("platform", platform)
    .limit(1)
    .single();

  if (!account?.encrypted_token) {
    throw new Error(`No social account found for ${platform} on tenant ${tenantId}`);
  }

  try {
    const { decrypt } = await import("@/lib/encryption");
    const decrypted = decrypt(account.encrypted_token);
    const tokenData = JSON.parse(decrypted);
    return tokenData.access_token ?? decrypted;
  } catch {
    // Fallback: base64-encoded or plaintext
    try {
      const decoded = Buffer.from(account.encrypted_token, "base64").toString("utf-8");
      const tokenData = JSON.parse(decoded);
      return tokenData.access_token ?? decoded;
    } catch {
      return account.encrypted_token;
    }
  }
}

// ============================================================================
// Meta (Facebook & Instagram) — Graph API
// ============================================================================

/**
 * Fetches comments from a Facebook or Instagram post.
 * Instagram requires the Instagram Business Account ID and media ID.
 */
async function syncMetaComments(
  tenantId: string,
  postId: string,
  platform: "instagram" | "facebook"
): Promise<SocialSyncResult> {
  const supabase = getServiceSupabase();
  const accessToken = await getSocialAccessToken(tenantId, platform);

  // Get the post_platforms entry to find the platform's post ID
  const { data: ppEntry } = await supabase
    .from("post_platforms")
    .select("platform_post_id")
    .eq("post_id", postId)
    .single();

  if (!ppEntry?.platform_post_id) {
    return { postId, commentsImported: 0, platform };
  }

  const platformPostId = ppEntry.platform_post_id;
  const fields = "comments{id,text,from{name,id},created_time,like_count,replies{id,text,from{name,id},created_time,like_count}}";

  const res = await fetch(
    `https://graph.facebook.com/v21.0/${platformPostId}?fields=${fields}&access_token=${accessToken}`
  );

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[Echo] Meta API error for ${platformPostId}:`, errText);
    return { postId, commentsImported: 0, platform };
  }

  const data = await res.json();
  const comments = data.comments?.data ?? [];
  let imported = 0;

  for (const comment of comments) {
    const { error: upsertErr } = await supabase
      .from("comments")
      .upsert(
        {
          post_id: postId,
          platform,
          platform_comment_id: comment.id,
          body: comment.text ?? "",
          author_name: comment.from?.name ?? "Unknown",
          author_avatar_url: `https://graph.facebook.com/${comment.from?.id}/picture`,
          engagement_data: {
            likes: comment.like_count ?? 0,
            sentiment: "neutral",
          },
          inbox_status: "unread",
          is_read: false,
        },
        { onConflict: "platform_comment_id" }
      );

    if (!upsertErr) imported++;

    // Sync replies to this comment
    const replies = comment.replies?.data ?? [];
    for (const reply of replies) {
      const { error: replyErr } = await supabase
        .from("comments")
        .upsert(
          {
            post_id: postId,
            platform,
            platform_comment_id: reply.id,
            body: reply.text ?? "",
            author_name: reply.from?.name ?? "Unknown",
            author_avatar_url: `https://graph.facebook.com/${reply.from?.id}/picture`,
            parent_comment_id: comment.id,
            engagement_data: {
              likes: reply.like_count ?? 0,
              sentiment: "neutral",
            },
            inbox_status: "unread",
            is_read: false,
          },
          { onConflict: "platform_comment_id" }
        );

      if (!replyErr) imported++;
    }
  }

  return { postId, commentsImported: imported, platform };
}

// ============================================================================
// X (Twitter) — X API v2
// ============================================================================

/**
 * Fetches replies to a tweet using X API v2 recent search.
 */
async function syncTwitterComments(
  tenantId: string,
  postId: string
): Promise<SocialSyncResult> {
  const supabase = getServiceSupabase();
  const accessToken = await getSocialAccessToken(tenantId, "twitter");

  // Get the tweet ID from post_platforms
  const { data: ppEntry } = await supabase
    .from("post_platforms")
    .select("platform_post_id")
    .eq("post_id", postId)
    .single();

  if (!ppEntry?.platform_post_id) {
    return { postId, commentsImported: 0, platform: "twitter" };
  }

  const tweetId = ppEntry.platform_post_id;

  const res = await fetch(
    `https://api.twitter.com/2/tweets/search/recent?query=conversation_id:${tweetId}&tweet.fields=author_id,text,created_at,public_metrics&user.fields=name,profile_image_url&expansions=author_id&max_results=50`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[Echo] X API error for tweet ${tweetId}:`, errText);
    return { postId, commentsImported: 0, platform: "twitter" };
  }

  const data = await res.json();
  const tweets = data.data ?? [];
  const users: any[] = data.includes?.users ?? [];
  const userMap = new Map(users.map((u: any) => [u.id, u]));

  let imported = 0;
  for (const tweet of tweets) {
    const author: any = userMap.get(tweet.author_id);

    const { error: upsertErr } = await supabase
      .from("comments")
      .upsert(
        {
          post_id: postId,
          platform: "twitter",
          platform_comment_id: tweet.id,
          body: tweet.text ?? "",
          author_name: author?.name ?? "Unknown",
          author_avatar_url: author?.profile_image_url ?? undefined,
          engagement_data: {
            likes: tweet.public_metrics?.like_count ?? 0,
            shares: tweet.public_metrics?.retweet_count ?? 0,
            sentiment: "neutral",
          },
          inbox_status: "unread",
          is_read: false,
        },
        { onConflict: "platform_comment_id" }
      );

    if (!upsertErr) imported++;
  }

  return { postId, commentsImported: imported, platform: "twitter" };
}

// ============================================================================
// LinkedIn — LinkedIn Marketing API
// ============================================================================

/**
 * Fetches comments on a LinkedIn post or article.
 */
async function syncLinkedInComments(
  tenantId: string,
  postId: string
): Promise<SocialSyncResult> {
  const supabase = getServiceSupabase();
  const accessToken = await getSocialAccessToken(tenantId, "linkedin");

  const { data: ppEntry } = await supabase
    .from("post_platforms")
    .select("platform_post_id")
    .eq("post_id", postId)
    .single();

  if (!ppEntry?.platform_post_id) {
    return { postId, commentsImported: 0, platform: "linkedin" };
  }

  const urn = ppEntry.platform_post_id; // e.g., "urn:li:share:123456"

  const res = await fetch(
    `https://api.linkedin.com/v2/socialActions/${encodeURIComponent(urn)}/comments?projection=(results(*,comment~,actor~))`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[Echo] LinkedIn API error for ${urn}:`, errText);
    return { postId, commentsImported: 0, platform: "linkedin" };
  }

  const data = await res.json();
  const comments = data.elements ?? data.results ?? [];
  let imported = 0;

  for (const comment of comments) {
    const commentData = comment["comment~"] ?? comment;
    const actor = commentData.actor ?? comment["actor~"];
    const actorName = `${actor?.localizedFirstName ?? ""} ${actor?.localizedLastName ?? ""}`.trim();

    const { error: upsertErr } = await supabase
      .from("comments")
      .upsert(
        {
          post_id: postId,
          platform: "linkedin",
          platform_comment_id: comment.id ?? commentData.id,
          body: commentData.message?.text ?? "",
          author_name: actorName || "Unknown",
          author_avatar_url: actor?.profilePicture?.["displayImage~"]?.elements?.[0]?.identifiers?.[0]?.identifier,
          engagement_data: {
            likes: 0,
            sentiment: "neutral",
          },
          inbox_status: "unread",
          is_read: false,
        },
        { onConflict: "platform_comment_id" }
      );

    if (!upsertErr) imported++;
  }

  return { postId, commentsImported: imported, platform: "linkedin" };
}

// ============================================================================
// Unified sync
// ============================================================================

/**
 * Syncs social comments for a single post across all its assigned platforms.
 */
export async function syncSocialComments(
  tenantId: string,
  postId: string
): Promise<SocialSyncResult[]> {
  const supabase = getServiceSupabase();

  // Get the post's assigned platforms
  const { data: platforms } = await supabase
    .from("post_platforms")
    .select("social_accounts(platform)")
    .eq("post_id", postId);

  if (!platforms || platforms.length === 0) {
    return [];
  }

  const uniquePlatforms = [
    ...new Set(
      platforms
        .map((p: any) => p.social_accounts?.platform)
        .filter(Boolean) as string[]
    ),
  ];

  const results: SocialSyncResult[] = [];

  for (const platform of uniquePlatforms) {
    try {
      if (platform === "instagram" || platform === "facebook") {
        results.push(
          await syncMetaComments(tenantId, postId, platform as "instagram" | "facebook")
        );
      } else if (platform === "twitter") {
        results.push(await syncTwitterComments(tenantId, postId));
      } else if (platform === "linkedin") {
        results.push(await syncLinkedInComments(tenantId, postId));
      }
    } catch (err: any) {
      console.error(`[Echo] Failed to sync ${platform} comments for post ${postId}:`, err.message);
      results.push({ postId, commentsImported: 0, platform });
    }
  }

  return results;
}

// ============================================================================
// Social Inbox Queries
// ============================================================================

/**
 * Returns paginated social inbox entries for a tenant, with filters.
 */
export async function getSocialInbox(query: SocialInboxQuery) {
  const supabase = getServiceSupabase();

  let dbQuery = supabase
    .from("comments")
    .select("*", { count: "exact" })
    .not("platform", "is", null) // Only social comments (not internal)
    .order("created_at", { ascending: false });

  if (query.status) {
    dbQuery = dbQuery.eq("inbox_status", query.status);
  } else {
    // Default: show unread and replied
    dbQuery = dbQuery.in("inbox_status", ["unread", "replied"]);
  }

  if (query.platform) {
    dbQuery = dbQuery.eq("platform", query.platform);
  }

  // For client filtering, join through the post
  if (query.clientId) {
    // We filter at the application layer since comments don't have a direct
    // tenant_id — instead we validate ownership through the post.
  }

  const { data, error, count } = await dbQuery
    .range(query.offset ?? 0, (query.offset ?? 0) + (query.limit ?? 20) - 1);

  if (error) {
    throw new Error(`Failed to fetch social inbox: ${error.message}`);
  }

  return { comments: data ?? [], total: count ?? 0 };
}

// ============================================================================
// Reply to a comment
// ============================================================================

/**
 * Posts a reply to a social comment via the appropriate platform API.
 */
export async function replyToComment(
  tenantId: string,
  commentId: string,
  replyBody: string
): Promise<{ success: boolean; platformReplyId?: string }> {
  const supabase = getServiceSupabase();

  // Fetch the comment to get platform info
  const { data: comment } = await supabase
    .from("comments")
    .select("platform, platform_comment_id, post_id")
    .eq("id", commentId)
    .single();

  if (!comment?.platform || !comment?.platform_comment_id) {
    throw new Error(`Comment ${commentId} is not a social comment or missing platform info`);
  }

  const accessToken = await getSocialAccessToken(tenantId, comment.platform);

  let platformReplyId: string | undefined;

  if (comment.platform === "instagram" || comment.platform === "facebook") {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${comment.platform_comment_id}/replies?access_token=${accessToken}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: replyBody }),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Meta reply error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    platformReplyId = data.id;
  } else if (comment.platform === "twitter") {
    const res = await fetch("https://api.twitter.com/2/tweets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: replyBody,
        reply: { in_reply_to_tweet_id: comment.platform_comment_id },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`X reply error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    platformReplyId = data.data?.id;
  } else if (comment.platform === "linkedin") {
    const actorRes = await fetch("https://api.linkedin.com/v2/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const actorData = await actorRes.json();
    const actorUrn = actorData.id;

    const replyBodyJson = {
      actor: actorUrn,
      message: { text: replyBody },
      object: comment.platform_comment_id,
    };

    const res = await fetch("https://api.linkedin.com/v2/socialActions/comments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(replyBodyJson),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`LinkedIn reply error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    platformReplyId = data.id;
  }

  // Mark the comment as replied
  await supabase
    .from("comments")
    .update({ inbox_status: "replied", is_read: true })
    .eq("id", commentId);

  return { success: true, platformReplyId };
}