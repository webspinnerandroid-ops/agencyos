import { z } from "zod";

export const generateContentSchema = z
  .object({
    clientId: z.string().uuid().optional(),
    // The user may supply a title, keywords/topics, or both — generation works
    // from whichever is given (research runs first either way).
    title: z.string().min(5, "Title must be at least 5 characters").optional(),
    topic: z.string().min(5, "Topic must be at least 5 characters").optional(),
    keywords: z.array(z.string().min(1)).optional(),
    brandVoice: z.string().optional(),
    // How many images to generate for the blog: 0 = none, 1 = featured only,
    // 2 = featured + 1 inline, 3 = featured + 2 inline.
    imageCount: z.number().int().min(0).max(3).optional(),
    // "To illustrate key points" mode: the model chooses where inline images
    // genuinely illustrate a key point (featured + up to 2 more). Wins over
    // imageCount when true.
    imageAuto: z.boolean().optional(),
    // Social-only generation (Content Map social rows): skips the blog post
    // entirely and writes one platform-native post per social platform from
    // the topic/keywords/brand voice.
    socialOnly: z.boolean().optional(),
    // Creative fiction mode — explicit per-row opt-in (Content Map mode
    // selector / CSV Mode column). Skips scoring, the SEO/AEO/GEO gate loop,
    // and linking/schema meta; still generates a full draft with images.
    // Absent/false = the scored gate pipeline, exactly as before.
    fiction: z.boolean().optional(),
    // Preferred external sources to cite (optional; up to 5). Empty/absent is
    // normal — the model then picks its own reputable sources. Internal links
    // are never provided here; they come from the workspace knowledge base.
    externalLinks: z
      .array(z.string().url())
      .max(5)
      .optional(),
    // Suggested publish date/time (ISO) — from the Content Map row or the
    // CSV's Publish Date column. Stored on the draft as a suggestion; the
    // draft still goes through the normal approval flow before publishing.
    // Optional — absent means "no suggested time".
    scheduledAt: z.string().datetime({ offset: true }).optional(),
    // User-uploaded images (already persisted to storage) that replace the
    // AI-generated ones. First entry is the featured image, the rest inline.
    uploadedImages: z
      .array(
        z.object({
          url: z.string().url(),
          placement: z.enum(["featured", "inline"]),
          description: z.string().optional(),
        })
      )
      .max(3)
      .optional(),
    // Social platforms are OPTIONAL — a blog-only generation (no social
    // captions) is a supported and common case, so an empty/absent list must
    // not fail validation. The blog post is always generated.
    platforms: z.array(z.string()).optional(),
    // Auto-publish target from the Content Map row (migration 104):
    // "wordpress" = after a gate-cleared blog generation, auto-approve the
    // draft and schedule it to the connected WordPress sites for the row's
    // publish date. Omitted/null = the draft stays draft (manual flow).
    autoPublish: z.enum(["wordpress"]).optional(),
    // JSON-LD schema types to generate with the post (Article is always
    // included). "auto" detects from the content (FAQPage from Q&A pairs,
    // HowTo/Recipe from numbered steps).
    // JSON-LD schema types to generate with the post (Article is always
    // included). "auto" detects from the content (FAQPage from Q&A pairs,
    // HowTo/Recipe from numbered steps). Everything above is OPTIONAL — when
    // no title/topic/keywords are given, the backend auto-selects a topic
    // from the questions people are asking (trends).
    schemaTypes: z
      .union([
        z.array(
          z.enum([
            "Article",
            "FAQPage",
            "HowTo",
            "Recipe",
            "Product",
            "Service",
            "Organization",
            "LocalBusiness",
            "Event",
            "Course",
            "SoftwareApplication",
            "VideoObject",
            "Person",
          ])
        ),
        z.literal("auto"),
      ])
      .optional(),
  });

export type GenerateContentInput = z.infer<typeof generateContentSchema>;

// ---------------------------------------------------------------------------
// Clients (create). Adopted by POST /api/clients via parseJsonBody.
// ---------------------------------------------------------------------------

export const clientCreateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Client name must be at least 2 characters")
    .max(120, "Client name must be 120 characters or fewer"),
  // Empty string is how the UI represents "no website" — accept it rather than
  // rejecting the form. A bare host ("acme.com", the placeholder in the UI) is
  // accepted too and stored as typed: the field is a reference, not a link
  // target, and tightening it here would reject input the product invites.
  website: z
    .string()
    .trim()
    .max(2000, "Website must be 2000 characters or fewer")
    .refine(
      (v) =>
        v === "" ||
        /^https?:\/\/\S+$/i.test(v) ||
        /^[a-z0-9.-]+\.[a-z]{2,}(\/\S*)?$/i.test(v),
      "Website must be a URL or a domain like acme.com"
    )
    .optional()
    .nullable(),
  notes: z.string().max(4000, "Notes must be 4000 characters or fewer").optional().nullable(),
});

export type ClientCreateInput = z.infer<typeof clientCreateSchema>;

// ---------------------------------------------------------------------------
// Posts (update). Adopted by PATCH /api/posts/[id].
//
// Every field is optional, but at least one update (or the cancel action) must
// be present — an empty PATCH would otherwise be a silent no-op 200.
// ---------------------------------------------------------------------------

export const POST_STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "revision_requested",
  "scheduled",
  "published",
  "failed",
] as const;

export const postUpdateSchema = z
  .object({
    action: z.literal("cancel_auto_publish").optional(),
    status: z.enum(POST_STATUSES).optional(),
    // Null = unschedule. Offset-qualified ISO required (the client sends UTC).
    scheduled_at: z.string().datetime({ offset: true }).nullable().optional(),
    workspace_id: z.string().uuid().nullable().optional(),
    revision_reason: z
      .string()
      .trim()
      .min(1, "A revision reason is required")
      .max(2000)
      .optional(),
  })
  .refine(
    (v) =>
      v.action !== undefined ||
      v.status !== undefined ||
      v.scheduled_at !== undefined ||
      v.workspace_id !== undefined ||
      v.revision_reason !== undefined,
    {
      message:
        "scheduled_at, status, workspace_id, or revision_reason is required",
    }
  );

export type PostUpdateInput = z.infer<typeof postUpdateSchema>;

// ---------------------------------------------------------------------------
// Content map (row patch). Adopted by PATCH /api/content-map/[id].
//
// The row patch is polymorphic, mirroring the route's three branches:
//   1. Inline row edit      — any of title/topic/keywords/mode (no action)
//   2. Schedule a row       — scheduledAt (string or null; no action)
//   3. Action               — action: cancel_auto_publish | link | dismiss | restore
// Every field is optional, but at least one recognized field must be present:
// an empty PATCH would otherwise be a silent no-op.
// ---------------------------------------------------------------------------

export const contentMapRowPatchSchema = z
  .object({
    action: z
      .enum(["cancel_auto_publish", "link", "dismiss", "restore"])
      .optional(),
    // Recorded when the generated post is linked to the row.
    postId: z.string().uuid().optional(),
    gate: z.unknown().optional(),
    // Legacy companions the UI used to send with `link`; unused by the route
    // but accepted so older clients keep working.
    seo: z.unknown().optional(),
    aeoGeo: z.unknown().optional(),
    // Row's planned publish slot. Kept lenient here (any non-empty string or
    // null) — the route converts it to ISO and 400s otherwise, preserving the
    // existing datetime-local payloads.
    scheduledAt: z
      .string()
      .min(1, "scheduledAt must be an ISO datetime or null")
      .nullable()
      .optional(),
    // Inline row edit fields (mirror the import caps applied in the route).
    title: z.string().max(1200, "Title must be 1200 characters or fewer").optional(),
    topic: z.string().max(5000, "Topic must be 5000 characters or fewer").optional(),
    keywords: z.array(z.string()).max(24).optional(),
    // Generation mode, case-insensitive in transit ("Gate" → "gate").
    mode: z.preprocess(
      (m) => (typeof m === "string" ? m.toLowerCase() : m),
      z.enum(["gate", "fiction"]).optional()
    ),
  })
  .refine(
    (v) =>
      v.action !== undefined ||
      v.scheduledAt !== undefined ||
      v.title !== undefined ||
      v.topic !== undefined ||
      v.keywords !== undefined ||
      v.mode !== undefined,
    {
      message:
        "Provide an action, a scheduledAt, or inline row fields (title, topic, keywords, mode)",
    }
  );

export type ContentMapRowPatchInput = z.infer<typeof contentMapRowPatchSchema>;

// ---------------------------------------------------------------------------
// Content map (batch runner). Adopted by POST /api/content-map/batch.
// ---------------------------------------------------------------------------

export const contentMapBatchSchema = z.object({
  action: z.enum(["start", "stop", "status"]),
  clientId: z.string().uuid().nullable().optional(),
  brandVoice: z.string().max(4000).nullable().optional(),
  imagePref: z
    .union([z.number().int().min(0).max(3), z.literal("auto")])
    .optional(),
  /** Per-row generation: only these item ids (must be planned). */
  itemIds: z.array(z.string().uuid()).max(200).optional(),
});

export type ContentMapBatchInput = z.infer<typeof contentMapBatchSchema>;

// ---------------------------------------------------------------------------
// Content map (site upload). Adopted by POST /api/content-map/site.
// The route normalizes the URL itself (bare hosts like "example.com" are a
// supported input shape), so the schema only enforces shape and length.
// ---------------------------------------------------------------------------

export const contentMapSiteSchema = z.object({
  url: z
    .string()
    .min(1, "Provide the site's URL")
    .max(2000, "URL must be 2000 characters or fewer"),
});

export type ContentMapSiteInput = z.infer<typeof contentMapSiteSchema>;

// ---------------------------------------------------------------------------
// Asset folders. Adopted by POST /api/assets/folders and
// PATCH /api/assets/folders/[id].
// ---------------------------------------------------------------------------

export const ASSET_FOLDER_KINDS = [
  "image",
  "video",
  "voice",
  "brand",
  "content",
] as const;

export const assetFolderCreateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Folder name is required")
    .max(120, "Folder name must be 120 characters or fewer"),
  kind: z.enum(ASSET_FOLDER_KINDS).default("image"),
});

export type AssetFolderCreateInput = z.infer<typeof assetFolderCreateSchema>;

export const assetFolderRenameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Folder name is required")
    .max(120, "Folder name must be 120 characters or fewer"),
});

export type AssetFolderRenameInput = z.infer<typeof assetFolderRenameSchema>;

// ---------------------------------------------------------------------------
// Notifications — /api/notifications (mark read / delete) and
// /api/notifications/read-link.
//
// These routes keep a legacy contract: the bell's "mark all" action may fire
// with no body at all (the route treats an absent body as mark-all), and both
// handlers otherwise destructure loose shapes. The schemas below tighten the
// accepted TYPES (garbage ids/link values are now field-level 400s instead of
// silently behaving as mark-all/no-op) while the routes use
// parseJsonBody(..., { emptyAsEmptyObject: true }) to preserve the absent-body
// behavior exactly.
// ---------------------------------------------------------------------------

/** POST /api/notifications — either { all: true } or { ids: [uuid, ...] }. */
export const notificationsMarkReadSchema = z.object({
  all: z.boolean().optional(),
  ids: z.array(z.string().uuid()).optional(),
});

export type NotificationsMarkReadInput = z.infer<
  typeof notificationsMarkReadSchema
>;

/** DELETE /api/notifications — { ids: [uuid, ...] }. Absent/empty = no-op. */
export const notificationsDeleteSchema = z.object({
  ids: z.array(z.string().uuid()).optional(),
});

export type NotificationsDeleteInput = z.infer<
  typeof notificationsDeleteSchema
>;

/**
 * POST /api/notifications/read-link — { link?: string }. The client sends the
 * pathname it opened; an absent link is a no-op, not an error.
 */
export const notificationsReadLinkSchema = z.object({
  link: z.string().max(2048).optional(),
});

export type NotificationsReadLinkInput = z.infer<
  typeof notificationsReadLinkSchema
>;