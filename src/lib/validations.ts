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

// ---------------------------------------------------------------------------
// Posts — rescore & regenerate. Adopted by POST /api/posts/[id]/aeo-geo and
// POST /api/posts/[id]/regenerate.
//
// Both handlers legitimately fire with NO body (the detail modal's plain
// "re-score" and the calendar's plain "regenerate"), so the routes adopt
// validation with parseJsonBody(..., { emptyAsEmptyObject: true }) — the
// absent-body courtesy, identical shapes-validation to every other family.
// ---------------------------------------------------------------------------

/** POST /api/posts/[id]/aeo-geo — { deep?: true } runs the LLM-assisted pass. */
export const postAeoGeoSchema = z.object({
  deep: z.boolean().optional(),
});

export type PostAeoGeoInput = z.infer<typeof postAeoGeoSchema>;

/**
 * POST /api/posts/[id]/regenerate — { feedback?: string } guides the rewrite.
 * The caller already sends the trimmed string (or omits the field entirely for
 * a plain regenerate), so the schema only enforces type and size; the route
 * keeps its "blank feedback = plain regenerate" rule.
 */
export const postRegenerateSchema = z.object({
  feedback: z
    .string()
    .max(2000, "Feedback must be 2000 characters or fewer")
    .optional(),
});

export type PostRegenerateInput = z.infer<typeof postRegenerateSchema>;

// ---------------------------------------------------------------------------
// Publish routes. Adopted by POST /api/publish (saved posts) and
// POST /api/publish/generated (the generate page's connected-sites dialog).
// ---------------------------------------------------------------------------

/**
 * Every platform POST /api/publish dispatches on. Unknown platforms were
 * already a 400 ("Unknown platform"), so an enum here preserves the contract
 * while rejecting the whole body at validation time instead of branch time.
 */
export const PUBLISH_PLATFORMS = [
  "all",
  "blog",
  "cms",
  "site_blog",
  "connected_sites",
  "wordpress",
  "instagram",
  "twitter",
  "linkedin",
  "facebook",
  "tiktok",
  "threads",
] as const;

/**
 * A per-site target of the connected-sites dialogs
 * (ConnectedSitesPublishDialog.tsx SitePublishTarget, mirrored in the
 * publisher's GeneratedContentTarget). Recorded for overwrite mode — number
 * for WordPress ids, string for Ghost/Webflow/built-in-CMS ids; the
 * mode/kind/whichever-object consistency is enforced by the publisher, not
 * here.
 */
export const publishTargetSchema = z.object({
  blogPlatformId: z
    .string()
    .min(1, "blogPlatformId is required for every target"),
  mode: z.enum(["create", "overwrite"]),
  kind: z.enum(["post", "page"]),
  wpPostId: z.union([z.number().int(), z.string().min(1)]).optional(),
  includeImages: z.boolean().optional(),
  categoryId: z.union([z.number().int(), z.string().min(1)]).optional(),
});

export type PublishTargetInput = z.infer<typeof publishTargetSchema>;

/** The generated-content shape the generate page posts alongside targets. */
// The `error` option (zod v4) puts the friendly message on the MISSING-field
// case too — a min(1, ...) message only fires for an empty string, and the
// default "expected string, received undefined" tells the operator nothing.
export const generatedContentPayloadSchema = z.object({
  title: z
    .string({ error: "Generated content is missing a title." })
    .trim()
    .min(1, "Generated content is missing a title."),
  body: z
    .string({ error: "Generated content is missing a body." })
    .min(1, "Generated content is missing a body."),
  slug: z.string().optional(),
  metaDescription: z.string().optional(),
  seoMeta: z
    .record(z.string(), z.union([z.string(), z.array(z.string())]))
    .optional(),
  images: z
    .array(
      z.object({
        url: z.string().url(),
        alt: z.string().optional(),
        placement: z.enum(["featured", "inline"]).optional(),
        description: z.string().optional(),
      })
    )
    .optional(),
});

export type GeneratedContentPayloadInput = z.infer<
  typeof generatedContentPayloadSchema
>;

/** POST /api/publish/generated — publish a not-yet-saved generated post. */
export const publishGeneratedSchema = z.object({
  targets: z
    .array(publishTargetSchema)
    .min(1, "Select at least one connected site to publish to."),
  content: generatedContentPayloadSchema,
});

export type PublishGeneratedInput = z.infer<typeof publishGeneratedSchema>;

/**
 * POST /api/publish — publish or schedule a SAVED post across platforms.
 *
 * scheduledAt stays shape-only (string wall-clock or epoch number): the
 * datetime-local value plus the browser's tzOffsetMinutes is interpreted by
 * normalizeScheduledAt in src/lib/scheduling.ts, which remains the authority
 * on what a valid slot means. The same applies to categoryId (WordPress's own
 * id type from PublishButton).
 */
export const publishBodySchema = z.object({
  postId: z.string().uuid("postId must be a valid post id"),
  platform: z.enum(PUBLISH_PLATFORMS),
  action: z.enum(["publish", "schedule", "draft"]).optional(),
  scheduledAt: z.union([z.string(), z.number()]).nullable().optional(),
  categoryId: z.union([z.string(), z.number()]).nullable().optional(),
  // Publish-gate override (super admin owns the final call).
  force: z.boolean().optional(),
  tzOffsetMinutes: z.number().int().min(-840).max(840).optional(),
  // connected_sites branch only — the dialog's per-site targets.
  targets: z.array(publishTargetSchema).optional(),
});

export type PublishBodyInput = z.infer<typeof publishBodySchema>;

// ---------------------------------------------------------------------------
// Lead sequences. Adopted by POST /api/sequences, PATCH /api/sequences/[id],
// and POST /api/sequences/[id]/enroll.
//
// A step mirrors the SequenceStep the automation consumes
// (src/lib/leads/cipher.ts processSequenceStep): a channel (previously an
// unknown channel meant the step silently did nothing but still advanced the
// enrollment), a delay, and a template body. The enrollment future-proofing
// stays in the route: an absent delay_days still defaults to 0.
// ---------------------------------------------------------------------------

export const sequenceStepSchema = z.object({
  channel: z.enum(["email", "sms"]),
  delay_days: z
    .number()
    .int()
    .min(0, "delay_days cannot be negative")
    .max(365, "delay_days must be a year or less")
    .optional(),
  subject: z.string().max(500, "Subject must be 500 characters or fewer").optional(),
  body_template: z
    .string()
    .min(1, "Every step needs a message template")
    .max(10_000, "Message template must be 10,000 characters or fewer"),
});

export type SequenceStepInput = z.infer<typeof sequenceStepSchema>;

export const sequenceCreateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "name is required")
    .max(120, "Name must be 120 characters or fewer"),
  description: z.string().max(2000, "Description must be 2000 characters or fewer").nullable().optional(),
  steps: z.array(sequenceStepSchema).max(50, "A sequence can have at most 50 steps"),
  isActive: z.boolean().optional(),
});

export type SequenceCreateInput = z.infer<typeof sequenceCreateSchema>;

// Every field is optional, but at least one must be present — an empty PATCH
// would otherwise be a silent no-op 200 (same rule as postUpdateSchema).
export const sequenceUpdateSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "name cannot be empty")
      .max(120, "Name must be 120 characters or fewer")
      .optional(),
    description: z.string().max(2000, "Description must be 2000 characters or fewer").nullable().optional(),
    steps: z.array(sequenceStepSchema).max(50, "A sequence can have at most 50 steps").optional(),
    isActive: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.description !== undefined ||
      v.steps !== undefined ||
      v.isActive !== undefined,
    {
      message: "Provide at least one of name, description, steps, isActive",
    }
  );

export type SequenceUpdateInput = z.infer<typeof sequenceUpdateSchema>;

/** POST /api/sequences/[id]/enroll — { leadId }. */
export const sequenceEnrollSchema = z.object({
  leadId: z.string().uuid("leadId must be a valid lead id"),
});

export type SequenceEnrollInput = z.infer<typeof sequenceEnrollSchema>;

// ---------------------------------------------------------------------------
// Auth token requests. Adopted by POST /api/auth/2fa/verify,
// POST /api/auth/2fa/disable, and POST /api/auth/resend-confirmation.
//
// The 6-digit TOTP format (and the friendly message for a malformed one) moves
// into the schema; the routes keep only their real decisions — verifying the
// code against the stored/pending secret, or resending a confirmation. The
// same fields the login page, the settings page and mailto flows send stay
// valid exactly as before.
// ---------------------------------------------------------------------------

export const authTotpVerifySchema = z.object({
  code: z
    .string({ error: "Enter the 6-digit code from your authenticator app." })
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app."),
  // Present only in setup mode (the settings page's enroll step); login sends
  // { code } alone and stays in login mode.
  secret: z
    .string({ error: "secret must be a string" })
    .trim()
    .min(16, "The pending secret looks too short")
    .max(200, "The pending secret looks too long")
    .optional(),
});

export type AuthTotpVerifyInput = z.infer<typeof authTotpVerifySchema>;

export const authTotpDisableSchema = z.object({
  code: z
    .string({ error: "Enter the 6-digit code from your authenticator app." })
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app."),
});

export type AuthTotpDisableInput = z.infer<typeof authTotpDisableSchema>;

export const authResendConfirmationSchema = z.object({
  email: z
    .string({ error: "A valid email is required" })
    .trim()
    .toLowerCase()
    .max(320, "Email address is too long")
    .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "A valid email is required"),
});

export type AuthResendConfirmationInput = z.infer<
  typeof authResendConfirmationSchema
>;

// ---------------------------------------------------------------------------
// Media assets (reassign / duplicate). Adopted by PATCH /api/media-assets/[id]
// and POST /api/media-assets/[id]/duplicate.
//
// The bodies are tiny (a workspace and/or folder reference), so the schema's
// job is just to make the references typed ids instead of any JSON the
// destructuring would take. "Move to workspace" sends { workspaceId },
// "move to folder" sends { folderId } — at least one is required, the
// refine keeps an empty PATCH from being a silent no-op 200.
// ---------------------------------------------------------------------------

const workspaceIdField = z.string().uuid("workspaceId must be a valid workspace id");

export const mediaAssetReassignSchema = z
  .object({
    workspaceId: workspaceIdField.optional(),
    // A non-empty id files the asset into that folder; "" or null is the
    // assets page's "unfiled" move — keep accepting both (the route maps ""
    // to a null folder_id, same as before).
    folderId: z
      .union([
        z.string().uuid("folderId must be a valid folder id"),
        z.literal(""),
        z.null(),
      ])
      .optional(),
  })
  .refine(
    (v) => v.workspaceId !== undefined || v.folderId !== undefined,
    {
      message: "Provide a workspaceId and/or folderId to update",
    }
  );

export type MediaAssetReassignInput = z.infer<typeof mediaAssetReassignSchema>;

export const mediaAssetDuplicateSchema = z.object({
  workspaceId: workspaceIdField,
});

export type MediaAssetDuplicateInput = z.infer<typeof mediaAssetDuplicateSchema>;

// ---------------------------------------------------------------------------
// Scheduled-failure resolution. Adopted by POST /api/scheduled/resolve.
// ---------------------------------------------------------------------------

/**
 * The Scheduled panel's two human decisions on a persistent publish failure:
 *   { postId, action: "retry" }           → fresh publish attempt now
 *   { postId, action: "dismiss", reason } → "won't fix"; reason required
 *
 * postId becomes a typed uuid (a garbage id used to fall through to the
 * lookup and answer "Post not found"); the dismiss-requires-reason rule moves
 * into the schema with the exact message the panel shows.
 */
export const scheduledResolveSchema = z
  .object({
    postId: z.string().uuid("postId must be a valid post id"),
    action: z.enum(["retry", "dismiss"]),
    reason: z
      .string()
      .trim()
      .max(500, "Reason must be 500 characters or fewer")
      .optional(),
  })
  .refine(
    (v) => v.action !== "dismiss" || (v.reason?.length ?? 0) > 0,
    { message: "A reason is required to dismiss a failure." }
  );

export type ScheduledResolveInput = z.infer<typeof scheduledResolveSchema>;

// ---------------------------------------------------------------------------
// Browser push subscriptions. Adopted by POST/DELETE /api/push/subscribe.
//
// The subscription's real shape comes from the Push API:
// { endpoint: https URL, keys: { p256dh, auth } }. The schemas type exactly
// that (the PushMessageEncryption keys are web-push writers need), replacing
// the old all-or-nothing truthiness check with field-level 400s.
// ---------------------------------------------------------------------------

export const pushSubscribeSchema = z.object({
  endpoint: z
    .string({ error: "endpoint must be an https URL" })
    .trim()
    .max(2048, "endpoint must be 2048 characters or fewer")
    .regex(/^https:\/\//, "endpoint must be an https URL"),
  keys: z.object({
    p256dh: z
      .string({ error: "p256dh (base64url) is required" })
      .trim()
      .min(1, "p256dh (base64url) is required")
      .max(512, "p256dh must be 512 characters or fewer"),
    auth: z
      .string({ error: "auth (base64url) is required" })
      .trim()
      .min(1, "auth (base64url) is required")
      .max(512, "auth must be 512 characters or fewer"),
  }),
});

export type PushSubscribeInput = z.infer<typeof pushSubscribeSchema>;

export const pushUnsubscribeSchema = z.object({
  endpoint: z
    .string({ error: "endpoint is required" })
    .trim()
    .min(1, "endpoint is required")
    .max(2048, "endpoint must be 2048 characters or fewer"),
});

export type PushUnsubscribeInput = z.infer<typeof pushUnsubscribeSchema>;

// ---------------------------------------------------------------------------
// Leads (Cipher CRM). Adopted by the 4 body-reading routes of the leads
// family — POST /api/leads, PATCH /api/leads/[id], the email/sms senders,
// and the Apollo importer. GET/DELETE and /api/leads/[id]/enrich take no
// body and are out of scope.
//
// The lib's own types (src/lib/leads/cipher.ts) are its real contract and
// the DB enums come from the CHECK constraints in migration 011 — both are
// encoded below. The leads routes have no in-repo UI callers, so strict
// unknown-key rejection (supabase JS silently ignores garbage keys like
// polyglot-object fields) costs nothing. Note deliberately omitted:
// `assignedTo` — updateLead's type accepts it but the DB update never
// applies it; rejecting it here makes that silent ignore loud instead.
// ---------------------------------------------------------------------------

export const LEAD_STATUSES = [
  "new",
  "contacted",
  "qualified",
  "proposal_sent",
  "closed_won",
  "closed_lost",
  "unqualified",
] as const;

export const LEAD_SOURCES = ["apollo", "referral", "website", "manual", "csv_import"] as const;

/** Shared contact-detail fields for create and update. All optional — */
/** createLead/updateLead accept a partial (lib contract), not a full row. */
const leadContactFields = {
  email: z
    .string()
    .max(320, "email must be 320 characters or fewer")
    .email("email must be a valid email address")
    .optional(),
  firstName: z.string().max(120, "firstName must be 120 characters or fewer").optional(),
  lastName: z.string().max(120, "lastName must be 120 characters or fewer").optional(),
  company: z.string().max(200, "company must be 200 characters or fewer").optional(),
  title: z.string().max(200, "title must be 200 characters or fewer").optional(),
  phone: z.string().max(40, "phone must be 40 characters or fewer").optional(),
  linkedinUrl: z
    .string()
    .max(500, "linkedinUrl must be 500 characters or fewer")
    .url("linkedinUrl must be a valid URL")
    .optional(),
} as const;

export const leadCreateSchema = z.strictObject({
  ...leadContactFields,
  status: z.enum(LEAD_STATUSES).optional(),
  source: z.enum(LEAD_SOURCES).optional(),
  clientId: z.string().uuid("clientId must be a valid client id").optional(),
  notes: z.string().max(4000, "notes must be 4000 characters or fewer").optional(),
});

export type LeadCreateInput = z.infer<typeof leadCreateSchema>;

export const leadUpdateSchema = z
  .strictObject({
    ...leadContactFields,
    status: z.enum(LEAD_STATUSES).optional(),
    clientId: z.string().uuid("clientId must be a valid client id").optional(),
    notes: z.string().max(4000, "notes must be 4000 characters or fewer").optional(),
  })
  .refine(
    (v) => Object.keys(v).length > 0,
    {
      message:
        "Provide at least one of email, firstName, lastName, company, title, phone, linkedinUrl, status, notes, clientId to update",
    }
  );

export type LeadUpdateInput = z.infer<typeof leadUpdateSchema>;

export const leadEmailSchema = z.strictObject({
  subject: z
    .string()
    .min(1, "subject is required")
    .max(500, "subject must be 500 characters or fewer"),
  body: z
    .string()
    .min(1, "body is required")
    .max(20000, "body must be 20000 characters or fewer"),
});

export type LeadEmailInput = z.infer<typeof leadEmailSchema>;

export const leadSmsSchema = z.strictObject({
  body: z
    .string()
    .min(1, "body is required")
    .max(1600, "body must be 1600 characters or fewer (Twilio SMS limit)"),
});

export type LeadSmsInput = z.infer<typeof leadSmsSchema>;

export const leadApolloImportSchema = z
  .strictObject({
    q_organization_name: z.string().max(200, "q_organization_name must be 200 characters or fewer").optional(),
    q_title: z.string().max(200, "q_title must be 200 characters or fewer").optional(),
    q_keywords: z.string().max(300, "q_keywords must be 300 characters or fewer").optional(),
    page: z
      .number()
      .int("page must be an integer")
      .min(1, "page must be 1 or greater")
      .max(100, "page must be 100 or fewer")
      .optional(),
    per_page: z
      .number()
      .int("per_page must be an integer")
      .min(1, "per_page must be 1 or greater")
      .max(100, "per_page must be 100 or fewer")
      .optional(),
  })
  .refine(
    (v) => Boolean(v.q_organization_name || v.q_title || v.q_keywords),
    {
      message:
        "At least one search parameter is required (q_organization_name, q_title, or q_keywords)",
    }
  );

export type LeadApolloImportInput = z.infer<typeof leadApolloImportSchema>;

// ---------------------------------------------------------------------------
// Campaign plans. Adopted by the three write routes of the family —
// POST /api/campaign-plans (approve a proposed item),
// POST /api/campaign-plans/refine ("Refine with Malory") and
// POST /api/campaign-plans/from-proposal (materialize a sold tier).
//
// The DB ids are uuids for all three callers, so garbage ids are field-level
// 400s instead of falling through to a not-found lookup; mediaKind rejects
// non-image/video values instead of silently approving them as images.
// ---------------------------------------------------------------------------

export const campaignItemApproveSchema = z.strictObject({
  itemId: z.string().uuid("itemId must be a valid campaign item id"),
  mediaKind: z.enum(["video", "image"]).optional(),
});

export type CampaignItemApproveInput = z.infer<typeof campaignItemApproveSchema>;

export const campaignRefineSchema = z.strictObject({
  planId: z.string().uuid("planId must be a valid campaign plan id"),
});

export type CampaignRefineInput = z.infer<typeof campaignRefineSchema>;

export const campaignFromProposalSchema = z.strictObject({
  campaignId: z
    .string()
    .uuid("campaignId must be a valid proposal (SEO campaign) id"),
  workspaceId: z
    .string()
    .uuid("workspaceId must be a valid workspace id")
    .optional(),
  createWorkspace: z.boolean().optional(),
  includeWebsite: z.boolean().optional(),
});

export type CampaignFromProposalInput = z.infer<typeof campaignFromProposalSchema>;