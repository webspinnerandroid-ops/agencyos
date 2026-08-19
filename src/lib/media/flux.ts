import { createClient } from "@supabase/supabase-js";
import {
  generateImage,
  generateVideo,
  generateVoice,
} from "@/lib/ai/orchestrator";
import { persistVideoToStorage } from "@/lib/media/storage";

// ============================================================================
// Types
// ============================================================================

export interface MediaAsset {
  id: string;
  tenant_id: string;
  client_id?: string | null;
  type: "image" | "video" | "voice";
  provider?: string;
  model?: string;
  prompt: string;
  url?: string;
  thumbnail_url?: string;
  metadata?: Record<string, unknown>;
  status: "processing" | "completed" | "failed";
  tags?: string[];
  /** Google Drive mirror status (migration 087). */
  drive_synced_at?: string | null;
  drive_file_id?: string | null;
  drive_error?: string | null;
  created_at: string;
}

export interface CreateImageOptions {
  size?: "1024x1024" | "1792x1024" | "1024x1792" | "512x512" | "256x256";
  n?: number;
  quality?: "standard" | "hd";
  style?: "vivid" | "natural";
  clientId?: string;
  tags?: string[];
}

export interface CreateVideoOptions {
  duration?: number;
  resolution?: string;
  clientId?: string;
  tags?: string[];
  modelId?: string;
  imageUrl?: string;
  /** Human-readable model identifier (e.g. fal-ai/wan/v2.2-a14b/text-to-video). */
  modelIdentifier?: string;
  /** Generation mode — "t2v" (text-to-video) or "i2v" (image-to-video). */
  mode?: "t2v" | "i2v";
}

export interface CreateVoiceOptions {
  voiceId?: string;
  stability?: number;
  similarityBoost?: number;
  clientId?: string;
  tags?: string[];
}

export interface ListMediaFilters {
  type?: "image" | "video" | "voice";
  status?: "processing" | "completed" | "failed";
  clientId?: string;
  limit?: number;
  offset?: number;
}

// ============================================================================
// Internal service-role Supabase client
// ============================================================================

function getServiceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables"
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ============================================================================
// Internal: insert asset row
// ============================================================================

async function insertAsset(params: {
  tenantId: string;
  clientId?: string;
  type: "image" | "video" | "voice";
  provider?: string;
  model?: string;
  prompt: string;
  url?: string;
  thumbnail_url?: string;
  metadata?: Record<string, unknown>;
  status?: "processing" | "completed" | "failed";
  tags?: string[];
}): Promise<MediaAsset> {
  const supabase = getServiceSupabase();

  const { data, error } = await supabase
    .from("media_assets")
    .insert({
      tenant_id: params.tenantId,
      client_id: params.clientId ?? null,
      type: params.type,
      provider: params.provider ?? null,
      model: params.model ?? null,
      prompt: params.prompt,
      url: params.url ?? null,
      thumbnail_url: params.thumbnail_url ?? null,
      metadata: params.metadata ?? {},
      status: params.status ?? "processing",
      tags: params.tags ?? [],
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to insert media asset: ${error.message}`);
  }

  return data as MediaAsset;
}

// ============================================================================
// Internal: update asset after generation
// ============================================================================

async function completeAsset(
  assetId: string,
  updates: { url?: string; thumbnail_url?: string; metadata?: Record<string, unknown> }
): Promise<void> {
  const supabase = getServiceSupabase();

  const { error } = await supabase
    .from("media_assets")
    .update({
      ...updates,
      status: "completed",
    })
    .eq("id", assetId);

  if (error) {
    throw new Error(`Failed to update media asset: ${error.message}`);
  }
}

async function failAsset(assetId: string, errorMessage: string): Promise<void> {
  const supabase = getServiceSupabase();

  const { error } = await supabase
    .from("media_assets")
    .update({
      status: "failed",
      metadata: { error: errorMessage },
    })
    .eq("id", assetId);

  if (error) {
    console.error("[Flux] Failed to mark asset as failed:", error.message);
  }
}

// ============================================================================
// createImageAsset
// ============================================================================

export async function createImageAsset(
  tenantId: string,
  prompt: string,
  options?: CreateImageOptions
): Promise<MediaAsset> {
  // Insert a "processing" row first
  const asset = await insertAsset({
    tenantId,
    clientId: options?.clientId,
    type: "image",
    prompt,
    tags: options?.tags,
    status: "processing",
  });

  // Generate
  try {
    const results = await generateImage(tenantId, prompt, {
      size: options?.size,
      n: options?.n,
      quality: options?.quality,
      style: options?.style,
      clientId: options?.clientId,
    });

    if (results.length === 0) {
      await failAsset(asset.id, "No images returned from provider");
      throw new Error("No images returned from provider");
    }

    // Use the first result; if multiple, store them as metadata
    const primary = results[0];
    await completeAsset(asset.id, {
      url: primary.url,
      metadata: {
        revisedPrompt: primary.revisedPrompt,
        generatedAt: new Date().toISOString(),
      },
    });

    return {
      ...asset,
      url: primary.url,
      status: "completed",
      metadata: {
        revisedPrompt: primary.revisedPrompt,
        generatedAt: new Date().toISOString(),
      },
    };
  } catch (err: any) {
    await failAsset(asset.id, err.message ?? "Unknown error");
    throw err;
  }
}

// ============================================================================
// createVideoAsset
// ============================================================================

export async function createVideoAsset(
  tenantId: string,
  prompt: string,
  options?: CreateVideoOptions
): Promise<MediaAsset> {
  // The metadata written at insert carries mode + modelIdentifier; later
  // provider updates must MERGE into it, never replace it, or the mode/model
  // chips in the library silently vanish.
  const baseMetadata: Record<string, unknown> = {
    mode: options?.mode ?? (options?.imageUrl ? "i2v" : "t2v"),
    ...(options?.modelIdentifier ? { modelIdentifier: options.modelIdentifier } : {}),
    requestedAt: new Date().toISOString(),
  };

  const asset = await insertAsset({
    tenantId,
    clientId: options?.clientId,
    type: "video",
    model: options?.modelIdentifier ?? options?.modelId ?? undefined,
    prompt,
    tags: options?.tags,
    metadata: baseMetadata,
    status: "processing",
  });

  try {
    const result = await generateVideo(tenantId, prompt, {
      duration: options?.duration,
      resolution: options?.resolution,
      clientId: options?.clientId,
      modelId: options?.modelId,
      imageUrl: options?.imageUrl,
    });

    // Video generation is async — store the provider ID and mark as processing
    // The caller can poll via GET asset later
    if (result.status === "completed" && result.videoUrl) {
      // Provider URLs (fal/Wan/Runway) expire — persist to Bunny so the
      // library keeps playing forever instead of showing 0:00. The byte
      // length from the download becomes the stored file size.
      const { url, sizeBytes } = await persistVideoToStorage(tenantId, result.videoUrl);
      const metadata = {
        ...baseMetadata,
        providerId: result.id,
        estimatedSeconds: result.estimatedSeconds,
        generatedAt: new Date().toISOString(),
        ...(sizeBytes != null ? { sizeBytes } : {}),
      };
      await completeAsset(asset.id, { url, metadata });
      return {
        ...asset,
        url,
        status: "completed",
        metadata,
      };
    }

    // Still processing — update metadata with provider ID so caller can poll
    const supabase = getServiceSupabase();
    const metadata = {
      ...baseMetadata,
      providerId: result.id,
      estimatedSeconds: result.estimatedSeconds,
    };
    await supabase
      .from("media_assets")
      .update({ provider: result.id, metadata })
      .eq("id", asset.id);

    return {
      ...asset,
      provider: result.id,
      metadata,
    };
  } catch (err: any) {
    await failAsset(asset.id, err.message ?? "Unknown error");
    throw err;
  }
}

// ============================================================================
// createVoiceAsset
// ============================================================================

export async function createVoiceAsset(
  tenantId: string,
  text: string,
  options?: CreateVoiceOptions
): Promise<MediaAsset> {
  const asset = await insertAsset({
    tenantId,
    clientId: options?.clientId,
    type: "voice",
    prompt: text,
    tags: options?.tags,
    status: "processing",
  });

  try {
    const result = await generateVoice(tenantId, text, {
      voiceId: options?.voiceId,
      stability: options?.stability,
      similarityBoost: options?.similarityBoost,
      clientId: options?.clientId,
    });

    await completeAsset(asset.id, {
      url: result.audioUrl,
      metadata: {
        format: result.format ?? "mp3",
        durationSeconds: result.durationSeconds,
        generatedAt: new Date().toISOString(),
      },
    });

    return {
      ...asset,
      url: result.audioUrl,
      status: "completed",
      metadata: {
        format: result.format ?? "mp3",
        durationSeconds: result.durationSeconds,
        generatedAt: new Date().toISOString(),
      },
    };
  } catch (err: any) {
    await failAsset(asset.id, err.message ?? "Unknown error");
    throw err;
  }
}

// ============================================================================
// listMediaAssets
// ============================================================================

export async function listMediaAssets(
  tenantId: string,
  filters?: ListMediaFilters
): Promise<{ assets: MediaAsset[]; total: number }> {
  const supabase = getServiceSupabase();
  const limit = filters?.limit ?? 20;
  const offset = filters?.offset ?? 0;

  let query = supabase
    .from("media_assets")
    .select("*", { count: "exact" })
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (filters?.type) {
    query = query.eq("type", filters.type);
  }
  if (filters?.status) {
    query = query.eq("status", filters.status);
  }
  if (filters?.clientId) {
    query = query.eq("client_id", filters.clientId);
  }

  const { data, error, count } = await query;

  if (error) {
    throw new Error(`Failed to list media assets: ${error.message}`);
  }

  return { assets: (data ?? []) as MediaAsset[], total: count ?? 0 };
}

// ============================================================================
// getMediaAsset
// ============================================================================

export async function getMediaAsset(
  tenantId: string,
  assetId: string
): Promise<MediaAsset> {
  const supabase = getServiceSupabase();

  const { data, error } = await supabase
    .from("media_assets")
    .select("*")
    .eq("id", assetId)
    .eq("tenant_id", tenantId)
    .single();

  if (error) {
    throw new Error(`Failed to get media asset: ${error.message}`);
  }

  return data as MediaAsset;
}

// ============================================================================
// deleteMediaAsset
// ============================================================================

export async function deleteMediaAsset(
  tenantId: string,
  assetId: string
): Promise<void> {
  const supabase = getServiceSupabase();

  const { error } = await supabase
    .from("media_assets")
    .delete()
    .eq("id", assetId)
    .eq("tenant_id", tenantId);

  if (error) {
    throw new Error(`Failed to delete media asset: ${error.message}`);
  }
}