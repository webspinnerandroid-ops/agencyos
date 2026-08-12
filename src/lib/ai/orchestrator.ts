import { createClient } from "@supabase/supabase-js";
import { repairTruncatedJson } from "./json-repair";

// ============================================================================
// Types
// ============================================================================

export type AIProvider =
  | "openai"
  | "deepseek"
  | "anthropic"
  | "stability"
  | "google"
  | "meta"
  | "mistral"
  | "cohere"
  | "xai"
  | "perplexity"
  | "together"
  | "fireworks"
  | "replicate"
  | "groq"
  | "openrouter"
  | "midjourney"
  | "leonardo"
  | "adobe"
  | "ideogram"
  | "runway"
  | "heygen"
  | "pika"
  | "synthesia"
  | "kaiber"
  | "elevenlabs"
  | "playht"
  | "murf"
  | "resemble"
  | "wellsaid"
  | "voyage"
  | "jina";

export type ProviderType =
  | "text"
  | "image"
  | "video"
  | "voice"
  | "embedding"
  | "publishing";

export type AIModel = {
  provider: AIProvider;
  modelId: string;
  displayName: string;
};

export type AITask =
  | "blog_generation"
  | "social_caption"
  | "email_generation"
  | "ad_copy"
  | "image_generation"
  | "video_generation"
  | "voice_synthesis"
  | "embeddings"
  | "seo_audit"
  | "seo_campaign_generation"
  | "team_chat";

// Map tasks to their primary provider type for fallback matching
const TASK_PROVIDER_TYPE_MAP: Record<AITask, ProviderType> = {
  blog_generation: "text",
  social_caption: "text",
  email_generation: "text",
  ad_copy: "text",
  image_generation: "image",
  video_generation: "video",
  voice_synthesis: "voice",
  embeddings: "embedding",
  seo_audit: "text",
  seo_campaign_generation: "text",
  team_chat: "text",
};

// Map legacy AIProvider enum values to DB provider names for backward compat
const PROVIDER_NAME_MAP: Record<string, string> = {
  openai: "OpenAI",
  deepseek: "DeepSeek",
  anthropic: "Anthropic",
  stability: "Stability AI",
  google: "Google",
  meta: "Meta",
  mistral: "Mistral",
  cohere: "Cohere",
  xai: "xAI",
  perplexity: "Perplexity",
  together: "Together AI",
  fireworks: "Fireworks",
  replicate: "Replicate",
  groq: "Groq",
  openrouter: "OpenRouter",
  midjourney: "Midjourney",
  leonardo: "Leonardo AI",
  adobe: "Adobe Firefly",
  ideogram: "Ideogram",
  runway: "Runway",
  heygen: "HeyGen",
  pika: "Pika",
  synthesia: "Synthesia",
  kaiber: "Kaiber",
  wan: "Alibaba Wan",
  elevenlabs: "ElevenLabs",
  playht: "Play.ht",
  murf: "Murf",
  resemble: "Resemble",
  wellsaid: "WellSaid",
  voyage: "Voyage AI",
  jina: "Jina AI",
};

// Provider API base URLs
const PROVIDER_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  stability: "https://api.stability.ai/v1",
  google: "https://generativelanguage.googleapis.com/v1beta",
  mistral: "https://api.mistral.ai/v1",
  cohere: "https://api.cohere.ai/v1",
  xai: "https://api.x.ai/v1",
  perplexity: "https://api.perplexity.ai",
  together: "https://api.together.xyz/v1",
  fireworks: "https://api.fireworks.ai/inference/v1",
  replicate: "https://api.replicate.com/v1",
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  midjourney: "https://api.midjourney.com",
  leonardo: "https://cloud.leonardo.ai/api/rest/v1",
  adobe: "https://firefly-api.adobe.io/v1",
  ideogram: "https://api.ideogram.ai/v1",
  runway: "https://api.runwayml.com/v1",
  heygen: "https://api.heygen.com/v2",
  pika: "https://api.pika.art/v1",
  synthesia: "https://api.synthesia.io/v1",
  kaiber: "https://api.kaiber.ai/v1",
  wan: "https://dashscope.aliyuncs.com/api/v1",
  elevenlabs: "https://api.elevenlabs.io/v1",
  playht: "https://api.play.ht/api/v2",
  murf: "https://api.murf.ai/v1",
  resemble: "https://app.resemble.ai/api/v2",
  wellsaid: "https://api.wellsaidlabs.com/v1",
  voyage: "https://api.voyageai.com/v1",
  jina: "https://api.jina.ai/v1",
};

// ============================================================================
// Model resolution result
// ============================================================================

export interface ModelResolution {
  providerName: string;
  providerType: ProviderType;
  model: string;
  apiKey: string;
  providerBaseUrl: string;
}

// ============================================================================
// Internal Supabase client (service role) for server-side DB queries
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
// Encryption helpers
// ============================================================================

function byteaToHex(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Buffer.isBuffer(value)) return value.toString("hex");
  if (typeof value === "string") {
    // Handle JSON-serialized Buffer: {"type":"Buffer","data":[...]}
    if (value.startsWith("{")) {
      try {
        const parsed = JSON.parse(value);
        if (parsed.type === "Buffer" && Array.isArray(parsed.data)) {
          return Buffer.from(parsed.data).toString("hex");
        }
      } catch { /* fall through */ }
    }
    return value.replace(/^\\x/, "");
  }
  return "";
}

async function decryptKey(encryptedHex: string): Promise<string> {
  const { decrypt } = await import("@/lib/encryption");
  return decrypt(encryptedHex);
}

// ============================================================================
// getModelForTask
// ============================================================================

/**
 * Resolves which AI provider, model, and API key to use for a given task.
 * Returns a ModelResolution with providerType so callers can branch on modality.
 *
 * Resolution order:
 * 1. Query `task_model_mappings` joined through `ai_models` → `ai_providers`
 * 2. Fall back to tenant_api_keys by provider type (text/image/video/voice/embedding)
 * 3. Platform default keys from env vars
 */
export async function getModelForTask(
  tenantId: string,
  task: AITask,
  clientId?: string
): Promise<ModelResolution> {
  const supabase = getServiceSupabase();

  // --- Step 1: Try task_model_mappings with joins ---------------------------
  const { data: allMappings } = await supabase
    .from("task_model_mappings")
    .select(
      `
      id, task, model_id, client_id,
      model:ai_models!inner ( id, model_identifier, provider_id, provider:ai_providers!inner ( id, name, base_url, type ) )
    `
    )
    .eq("tenant_id", tenantId)
    .eq("task", task);

  const mapping = findBestMapping(allMappings ?? [], clientId);

  if (mapping) {
    const providerId = mapping.model?.provider_id;
    const modelIdentifier = mapping.model?.model_identifier;
    const baseUrl = mapping.model?.provider?.base_url;
    const providerType = (mapping.model?.provider?.type as ProviderType) ?? "text";
    const providerName = mapping.model?.provider?.name ?? "";

    if (providerId && modelIdentifier) {
      const apiKey = await getApiKeyForProviderId(supabase, tenantId, providerId);
      if (apiKey) {
        return {
          providerName,
          providerType,
          model: modelIdentifier,
          apiKey,
          providerBaseUrl: baseUrl ?? "https://api.openai.com/v1",
        };
      }
    }
  }

  // --- Step 2: Fall back to tenant_api_keys by provider type ----------------
  const fallbackType = TASK_PROVIDER_TYPE_MAP[task];
  const fallbackData = await getFallbackApiKeyByType(supabase, tenantId, fallbackType);
  if (fallbackData) {
    return {
      providerName: fallbackData.providerName,
      providerType: fallbackType,
      model: fallbackData.defaultModel,
      apiKey: fallbackData.apiKey,
      providerBaseUrl: fallbackData.baseUrl,
    };
  }

  // --- Step 3: Platform default keys from env vars --------------------------
  const defaultModel = getDefaultModelForType(fallbackType);
  const envApiKey = getPlatformDefaultApiKeyForType(fallbackType);
  const envBaseUrl = getPlatformDefaultBaseUrlForType(fallbackType);
  return {
    providerName: fallbackType,
    providerType: fallbackType,
    model: defaultModel,
    apiKey: envApiKey,
    providerBaseUrl: envBaseUrl,
  };
}

// ============================================================================
// Helpers
// ============================================================================

interface DbMapping {
  id: string;
  task: string;
  model_id: string;
  client_id: string | null;
  model: {
    id: string;
    model_identifier: string;
    provider_id: string;
    provider: {
      id: string;
      name: string;
      base_url: string;
      type: string;
    };
  };
}

function findBestMapping(
  mappings: any[],
  clientId?: string
): DbMapping | null {
  if (!mappings || mappings.length === 0) return null;

  if (clientId) {
    const clientMapping = mappings.find((m) => m.client_id === clientId);
    if (clientMapping) return clientMapping as DbMapping;
  }

  const tenantMapping = mappings.find((m) => m.client_id === null);
  if (tenantMapping) return tenantMapping as DbMapping;

  return mappings[0] as DbMapping;
}

async function getApiKeyForProviderId(
  supabase: ReturnType<typeof getServiceSupabase>,
  tenantId: string,
  providerId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("tenant_api_keys")
    .select("encrypted_key")
    .eq("tenant_id", tenantId)
    .eq("provider_id", providerId)
    .eq("is_active", true)
    .limit(1)
    .single();

  if (!data?.encrypted_key) return null;

  try {
    const hexStr = byteaToHex(data.encrypted_key);
    if (hexStr.length > 0) {
      return await decryptKey(hexStr);
    }
  } catch {
    console.warn("[Orchestrator] Failed to decrypt API key for provider", providerId);
  }

  return null;
}

async function getFallbackApiKeyByType(
  supabase: ReturnType<typeof getServiceSupabase>,
  tenantId: string,
  providerType: ProviderType
): Promise<{ providerName: string; apiKey: string; baseUrl: string; defaultModel: string } | null> {
  // Find the first provider of this type that the tenant has a key for
  const { data: providers } = await supabase
    .from("ai_providers")
    .select("id, name, base_url")
    .eq("type", providerType)
    .order("name");

  if (!providers || providers.length === 0) return null;

  for (const provider of providers) {
    const apiKey = await getApiKeyForProviderId(supabase, tenantId, provider.id);
    if (apiKey) {
      const defaultModel = getDefaultModelForType(providerType);
      return {
        providerName: provider.name,
        apiKey,
        baseUrl: provider.base_url ?? getDefaultBaseUrlForType(providerType),
        defaultModel,
      };
    }
  }

  return null;
}

function getDefaultModelForType(type: ProviderType): string {
  const useDeepSeek = !!process.env.DEEPSEEK_API_KEY && !process.env.OPENAI_API_KEY;
  switch (type) {
    case "text":
      // DeepSeek's current API model IDs are "deepseek-v4-pro" and
      // "deepseek-v4-flash" (see api-docs.deepseek.com/quick_start/pricing).
      // The legacy "deepseek-chat"/"deepseek-reasoner" aliases were retired
      // on 2026-07-24 (see api-docs.deepseek.com/updates); they used to point
      // at V4-Flash's non-thinking/thinking modes. Use v4-flash as the cheap,
      // fast default for the env-var fallback path.
      return useDeepSeek ? "deepseek-v4-flash" : "gpt-4o";
    case "image":
      // Google Imagen is the preferred image provider. Falls back to DALL-E
      // only if no Google key is configured.
      return (process.env.GOOGLE_API_KEY)
        ? "gemini-2.5-flash-image"
        : (useDeepSeek ? "dall-e-3" : "dall-e-3");
    case "video":
      return useDeepSeek ? "gen-3-alpha" : "gen-3-alpha";
    case "voice":
      return useDeepSeek ? "eleven-multilingual-v2" : "eleven-multilingual-v2";
    case "embedding":
      return useDeepSeek ? "text-embedding-3-large" : "text-embedding-3-large";
    default:
      return useDeepSeek ? "deepseek-v4-flash" : "gpt-4o";
  }
}

function getPlatformDefaultApiKeyForType(type: ProviderType): string {
  switch (type) {
    case "text":
      return process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY || "";
    case "image":
      return process.env.GOOGLE_API_KEY || process.env.OPENAI_API_KEY || process.env.STABILITY_API_KEY || "";
    case "video":
      return process.env.RUNWAY_API_KEY || "";
    case "voice":
      return process.env.ELEVENLABS_API_KEY || "";
    case "embedding":
      return process.env.OPENAI_API_KEY || "";
    default:
      return "";
  }
}

function getPlatformDefaultBaseUrlForType(type: ProviderType): string {
  switch (type) {
    case "text":
      if (process.env.DEEPSEEK_API_KEY && !process.env.OPENAI_API_KEY) {
        return "https://api.deepseek.com/v1";
      }
      return "https://api.openai.com/v1";
    default:
      return getDefaultBaseUrlForType(type);
  }
}

function getDefaultBaseUrlForType(type: ProviderType): string {
  switch (type) {
    case "text":
      return "https://api.openai.com/v1";
    case "image":
      return (process.env.GOOGLE_API_KEY)
        ? "https://generativelanguage.googleapis.com/v1beta"
        : "https://api.openai.com/v1";
    case "video":
      return "https://api.runwayml.com/v1";
    case "voice":
      return "https://api.elevenlabs.io/v1";
    case "embedding":
      return "https://api.openai.com/v1";
    default:
      return "https://api.openai.com/v1";
  }
}

function inferProviderFromBaseUrl(baseUrl: string): AIProvider {
  if (baseUrl.includes("deepseek")) return "deepseek";
  if (baseUrl.includes("openai")) return "openai";
  if (baseUrl.includes("anthropic")) return "anthropic";
  if (baseUrl.includes("stability")) return "stability";
  if (baseUrl.includes("google")) return "google";
  if (baseUrl.includes("mistral")) return "mistral";
  if (baseUrl.includes("cohere")) return "cohere";
  if (baseUrl.includes("x.ai")) return "xai";
  if (baseUrl.includes("perplexity")) return "perplexity";
  if (baseUrl.includes("together")) return "together";
  if (baseUrl.includes("fireworks")) return "fireworks";
  if (baseUrl.includes("replicate")) return "replicate";
  if (baseUrl.includes("groq")) return "groq";
  if (baseUrl.includes("openrouter")) return "openrouter";
  return "openai";
}

// ============================================================================
// Retry with exponential backoff
// ============================================================================

interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 1000, maxDelayMs = 30000 } = options;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      if (error?.status && error.status >= 400 && error.status < 500 && error.status !== 429) {
        throw error;
      }

      if (attempt === maxRetries) {
        throw error;
      }

      const delay = Math.min(
        baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000,
        maxDelayMs
      );

      console.warn(
        `[AI Orchestrator] Attempt ${attempt + 1} failed. Retrying in ${Math.round(delay)}ms...`,
        error?.message ?? error
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError ?? new Error("Retry failed with unknown error");
}

// ============================================================================
// Provider API Adapters — Chat (text)
// ============================================================================

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string | null;
      tool_calls?: {
        id: string;
        type: "function";
        function: {
          name: string;
          arguments: string;
        };
      }[];
    };
    finish_reason: string;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

async function callOpenAICompatibleAPI(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  options?: {
    temperature?: number;
    maxTokens?: number;
    responseFormat?: { type: "json_object" | "text" };
    tools?: any[];
    toolChoice?: string;
    stream?: boolean;
  }
): Promise<ChatCompletionResponse> {
  const body: Record<string, any> = {
    model,
    messages,
    temperature: options?.temperature ?? 0.7,
    max_tokens: options?.maxTokens ?? 4096,
  };

  if (options?.responseFormat) {
    body.response_format = options.responseFormat;
  }

  if (options?.tools && options.tools.length > 0) {
    body.tools = options.tools;
    body.tool_choice = options.toolChoice ?? "auto";
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const error: any = new Error(
      `Provider API error (${response.status}): ${errorText}`
    );
    error.status = response.status;
    throw error;
  }

  const data: ChatCompletionResponse = await response.json();
  return data;
}

// ============================================================================
// generateText
// ============================================================================

export async function generateText(
  task: AITask,
  prompt: string,
  tenantId: string,
  options?: {
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
    clientId?: string;
  }
): Promise<string> {
  const { model, apiKey, providerBaseUrl } = await getModelForTask(
    tenantId,
    task,
    options?.clientId
  );

  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error(
      `No API key configured for task "${task}". Add an API key in AI Settings or set the required environment variable.`
    );
  }

  const messages: ChatMessage[] = [];

  if (options?.systemPrompt) {
    messages.push({ role: "system", content: options.systemPrompt });
  }

  messages.push({ role: "user", content: prompt });

  const result = await retryWithBackoff(() =>
    callOpenAICompatibleAPI(providerBaseUrl, apiKey, model, messages, {
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
    })
  );

  let content = result.choices[0]?.message?.content;
  // DeepSeek V4 thinking mode can spend the whole budget on reasoning and
  // return empty content with finish_reason "length" — retry once with
  // doubled tokens before failing.
  if (!content && result.choices[0]?.finish_reason === "length") {
    const doubled = Math.min((options?.maxTokens ?? 4096) * 2, 32768);
    console.warn(
      `[Orchestrator] Empty content (thinking mode exhausted tokens), retrying with ${doubled}...`
    );
    const retryResult = await retryWithBackoff(() =>
      callOpenAICompatibleAPI(providerBaseUrl, apiKey, model, messages, {
        temperature: options?.temperature,
        maxTokens: doubled,
      })
    );
    content = retryResult.choices[0]?.message?.content;
  }
  if (!content) {
    throw new Error("No content returned from AI provider");
  }

  return content;
}

// ============================================================================
// generateStructuredOutput
// ============================================================================

export async function generateStructuredOutput<T>(
  task: AITask,
  systemPrompt: string,
  userPrompt: string,
  tenantId: string,
  schema: any,
  options?: {
    temperature?: number;
    maxTokens?: number;
    clientId?: string;
    functionName?: string;
    useJsonMode?: boolean;
  }
): Promise<T> {
  const { model, apiKey, providerBaseUrl } = await getModelForTask(
    tenantId,
    task,
    options?.clientId
  );

  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error(
      `No API key configured for task "${task}". Add an API key in AI Settings or set the required environment variable.`
    );
  }

  const functionName = options?.functionName ?? "generate_output";

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  const toolDefinition = {
    type: "function" as const,
    function: {
      name: functionName,
      description: `Generate structured output matching the required schema for ${task}`,
      parameters: schema,
    },
  };

  let result: ChatCompletionResponse;

  // DeepSeek models enter "thinking mode" when tool_choice is used;
  // auto-switch to JSON mode to avoid 400 errors.
  // Check base URL, model name, AND env fallback to catch all DeepSeek paths.
  const isDeepSeek =
    providerBaseUrl.includes("deepseek") ||
    model.toLowerCase().includes("deepseek") ||
    (!!process.env.DEEPSEEK_API_KEY && !process.env.OPENAI_API_KEY);
  const useJsonMode = options?.useJsonMode ?? isDeepSeek;

  if (useJsonMode) {
    const jsonSystemPrompt = `${systemPrompt}\n\nIMPORTANT: You MUST respond with ONLY valid JSON. Do not include any additional text, explanations, or markdown formatting. The response must be a single JSON object that can be parsed by JSON.parse().`;

    // For content generation (blog, campaign), default to 16384 tokens
    // since responses can be large (title + meta + headings + body + image prompts).
    // Smaller tasks like social captions will just use what they need.
    const maxTokens = options?.maxTokens ?? 16384;

    // NOTE: Do NOT send responseFormat: { type: "json_object" } to DeepSeek —
    // it can return empty content. Rely on the strong JSON system prompt instead.
    const makeJsonCall = (tokens: number) =>
      callOpenAICompatibleAPI(providerBaseUrl, apiKey, model, [
        { role: "system", content: jsonSystemPrompt },
        { role: "user", content: userPrompt },
      ], {
        temperature: options?.temperature ?? 0.3,
        maxTokens: tokens,
      });

    result = await retryWithBackoff(() => makeJsonCall(maxTokens));

    let content = result.choices[0]?.message?.content;
    if (!content && isDeepSeek) {
      // DeepSeek "thinking mode" does NOT support tool_choice — it returns
      // HTTP 400 "Thinking mode does not support this tool_choice".
      // Retry using plain JSON mode (no tools) instead, which is reliable.
      console.warn("[Orchestrator] DeepSeek JSON mode returned empty, retrying JSON mode");
      result = await retryWithBackoff(() => makeJsonCall(maxTokens));
      content = result.choices[0]?.message?.content;
    }
    // DeepSeek V4 thinking mode can burn the entire token budget on reasoning
    // and finish with an EMPTY message and finish_reason "length". The
    // truncated-JSON retry below never fires in that case (nothing to parse),
    // so retry once here with doubled tokens before giving up.
    if (!content && result.choices[0]?.finish_reason === "length" && maxTokens <= 32768) {
      console.warn(
        `[Orchestrator] DeepSeek returned empty content (thinking mode exhausted ${maxTokens} tokens), retrying with ${maxTokens * 2}...`
      );
      result = await retryWithBackoff(() => makeJsonCall(maxTokens * 2));
      content = result.choices[0]?.message?.content;
    }
    if (!content) {
      throw new Error("No content returned from AI provider in JSON mode");
    }

    const tryParse = (raw: string): T | null => {
      try {
        return JSON.parse(raw) as T;
      } catch {
        // Try extracting from markdown code fence
        const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
          try {
            return JSON.parse(jsonMatch[1].trim()) as T;
          } catch {
            // fall through to salvage below
          }
        }
        // Salvage truncated JSON: drop the broken tail and close any open
        // containers. Models (esp. DeepSeek thinking mode) exhaust the output
        // budget mid-structure, so the truncation often has NO closing brace
        // at all — the old walk-back could only fix tails that ended on one.
        const repaired = repairTruncatedJson(raw);
        if (repaired !== null) return repaired as T;
        return null;
      }
    };

    const parsed = tryParse(content);
    if (parsed) return parsed;

    // If the response was truncated (finish_reason: "length") and we haven't
    // already doubled the token limit, retry with 2x maxTokens once. Allow
    // the retry even at the 32768 cap — a second attempt at the same budget
    // often lands a complete response, and the repair above already salvages
    // most truncations.
    const finishReason = result.choices[0]?.finish_reason;
    if (finishReason === "length" && maxTokens <= 32768) {
      console.warn(
        `[Orchestrator] JSON truncated at ${maxTokens} tokens, retrying with ${maxTokens * 2}...`
      );
      const retryResult = await retryWithBackoff(() =>
        makeJsonCall(maxTokens * 2)
      );
      const retryContent = retryResult.choices[0]?.message?.content;
      if (retryContent) {
        const retryParsed = tryParse(retryContent);
        if (retryParsed) return retryParsed;
        content = retryContent; // for error message below
      }
    }

    throw new Error(
      `Failed to parse JSON response: ${content.substring(0, 500)}`
    );
  } else {
    result = await retryWithBackoff(() =>
      callOpenAICompatibleAPI(providerBaseUrl, apiKey, model, messages, {
        temperature: options?.temperature ?? 0.3,
        maxTokens: options?.maxTokens ?? 4096,
        tools: [toolDefinition],
        toolChoice: "required",
      })
    );

    const toolCalls = result.choices[0]?.message?.tool_calls;
    if (toolCalls && toolCalls.length > 0) {
      const functionArgs = toolCalls[0].function.arguments;
      try {
        return JSON.parse(functionArgs) as T;
      } catch (parseError) {
        throw new Error(
          `Failed to parse function call arguments: ${(parseError as Error).message}`
        );
      }
    }

    const content = result.choices[0]?.message?.content;
    if (content) {
      try {
        return JSON.parse(content) as T;
      } catch {
        throw new Error("No structured output returned from AI provider");
      }
    }

    throw new Error("No structured output returned from AI provider");
  }
}

// ============================================================================
// generateImage — Image generation (DALL-E, Stability, etc.)
// ============================================================================

export interface GeneratedImage {
  url: string;
  revisedPrompt?: string;
}

/**
 * Global demographic/cultural guidance appended to every generated image
 * prompt. Image models default to stock demographics that skew heavily Asian;
 * this keeps output reflective of the actual (Canadian) market — predominantly
 * Caucasian with visible diversity, and culturally Canadian settings. It is a
 * suffix, so an explicit subject in the caller's prompt (e.g. "Japanese tea
 * ceremony") still wins.
 */
const IMAGE_DEMOGRAPHIC_GUIDANCE =
  " People depicted must reflect a realistic Canadian demographic mix: " +
  "predominantly white/Caucasian, with visible diversity (South Asian, East " +
  "Asian, Black, Indigenous, and mixed-race Canadians) — never predominantly " +
  "Asian unless the subject matter explicitly calls for it. Settings, clothing, " +
  "and culture should feel authentically Canadian (local coffee shops, patios, " +
  "snow seasons, neighbourhood streets) unless the subject requires otherwise.";

export async function generateImage(
  tenantId: string,
  prompt: string,
  options?: {
    size?: "1024x1024" | "1792x1024" | "1024x1792" | "512x512" | "256x256";
    n?: number;
    quality?: "standard" | "hd";
    style?: "vivid" | "natural";
    clientId?: string;
    // Optional base64 data URL of an inspiration/reference image.
    // Google Imagen/Gemini supports native image editing; other providers
    // ignore it and fall back to text-only generation.
    referenceImage?: string;
  }
): Promise<GeneratedImage[]> {
  const resolution = await getModelForTask(tenantId, "image_generation", options?.clientId);
  const fullPrompt = `${prompt}${IMAGE_DEMOGRAPHIC_GUIDANCE}`;

  // Route to the appropriate image API based on provider
  if (resolution.providerName === "Google Imagen" || resolution.providerBaseUrl.includes("googleapis")) {
    return callGoogleImagenAPI(resolution, fullPrompt, options);
  }

  if (resolution.providerName === "OpenAI Image" || resolution.providerBaseUrl.includes("openai")) {
    return callDalleImageAPI(resolution, fullPrompt, options);
  }

  if (resolution.providerName === "Stability AI" || resolution.providerBaseUrl.includes("stability")) {
    return callStabilityImageAPI(resolution, fullPrompt, options);
  }

  // Default: OpenAI-compatible image endpoint
  return callDalleImageAPI(resolution, fullPrompt, options);
}

async function callDalleImageAPI(
  resolution: ModelResolution,
  prompt: string,
  options?: { size?: string; n?: number; quality?: string; style?: string }
): Promise<GeneratedImage[]> {
  const body: Record<string, any> = {
    model: resolution.model,
    prompt,
    n: options?.n ?? 1,
    size: options?.size ?? "1024x1024",
  };

  if (options?.quality) body.quality = options.quality;
  if (options?.style) body.style = options.style;

  const response = await fetch(`${resolution.providerBaseUrl}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resolution.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const error: any = new Error(`Image API error (${response.status}): ${errorText}`);
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  return (data.data ?? []).map((item: any) => ({
    url: item.url,
    revisedPrompt: item.revised_prompt,
  }));
}

async function callStabilityImageAPI(
  resolution: ModelResolution,
  prompt: string,
  options?: { n?: number }
): Promise<GeneratedImage[]> {
  const formData = new FormData();
  formData.append("prompt", prompt);
  formData.append("output_format", "png");

  const response = await fetch(`${resolution.providerBaseUrl}/v2beta/stable-image/generate/sd3`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resolution.apiKey}`,
      Accept: "application/json",
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    const error: any = new Error(`Stability API error (${response.status}): ${errorText}`);
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  // Stability returns base64; convert to data URL
  const images: GeneratedImage[] = [];
  if (data.image) {
    images.push({ url: `data:image/png;base64,${data.image}` });
  }
  return images;
}

// ============================================================================
// Google Imagen API — Uses the Gemini API SDK (same key as Google text models)
// ============================================================================

function buildImagenParameters(n?: number, size?: string): Record<string, unknown> {
  const parameters: Record<string, unknown> = { sampleCount: n ?? 1 };
  const normalized = normalizeAspectRatio(size);
  if (normalized) parameters.aspectRatio = normalized;
  return parameters;
}

// Imagen 4 only accepts ratio strings: 1:1, 9:16, 16:9, 4:3, 3:4.
// Convert pixel sizes (e.g. 1024x1024) to the closest supported ratio.
function normalizeAspectRatio(size?: string): string | null {
  if (!size) return null;
  if (size.includes(":")) return size;
  if (size.includes("x")) {
    const parts = size.toLowerCase().split("x");
    const w = parseInt(parts[0], 10);
    const h = parseInt(parts[1], 10);
    if (w && h) {
      const ratio = w / h;
      if (Math.abs(ratio - 1) < 0.01) return "1:1";
      if (Math.abs(ratio - 16 / 9) < 0.1) return "16:9";
      if (Math.abs(ratio - 9 / 16) < 0.1) return "9:16";
      if (Math.abs(ratio - 4 / 3) < 0.1) return "4:3";
      if (Math.abs(ratio - 3 / 4) < 0.1) return "3:4";
    }
  }
  return null;
}

async function callGoogleImagenAPI(
  resolution: ModelResolution,
  prompt: string,
  options?: { n?: number; size?: string; referenceImage?: string }
): Promise<GeneratedImage[]> {
  const modelId = resolution.model || "gemini-2.5-flash-image";
  const baseUrl = resolution.providerBaseUrl.replace(/\/$/, "");

  // Route by model family.
  // Imagen 4 exposes the predict method (ListModels confirmed);
  // Nano Banana (gemini-*-image) models use generateContent.
  if (!modelId.startsWith("imagen-")) {
    return callNanoBananaGenerateContent(resolution, modelId, baseUrl, prompt, options);
  }

  // Imagen 4 predict path
  const body = {
    instances: [
      {
        prompt,
      },
    ],
    parameters: buildImagenParameters(options?.n, options?.size),
  };

  const response = await fetch(
    baseUrl + "/models/" + modelId + ":predict",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": resolution.apiKey,
      },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    const error: any = new Error(
      "Google Imagen API error (" + response.status + "): " + errorText
    );
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  const images: GeneratedImage[] = [];

  // Imagen 4 returns base64 images in predictions[].bytesBase64Encoded
  const predictions: any[] = data.predictions ?? [];
  for (const pred of predictions) {
    if (pred.bytesBase64Encoded) {
      images.push({
        url: "data:image/png;base64," + pred.bytesBase64Encoded,
        revisedPrompt: prompt,
      });
    }
  }

  return images;
}

// Nano Banana (Gemini image models) use the generateContent endpoint.
// Request: { contents: [{ parts: [{ text }] }], generationConfig: { responseModalities: ["Image"] } }
// Response: candidates[].content.parts[].inlineData { data, mimeType }
async function callNanoBananaGenerateContent(
  resolution: ModelResolution,
  modelId: string,
  baseUrl: string,
  prompt: string,
  options?: { n?: number; size?: string; referenceImage?: string }
): Promise<GeneratedImage[]> {
  const parts: { text?: string; inlineData?: { mimeType: string; data: string } }[] = [
    { text: prompt },
  ];
  if (options?.referenceImage) {
    const match = options.referenceImage.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
    }
  }

  const body = {
    contents: [
      {
        parts,
      },
    ],
    generationConfig: {
      responseModalities: ["Image"],
    },
  };

  const response = await fetch(
    baseUrl + "/models/" + modelId + ":generateContent",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": resolution.apiKey,
      },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    const error: any = new Error(
      "Google Gemini image API error (" + response.status + "): " + errorText
    );
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  const images: GeneratedImage[] = [];
  const candidates: any[] = data.candidates ?? [];
  for (const candidate of candidates) {
    const parts = candidate.content?.parts ?? [];
    for (const part of parts) {
      if (part.inlineData?.data && part.inlineData?.mimeType) {
        images.push({
          url: "data:" + part.inlineData.mimeType + ";base64," + part.inlineData.data,
          revisedPrompt: prompt,
        });
      }
    }
  }

  return images;
}
// generateVideo — Video generation (Runway, HeyGen, Pika)
// ============================================================================

export interface VideoGenerationResult {
  id: string;
  status: "processing" | "completed" | "failed";
  videoUrl?: string;
  estimatedSeconds?: number;
}

export async function generateVideo(
  tenantId: string,
  prompt: string,
  options?: {
    duration?: number;
    resolution?: string;
    clientId?: string;
  }
): Promise<VideoGenerationResult> {
  const resolution = await getModelForTask(tenantId, "video_generation", options?.clientId);

  // Route by provider name
  if (resolution.providerName === "Runway") {
    return callRunwayAPI(resolution, prompt, options);
  }
  if (resolution.providerName === "HeyGen") {
    return callHeyGenAPI(resolution, prompt, options);
  }
  if (resolution.providerName === "Pika") {
    return callPikaAPI(resolution, prompt, options);
  }
  if (resolution.providerName === "Alibaba Wan" || resolution.providerBaseUrl.includes("dashscope")) {
    return callWanAPI(resolution, prompt, options);
  }

  // Default to Runway-compatible
  return callRunwayAPI(resolution, prompt, options);
}

/**
 * Alibaba Cloud Model Studio (DashScope) async video generation — Wan 2.1/2.2.
 * Submits a task, polls until SUCCEEDED (or a timeout), and returns the
 * generated video URL when complete. Polling happens here so the media
 * pipeline gets a finished asset; generation usually takes 1–3 minutes.
 */
async function callWanAPI(
  resolution: ModelResolution,
  prompt: string,
  options?: { duration?: number }
): Promise<VideoGenerationResult> {
  const submitBody: Record<string, unknown> = {
    model: resolution.model,
    input: { prompt },
  };
  // Wan 2.1/2.2 flash accept a duration hint (5s default, max 5s for flash).
  const duration = Math.min(options?.duration ?? 5, 5);
  if (resolution.model.includes("flash")) {
    submitBody.parameters = { duration };
  }

  const submitRes = await fetch(`${resolution.providerBaseUrl}/services/aigc/video-generation/generation`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resolution.apiKey}`,
    },
    body: JSON.stringify(submitBody),
  });
  if (!submitRes.ok) {
    const errorText = await submitRes.text();
    const error: any = new Error(`Wan API error (${submitRes.status}): ${errorText}`);
    error.status = submitRes.status;
    throw error;
  }
  const submitData = await submitRes.json();
  const taskId = submitData.output?.task_id ?? submitData.task_id;
  if (!taskId) {
    throw new Error(`Wan API returned no task id: ${JSON.stringify(submitData)}`);
  }

  // Poll every 5s up to ~3 minutes.
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    const pollRes = await fetch(`${resolution.providerBaseUrl}/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${resolution.apiKey}` },
    });
    if (!pollRes.ok) continue;
    const pollData = await pollRes.json();
    const status = pollData.output?.task_status ?? pollData.status;
    if (status === "SUCCEEDED") {
      const results = pollData.output?.video_url
        ? [pollData.output.video_url]
        : (pollData.output?.results ?? []).map((r: any) => r.url);
      const videoUrl = Array.isArray(results) ? results[0] : results;
      if (videoUrl) {
        return { id: taskId, status: "completed", videoUrl, estimatedSeconds: duration };
      }
    } else if (status === "FAILED" || status === "CANCELED") {
      const msg = pollData.output?.message ?? pollData.message ?? "Unknown failure";
      const error: any = new Error(`Wan generation failed: ${msg}`);
      throw error;
    }
    // PENDING / RUNNING → keep polling
  }

  // Timed out — return processing so the media pipeline records the task id
  // and a later poll can pick it up.
  return { id: taskId, status: "processing", estimatedSeconds: duration };
}

async function callRunwayAPI(
  resolution: ModelResolution,
  prompt: string,
  _options?: { duration?: number }
): Promise<VideoGenerationResult> {
  const response = await fetch(`${resolution.providerBaseUrl}/text-to-video`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resolution.apiKey}`,
    },
    body: JSON.stringify({
      model: resolution.model,
      promptText: prompt,
      duration: _options?.duration ?? 5,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const error: any = new Error(`Runway API error (${response.status}): ${errorText}`);
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  return {
    id: data.id ?? `runway-${Date.now()}`,
    status: "processing",
    estimatedSeconds: _options?.duration ?? 5,
  };
}

async function callHeyGenAPI(
  resolution: ModelResolution,
  prompt: string,
  _options?: { duration?: number }
): Promise<VideoGenerationResult> {
  const response = await fetch(`${resolution.providerBaseUrl}/video/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": resolution.apiKey,
    },
    body: JSON.stringify({
      model: resolution.model,
      script: prompt,
      dimension: { width: 1920, height: 1080 },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const error: any = new Error(`HeyGen API error (${response.status}): ${errorText}`);
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  return {
    id: data.data?.video_id ?? `heygen-${Date.now()}`,
    status: "processing",
  };
}

async function callPikaAPI(
  resolution: ModelResolution,
  prompt: string,
  _options?: { duration?: number }
): Promise<VideoGenerationResult> {
  const response = await fetch(`${resolution.providerBaseUrl}/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resolution.apiKey}`,
    },
    body: JSON.stringify({
      model: resolution.model,
      prompt,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const error: any = new Error(`Pika API error (${response.status}): ${errorText}`);
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  return {
    id: data.id ?? `pika-${Date.now()}`,
    status: "processing",
  };
}

// ============================================================================
// generateVoice — Text-to-speech (ElevenLabs, Play.ht)
// ============================================================================

export interface VoiceResult {
  audioUrl: string;
  durationSeconds?: number;
  format?: string;
}

export async function generateVoice(
  tenantId: string,
  text: string,
  options?: {
    voiceId?: string;
    stability?: number;
    similarityBoost?: number;
    clientId?: string;
  }
): Promise<VoiceResult> {
  const resolution = await getModelForTask(tenantId, "voice_synthesis", options?.clientId);

  if (resolution.providerName === "ElevenLabs") {
    return callElevenLabsAPI(resolution, text, options);
  }
  if (resolution.providerName === "Play.ht") {
    return callPlayHTAPI(resolution, text, options);
  }

  // Default to ElevenLabs
  return callElevenLabsAPI(resolution, text, options);
}

async function callElevenLabsAPI(
  resolution: ModelResolution,
  text: string,
  options?: { voiceId?: string; stability?: number; similarityBoost?: number }
): Promise<VoiceResult> {
  const voiceId = options?.voiceId ?? "21m00Tcm4TlvDq8ikWAM"; // Default "Rachel" voice
  const modelId = resolution.model === "eleven-turbo-v2.5"
    ? "eleven_turbo_v2_5"
    : resolution.model === "eleven-flash-v2.5"
      ? "eleven_flash_v2_5"
      : "eleven_multilingual_v2";

  const url = `${resolution.providerBaseUrl}/text-to-speech/${voiceId}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": resolution.apiKey,
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: {
        stability: options?.stability ?? 0.5,
        similarity_boost: options?.similarityBoost ?? 0.75,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const error: any = new Error(`ElevenLabs API error (${response.status}): ${errorText}`);
    error.status = response.status;
    throw error;
  }

  // ElevenLabs returns audio/mpeg binary; convert to base64 data URL
  const arrayBuffer = await response.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  return {
    audioUrl: `data:audio/mpeg;base64,${base64}`,
    format: "mp3",
  };
}

async function callPlayHTAPI(
  resolution: ModelResolution,
  text: string,
  _options?: { voiceId?: string }
): Promise<VoiceResult> {
  const response = await fetch(`${resolution.providerBaseUrl}/tts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resolution.apiKey}`,
      "X-User-Id": process.env.PLAYHT_USER_ID ?? "",
    },
    body: JSON.stringify({
      model: resolution.model,
      text,
      voice: _options?.voiceId ?? "s3://voice-cloning-zero-shot/american-male-1",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const error: any = new Error(`Play.ht API error (${response.status}): ${errorText}`);
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  return {
    audioUrl: data.url ?? "",
    format: "mp3",
  };
}

// ============================================================================
// generateEmbeddings — Text embedding (OpenAI, Cohere, Voyage, Jina)
// ============================================================================

export interface EmbeddingResult {
  embeddings: number[][];
  model: string;
  usage?: { totalTokens: number };
}

export async function generateEmbeddings(
  tenantId: string,
  texts: string[],
  options?: {
    clientId?: string;
  }
): Promise<EmbeddingResult> {
  const resolution = await getModelForTask(tenantId, "embeddings", options?.clientId);

  if (resolution.providerName === "Cohere Embed") {
    return callCohereEmbedAPI(resolution, texts);
  }
  if (resolution.providerName === "Voyage AI") {
    return callVoyageEmbedAPI(resolution, texts);
  }
  if (resolution.providerName === "Jina AI") {
    return callJinaEmbedAPI(resolution, texts);
  }

  // Default: OpenAI-compatible embeddings endpoint
  return callOpenAIEmbedAPI(resolution, texts);
}

async function callOpenAIEmbedAPI(
  resolution: ModelResolution,
  texts: string[]
): Promise<EmbeddingResult> {
  const response = await fetch(`${resolution.providerBaseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resolution.apiKey}`,
    },
    body: JSON.stringify({
      model: resolution.model,
      input: texts,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const error: any = new Error(`Embedding API error (${response.status}): ${errorText}`);
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  return {
    embeddings: (data.data ?? []).map((item: any) => item.embedding),
    model: resolution.model,
    usage: data.usage ? { totalTokens: data.usage.total_tokens } : undefined,
  };
}

async function callCohereEmbedAPI(
  resolution: ModelResolution,
  texts: string[]
): Promise<EmbeddingResult> {
  const response = await fetch(`${resolution.providerBaseUrl}/embed`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resolution.apiKey}`,
    },
    body: JSON.stringify({
      model: resolution.model,
      texts,
      input_type: "search_document",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const error: any = new Error(`Cohere Embed API error (${response.status}): ${errorText}`);
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  return {
    embeddings: data.embeddings ?? [],
    model: resolution.model,
  };
}

async function callVoyageEmbedAPI(
  resolution: ModelResolution,
  texts: string[]
): Promise<EmbeddingResult> {
  const response = await fetch(`${resolution.providerBaseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resolution.apiKey}`,
    },
    body: JSON.stringify({
      model: resolution.model,
      input: texts,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const error: any = new Error(`Voyage API error (${response.status}): ${errorText}`);
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  return {
    embeddings: (data.data ?? []).map((item: any) => item.embedding),
    model: resolution.model,
    usage: data.usage ? { totalTokens: data.usage.total_tokens } : undefined,
  };
}

async function callJinaEmbedAPI(
  resolution: ModelResolution,
  texts: string[]
): Promise<EmbeddingResult> {
  const response = await fetch(`${resolution.providerBaseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resolution.apiKey}`,
    },
    body: JSON.stringify({
      model: resolution.model,
      input: texts,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const error: any = new Error(`Jina API error (${response.status}): ${errorText}`);
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  return {
    embeddings: (data.data ?? []).map((item: any) => item.embedding),
    model: resolution.model,
  };
}