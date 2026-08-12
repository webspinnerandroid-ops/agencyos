// social-pipeline.ts
//
// Pam's content pipeline: generate a platform-appropriate social caption and
// save it as a post in "pending_approval" (content approval gate — nothing
// gets scheduled/published until a human approves the generated content).
//
// Media: image generation is live — each social post gets one platform-aware
// image (persisted to storage + media_assets). Video generation for
// TikTok/Threads/Instagram is on the roadmap; until it ships, those platforms
// default to images (media_kind: "image") and the value records the intent
// so the video path can take over without data changes.
import { createServiceClient } from "@/lib/supabase/server";
import { generateText, generateImage } from "@/lib/ai/orchestrator";
import { getSocialCaptionPrompt } from "@/lib/ai/seo-prompts";
import { incrementUsage } from "@/lib/usage";
import { persistImageToStorage } from "@/lib/media/storage";
import { checkTrialContentLimit } from "@/lib/trial-limits";

const PLATFORM_LABELS: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  threads: "Threads",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  x: "X / Twitter",
};

export interface SocialDraft {
  postId: string;
  caption: string;
  mediaUrl?: string | null;
}

/**
 * Unwrap a JSON-enveloped caption into readable plain text.
 *
 * If the model returns `{"caption": "...", "firstComment": "...", ...}`,
 * join caption + firstComment (marked as a comment) into one block. If it
 * returns plain text, pass it through untouched.
 */
export function normalizeCaption(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return trimmed;
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (typeof parsed !== "object" || parsed === null) return trimmed;
    const parts: string[] = [];
    const caption =
      typeof parsed.caption === "string" && parsed.caption.length > 0
        ? parsed.caption
        : null;
    if (caption) parts.push(caption);
    const firstComment =
      typeof parsed.firstComment === "string" &&
      parsed.firstComment.length > 0
        ? parsed.firstComment
        : null;
    if (firstComment) {
      parts.push(`[First comment] ${firstComment.replace(/^\[FIRST COMMENT HASHTAGS\]\s*/i, "")}`);
    }
    return parts.length > 0 ? parts.join("\n\n") : trimmed;
  } catch {
    return trimmed;
  }
}

/**
 * Generate a social caption for a topic and save it as a pending-approval
 * post on the given due date (scheduled_at set so it shows on the calendar
 * on its day — still pending approval, not scheduled for real publishing).
 *
 * Media: one platform-aware image is generated and attached (TikTok/Threads/
 * Instagram and the rest all default to image until video generation ships).
 * Image failures are non-fatal — the caption still saves so content approval
 * isn't blocked by a media hiccup.
 */
export async function pamGenerateSocial(
  tenantId: string,
  topic: string,
  platform: string,
  dueDate: string,
  workspaceId: string | null,
  keywords: string[] = [],
  mediaKind: "image" | "video" = "image"
): Promise<SocialDraft> {
  const platformLabel = PLATFORM_LABELS[platform] ?? platform;
  const systemPrompt = getSocialCaptionPrompt(platform);

  const raw = await generateText(
    "team_chat",
    `Write a ${platformLabel} caption about: "${topic}".` +
      (keywords.length > 0
        ? ` Work the keywords into the caption naturally where they fit: ${keywords.join(", ")}.`
        : ""),
    tenantId,
    { systemPrompt, temperature: 0.7, maxTokens: 2048 }
  );

  // The model sometimes wraps the caption in a JSON envelope (e.g. because
  // the platform guide mentions first-comment hashtags). Normalize: if the
  // text is parseable JSON with a caption/firstComment, extract and assemble
  // a clean plain-text caption the user can read and approve.
  const caption = normalizeCaption(raw);

  const supabase = await createServiceClient();

  // Platform-aware media: images are live now (1:1 suits most social feeds;
  // TikTok/Reels/Shorts want 9:16 once video lands). When the user picks
  // "video" the intent is recorded on the post and an image is used as the
  // fallback until video generation ships — the media_kind field carries the
  // user's choice so the video path can take over without data changes.
  let mediaUrl: string | null = null;
  if (mediaKind === "image") {
    try {
      // Trial tenants: one image per week — enforced here too so the AI team
      // can't bypass the API-route cap via social posts.
      const trial = await checkTrialContentLimit(tenantId, "image");
      if (!trial.allowed) {
        throw new Error(trial.reason ?? "Weekly trial limit reached");
      }
      const images = await generateImage(tenantId, topic, {
        size: "1024x1024",
        n: 1,
      });
      const rawUrl = images[0]?.url;
      if (rawUrl) {
        mediaUrl = await persistImageToStorage(tenantId, rawUrl);
        const { error: assetErr } = await supabase.from("media_assets").insert({
          tenant_id: tenantId,
          client_id: null,
          workspace_id: workspaceId,
          type: "image",
          prompt: topic,
          url: mediaUrl,
          metadata: { placement: "social", platform },
          status: "completed",
        });
        if (assetErr) console.warn("[social-pipeline] media_assets insert failed:", assetErr.message);
        void incrementUsage(tenantId, "image_generations", 1);
        void incrementUsage(tenantId, "ai_tokens", 1000);
      }
    } catch (err) {
      console.warn(
        `[social-pipeline] Image generation failed for "${topic}":`,
        err instanceof Error ? err.message : err
      );
    }
  }

  const scheduled = new Date(`${dueDate}T12:00:00`).toISOString();
  const { data: post, error } = await supabase
    .from("posts")
    .insert({
      tenant_id: tenantId,
      client_id: null,
      workspace_id: workspaceId,
      content: {
        type: "social",
        title: topic,
        caption,
        platform,
        topic,
        media_kind: mediaKind, // "video" records intent; image used until video ships
      },
      media_urls: mediaUrl ? [mediaUrl] : [],
      status: "pending_approval",
      scheduled_at: scheduled,
      created_by: null,
      ai_generated: true,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Failed to save social post: ${error.message}`);
  if (!post) throw new Error("Failed to save social post");

  void incrementUsage(tenantId, "ai_tokens", 2000);
  return { postId: post.id, caption, mediaUrl };
}
