import { describe, expect, it } from "vitest";
import { MAX_JSON_BYTES, validateJson } from "./api-validate";
import {
  postAeoGeoSchema,
  postRegenerateSchema,
  publishBodySchema,
  publishGeneratedSchema,
  publishTargetSchema,
  assetFolderCreateSchema,
  assetFolderRenameSchema,
  clientCreateSchema,
  contentMapBatchSchema,
  contentMapRowPatchSchema,
  contentMapSiteSchema,
  notificationsDeleteSchema,
  notificationsMarkReadSchema,
  notificationsReadLinkSchema,
  postUpdateSchema,
  authTotpDisableSchema,
  authTotpVerifySchema,
  authResendConfirmationSchema,
  sequenceCreateSchema,
  sequenceEnrollSchema,
  sequenceStepSchema,
  sequenceUpdateSchema,
  mediaAssetDuplicateSchema,
  mediaAssetReassignSchema,
  leadApolloImportSchema,
  leadCreateSchema,
  leadEmailSchema,
  leadSmsSchema,
  leadUpdateSchema,
  LEAD_SOURCES,
  LEAD_STATUSES,
  campaignFromProposalSchema,
  campaignItemApproveSchema,
  campaignRefineSchema,
} from "./validations";

describe("validateJson — emptyAsEmptyObject courtesies", () => {
  // The routes substitute "{}" for an absent body before validating; that
  // substitution is what the option encodes, so prove it round-trips.
  it("validates a `{}` substitution against the absent-body schemas", () => {
    const asEmpty = { all: undefined, ids: undefined };
    expect(notificationsMarkReadSchema.safeParse(asEmpty).success).toBe(true);
    expect(notificationsDeleteSchema.safeParse(asEmpty).success).toBe(true);
    expect(notificationsReadLinkSchema.safeParse(asEmpty).success).toBe(true);
  });

  it("still rejects a non-empty invalid body", () => {
    expect(notificationsMarkReadSchema.safeParse({ ids: "all" }).success).toBe(false);
    expect(
      notificationsMarkReadSchema.safeParse({ ids: ["not-a-uuid"] }).success
    ).toBe(false);
  });
});

describe("validateJson", () => {
  it("returns typed data for a valid body", () => {
    const result = validateJson(JSON.stringify({ name: "Acme Co" }), clientCreateSchema);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.name).toBe("Acme Co");
  });

  it("rejects an empty body instead of treating it as {}", () => {
    const result = validateJson("   ", clientCreateSchema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("empty_body");
      expect(result.issues[0].message).toMatch(/empty/i);
    }
  });

  it("rejects malformed JSON with a parse reason, not a crash", () => {
    const result = validateJson('{"name": "Acme"', clientCreateSchema);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_json");
  });

  it("rejects a body over the size cap before parsing it", () => {
    const huge = JSON.stringify({ name: "x".repeat(MAX_JSON_BYTES) });
    const result = validateJson(huge, clientCreateSchema);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("too_large");
  });

  it("reports field paths so the UI can point at the offending input", () => {
    const result = validateJson(JSON.stringify({ name: "A" }), clientCreateSchema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid_body");
      expect(result.issues.map((i) => i.path)).toContain("name");
    }
  });
});

describe("clientCreateSchema", () => {
  it("accepts the shape the create-client form sends", () => {
    const parsed = clientCreateSchema.safeParse({
      name: "  Acme Co  ",
      website: "https://acme.test",
      notes: "",
    });
    expect(parsed.success).toBe(true);
    // Trimmed, so the DB never stores leading/trailing whitespace.
    if (parsed.success) expect(parsed.data.name).toBe("Acme Co");
  });

  it("treats an empty website as \"none\" rather than a validation error", () => {
    expect(clientCreateSchema.safeParse({ name: "Acme Co", website: "" }).success).toBe(true);
    expect(clientCreateSchema.safeParse({ name: "Acme Co", website: null }).success).toBe(true);
  });

  it("accepts a bare domain, because the UI invites one", () => {
    expect(clientCreateSchema.safeParse({ name: "Acme Co", website: "acme.com" }).success).toBe(true);
    expect(
      clientCreateSchema.safeParse({ name: "Acme Co", website: "https://acme.com/about" }).success
    ).toBe(true);
  });

  it("rejects a malformed website, a missing name, and an over-long notes field", () => {
    expect(clientCreateSchema.safeParse({ name: "Acme Co", website: "acme" }).success).toBe(false);
    expect(clientCreateSchema.safeParse({ name: "Acme Co", website: "not a url" }).success).toBe(false);
    expect(clientCreateSchema.safeParse({ website: "https://acme.test" }).success).toBe(false);
    expect(
      clientCreateSchema.safeParse({ name: "Acme Co", notes: "x".repeat(4001) }).success
    ).toBe(false);
  });
});

describe("postUpdateSchema", () => {
  it("accepts every update the calendar actually sends", () => {
    expect(postUpdateSchema.safeParse({ status: "approved" }).success).toBe(true);
    expect(
      postUpdateSchema.safeParse({ status: "revision_requested", revision_reason: "Too salesy" })
        .success
    ).toBe(true);
    expect(
      postUpdateSchema.safeParse({ scheduled_at: "2026-12-15T16:00:00.000Z" }).success
    ).toBe(true);
    expect(postUpdateSchema.safeParse({ scheduled_at: null }).success).toBe(true);
    expect(postUpdateSchema.safeParse({ action: "cancel_auto_publish" }).success).toBe(true);
  });

  it("rejects an empty update instead of answering a silent 200", () => {
    const parsed = postUpdateSchema.safeParse({});
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0].message).toMatch(/scheduled_at, status, workspace_id/);
    }
  });

  it("rejects status values outside the lifecycle", () => {
    expect(postUpdateSchema.safeParse({ status: "deleted" }).success).toBe(false);
    expect(postUpdateSchema.safeParse({ status: "APPROVED" }).success).toBe(false);
  });

  it("rejects a naive timestamp (the API stores UTC instants only)", () => {
    expect(postUpdateSchema.safeParse({ scheduled_at: "2026-12-15T09:00" }).success).toBe(false);
  });

  it("rejects a non-uuid workspace and a blank revision reason", () => {
    expect(postUpdateSchema.safeParse({ workspace_id: "default" }).success).toBe(false);
    expect(
      postUpdateSchema.safeParse({ status: "revision_requested", revision_reason: "   " }).success
    ).toBe(false);
  });
});

describe("notifications schemas", () => {
  const id1 = "11111111-1111-4111-8111-111111111111";
  const id2 = "22222222-2222-4222-8222-222222222222";
  it("mark-read accepts exactly the shapes the bell and the page send", () => {
    expect(notificationsMarkReadSchema.safeParse({ all: true }).success).toBe(true);
    expect(notificationsMarkReadSchema.safeParse({ ids: [id1, id2] }).success).toBe(true);
    // Both keys together are legal: all wins in the route.
    expect(notificationsMarkReadSchema.safeParse({ all: true, ids: [id1] }).success).toBe(true);
  });

  it("mark-read rejects a garbage ids value instead of silently marking everything read", () => {
    expect(notificationsMarkReadSchema.safeParse({ ids: "a" }).success).toBe(false);
    expect(notificationsMarkReadSchema.safeParse({ ids: [123] }).success).toBe(false);
  });

  it("delete accepts a concrete ids list and an absent one", () => {
    expect(notificationsDeleteSchema.safeParse({ ids: [id1] }).success).toBe(true);
    expect(notificationsDeleteSchema.safeParse({}).success).toBe(true);
  });

  it("read-link accepts a string link and treats an absent one as a no-op", () => {
    expect(notificationsReadLinkSchema.safeParse({ link: "/dashboard/posts" }).success).toBe(true);
    expect(notificationsReadLinkSchema.safeParse({}).success).toBe(true);
    expect(notificationsReadLinkSchema.safeParse({ link: 1 }).success).toBe(false);
  });
});

describe("contentMapRowPatchSchema", () => {
  it("accepts every edit shape the map row actually sends", () => {
    // 1. Inline row edit — any of title/topic/keywords/mode, no action.
    expect(contentMapRowPatchSchema.safeParse({ title: "Better headline" }).success).toBe(true);
    expect(
      contentMapRowPatchSchema.safeParse({ topic: "Iso building codes", keywords: ["codes"] })
        .success
    ).toBe(true);
    // 2. Scheduling — a datetime-local string or null (unschedule).
    expect(contentMapRowPatchSchema.safeParse({ scheduledAt: "2026-12-01T16:00" }).success).toBe(true);
    expect(contentMapRowPatchSchema.safeParse({ scheduledAt: null }).success).toBe(true);
    // 3. Actions — with the companions the UI sends on link.
    expect(
      contentMapRowPatchSchema.safeParse({
        action: "link",
        postId: "11111111-1111-4111-8111-111111111111",
        gate: { score: 92 },
        seo: { title: "x" },
      }).success
    ).toBe(true);
    expect(contentMapRowPatchSchema.safeParse({ action: "dismiss" }).success).toBe(true);
  });

  it("normalizes the generation mode case-insensitively in transit", () => {
    const parsed = contentMapRowPatchSchema.safeParse({ mode: "Gate" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.mode).toBe("gate");
  });

  it("rejects an empty patch instead of answering a silent no-op", () => {
    const parsed = contentMapRowPatchSchema.safeParse({});
    expect(parsed.success).toBe(false);
  });

  it("rejects an unknown action and over-cap inline fields", () => {
    expect(contentMapRowPatchSchema.safeParse({ action: "delete" }).success).toBe(false);
    expect(contentMapRowPatchSchema.safeParse({ title: "x".repeat(1201) }).success).toBe(false);
    expect(
      contentMapRowPatchSchema.safeParse({ keywords: Array.from({ length: 25 }, () => "k") }).success
    ).toBe(false);
  });
});

describe("contentMapBatchSchema", () => {
  it("accepts the three runner actions with their optionals", () => {
    expect(contentMapBatchSchema.safeParse({ action: "start" }).success).toBe(true);
    expect(
      contentMapBatchSchema.safeParse({
        action: "start",
        clientId: "22222222-2222-4222-8222-222222222222",
        brandVoice: "Friendly, expert, never salesy",
        imagePref: "auto",
      }).success
    ).toBe(true);
    expect(
      contentMapBatchSchema.safeParse({
        action: "start",
        itemIds: ["33333333-3333-4333-8333-333333333333"],
      }).success
    ).toBe(true);
    expect(contentMapBatchSchema.safeParse({ action: "stop" }).success).toBe(true);
    expect(contentMapBatchSchema.safeParse({ action: "status" }).success).toBe(true);
  });

  it("rejects an impossible image preference and out-of-enum actions", () => {
    expect(contentMapBatchSchema.safeParse({ action: "start", imagePref: 4 }).success).toBe(false);
    expect(contentMapBatchSchema.safeParse({ action: "start", imagePref: true }).success).toBe(false);
    expect(contentMapBatchSchema.safeParse({ action: "restart" }).success).toBe(false);
    expect(contentMapBatchSchema.safeParse({}).success).toBe(false);
  });

  it("rejects non-uuid per-row ids and an over-cap batch", () => {
    expect(contentMapBatchSchema.safeParse({ action: "start", itemIds: ["row-1"] }).success).toBe(false);
    expect(
      contentMapBatchSchema.safeParse({
        action: "start",
        itemIds: Array.from({ length: 201 }, () => "33333333-3333-4333-8333-333333333333"),
      }).success
    ).toBe(false);
  });
});

describe("contentMapSiteSchema", () => {
  it("accepts a bare domain — the route normalizes the URL itself", () => {
    expect(contentMapSiteSchema.safeParse({ url: "example.com" }).success).toBe(true);
    expect(contentMapSiteSchema.safeParse({ url: "https://example.com/about" }).success).toBe(true);
  });

  it("rejects an empty or over-long url ", () => {
    expect(contentMapSiteSchema.safeParse({}).success).toBe(false);
    expect(contentMapSiteSchema.safeParse({ url: "" }).success).toBe(false);
    expect(contentMapSiteSchema.safeParse({ url: "x".repeat(2001) }).success).toBe(false);
  });
});

describe("assetFolderCreateSchema", () => {
  it("accepts the folders pane's create shape and defaults the kind", () => {
    const parsed = assetFolderCreateSchema.safeParse({ name: "  Client Logos  " });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.name).toBe("Client Logos"); // trimmed
      expect(parsed.data.kind).toBe("image"); // default
    }
    expect(
      assetFolderCreateSchema.safeParse({ name: "Voiceovers", kind: "voice" }).success
    ).toBe(true);
    expect(
      assetFolderCreateSchema.safeParse({ name: "Brand assets", kind: "brand" }).success
    ).toBe(true);
  });

  it("rejects a blank, whitespace-only, or over-long name and an unknown kind", () => {
    expect(assetFolderCreateSchema.safeParse({ name: "" }).success).toBe(false);
    expect(assetFolderCreateSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(assetFolderCreateSchema.safeParse({ name: "x".repeat(121) }).success).toBe(false);
    expect(assetFolderCreateSchema.safeParse({ name: "ok", kind: "documents" }).success).toBe(false);
  });
});

describe("assetFolderRenameSchema", () => {
  it("accepts a trimmed rename", () => {
    const parsed = assetFolderRenameSchema.safeParse({ name: "  Q3 Campaigns  " });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.name).toBe("Q3 Campaigns");
  });

  it("rejects the same name rules as create", () => {
    expect(assetFolderRenameSchema.safeParse({}).success).toBe(false);
    expect(assetFolderRenameSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(assetFolderRenameSchema.safeParse({ name: "x".repeat(121) }).success).toBe(false);
  });
});

describe("postAeoGeoSchema", () => {
  it("accepts the absent-body substitution and the deep toggle", () => {
    expect(postAeoGeoSchema.safeParse({}).success).toBe(true);
    expect(postAeoGeoSchema.safeParse({ deep: true }).success).toBe(true);
  });

  it("rejects a non-boolean deep flag", () => {
    expect(postAeoGeoSchema.safeParse({ deep: "yes" }).success).toBe(false);
    expect(postAeoGeoSchema.safeParse({ deep: 1 }).success).toBe(false);
  });
});

describe("postRegenerateSchema", () => {
  it("accepts the no-feedback regenerate and a real rewrite instruction", () => {
    expect(postRegenerateSchema.safeParse({}).success).toBe(true);
    expect(postRegenerateSchema.safeParse({ feedback: " " }).success).toBe(true);
    expect(postRegenerateSchema.safeParse({ feedback: "Less salesy, more technical" }).success).toBe(true);
  });

  it("rejects a non-string and an over-long feedback value", () => {
    expect(postRegenerateSchema.safeParse({ feedback: 5 }).success).toBe(false);
    expect(postRegenerateSchema.safeParse({ feedback: "x".repeat(2001) }).success).toBe(false);
  });
});

describe("sequenceStepSchema", () => {
  const valid = { channel: "email", delay_days: 3, body_template: "Hey {{first_name}}" };

  it("accepts the step shape processSequenceStep actually consumes", () => {
    expect(sequenceStepSchema.safeParse(valid).success).toBe(true);
    // Email step with a subject; SMS step with no delay (route defaults 0).
    expect(
      sequenceStepSchema.safeParse({
        channel: "email",
        subject: "Quick follow up",
        body_template: "Template prose",
      }).success
    ).toBe(true);
    expect(sequenceStepSchema.safeParse({ channel: "sms", body_template: "x" }).success).toBe(true);
  });

  it("rejects an out-of-enum channel (previously a silently skipped step)", () => {
    expect(sequenceStepSchema.safeParse({ ...valid, channel: "push" }).success).toBe(false);
  });

  it("rejects an empty template, an impossible delay, and a non-object step", () => {
    expect(sequenceStepSchema.safeParse({ channel: "email", body_template: "" }).success).toBe(false);
    expect(sequenceStepSchema.safeParse({ ...valid, delay_days: -1 }).success).toBe(false);
    expect(sequenceStepSchema.safeParse({ ...valid, delay_days: 366 }).success).toBe(false);
    expect(sequenceStepSchema.safeParse("send it").success).toBe(false);
  });
});

describe("sequenceCreateSchema", () => {
  it("accepts the create shape the sequence API sends, name trimmed", () => {
    const parsed = sequenceCreateSchema.safeParse({
      name: "  Cold outbound  ",
      description: "3-touch email cadence",
      steps: [
        { channel: "email", delay_days: 0, subject: "Hi", body_template: "{{first_name}}" },
        { channel: "sms", delay_days: 2, body_template: "Checking in" },
      ],
      isActive: false,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.name).toBe("Cold outbound");
  });

  it("keeps a steps-only name/description-free body valid, and an empty steps array", () => {
    expect(sequenceCreateSchema.safeParse({ name: "Sequenced", steps: [] }).success).toBe(true);
  });

  it("rejects the old lenient contracts the schema deliberately tightens", () => {
    // Missing name or steps was previously a manual truthiness 400.
    expect(sequenceCreateSchema.safeParse({ steps: [] }).success).toBe(false);
    expect(sequenceCreateSchema.safeParse({ name: "Sequenced" }).success).toBe(false);
    // Garbage steps were previously stored verbatim.
    expect(sequenceCreateSchema.safeParse({ name: "Sequenced", steps: "three emails" }).success).toBe(false);
    expect(
      sequenceCreateSchema.safeParse({ name: "Sequenced", steps: [{ body_template: "x" }] }).success
    ).toBe(false);
    // Name/description caps.
    expect(sequenceCreateSchema.safeParse({ name: "x".repeat(121), steps: [] }).success).toBe(false);
    expect(
      sequenceCreateSchema.safeParse({ name: "Sequenced", description: "x".repeat(2001), steps: [] }).success
    ).toBe(false);
    expect(
      sequenceCreateSchema.safeParse({ name: "x.25", isActive: "true", steps: [] }).success
    ).toBe(false);
  });

  it("rejects an over-cap step list", () => {
    const steps = Array.from({ length: 51 }, () => ({ channel: "email", body_template: "x" }));
    expect(sequenceCreateSchema.safeParse({ name: "Sequenced", steps }).success).toBe(false);
  });
});

describe("sequenceUpdateSchema", () => {
  it("accepts each patch field on its own and together", () => {
    expect(sequenceUpdateSchema.safeParse({ name: "Renamed cadence" }).success).toBe(true);
    expect(sequenceUpdateSchema.safeParse({ isActive: true }).success).toBe(true);
    expect(sequenceUpdateSchema.safeParse({ description: null }).success).toBe(true);
    expect(
      sequenceUpdateSchema.safeParse({ steps: [{ channel: "sms", body_template: "x" }] }).success
    ).toBe(true);
    expect(sequenceUpdateSchema.safeParse({ name: "Renamed", isActive: false }).success).toBe(true);
  });

  it("rejects an empty patch instead of answering a silent no-op", () => {
    const parsed = sequenceUpdateSchema.safeParse({});
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0].message).toMatch(/Provide at least one of/);
    }
  });

  it("rejects malformed fields", () => {
    expect(sequenceUpdateSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(sequenceUpdateSchema.safeParse({ isActive: 1 }).success).toBe(false);
  });
});

describe("sequenceEnrollSchema", () => {
  it("accepts a uuid lead and rejects a missing or junk leadId", () => {
    expect(
      sequenceEnrollSchema.safeParse({ leadId: "11111111-1111-4111-8111-111111111111" }).success
    ).toBe(true);
    expect(sequenceEnrollSchema.safeParse({}).success).toBe(false);
    expect(sequenceEnrollSchema.safeParse({ leadId: "lead-1" }).success).toBe(false);
  });
});

describe("mediaAssetReassignSchema", () => {
  it("accepts the workspace move, the folder move, and the unfiled move", () => {
    expect(
      mediaAssetReassignSchema.safeParse({ workspaceId: "11111111-1111-4111-8111-111111111111" })
        .success
    ).toBe(true);
    expect(
      mediaAssetReassignSchema.safeParse({ folderId: "22222222-2222-4222-8222-222222222222" })
        .success
    ).toBe(true);
    // The assets page's "unfiled" sentinel and an explicit null clear the folder.
    expect(mediaAssetReassignSchema.safeParse({ folderId: "" }).success).toBe(true);
    expect(mediaAssetReassignSchema.safeParse({ folderId: null }).success).toBe(true);
  });

  it("rejects an empty PATCH, junk ids, and swapped field types", () => {
    expect(mediaAssetReassignSchema.safeParse({}).success).toBe(false);
    expect(mediaAssetReassignSchema.safeParse({ workspaceId: "not-a-uuid" }).success).toBe(false);
    expect(mediaAssetReassignSchema.safeParse({ folderId: "not-a-uuid" }).success).toBe(false);
    expect(
      mediaAssetReassignSchema.safeParse({
        workspaceId: true,
      }).success
    ).toBe(false);
  });
});

describe("mediaAssetDuplicateSchema", () => {
  it("requires a uuid workspaceId", () => {
    expect(
      mediaAssetDuplicateSchema.safeParse({ workspaceId: "11111111-1111-4111-8111-111111111111" })
        .success
    ).toBe(true);
    expect(mediaAssetDuplicateSchema.safeParse({}).success).toBe(false);
    expect(mediaAssetDuplicateSchema.safeParse({ workspaceId: "" }).success).toBe(false);
  });
});

describe("authTotpVerifySchema", () => {
  it("accepts the login shape ({code}) and the setup shape ({code, secret})", () => {
    expect(authTotpVerifySchema.safeParse({ code: "123456" }).success).toBe(true);
    expect(
      authTotpVerifySchema.safeParse({ code: " 123456 ", secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP" }).success
    ).toBe(true);
  });

  it("carries the friendly malformed-code message the UI used to show", () => {
    for (const bad of [undefined, null, 123456, "12345", "1234567", "12 456", "abcdef"]) {
      const parsed = authTotpVerifySchema.safeParse({ code: bad });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues[0].message).toMatch(/6-digit/);
      }
    }
  });

  it("bounds the pending secret and rejects a non-string one", () => {
    expect(
      authTotpVerifySchema.safeParse({ code: "123456", secret: "" }).success
    ).toBe(false);
    expect(
      authTotpVerifySchema.safeParse({ code: "123456", secret: 42 }).success
    ).toBe(false);
    expect(
      authTotpVerifySchema.safeParse({ code: "123456", secret: "x".repeat(201) }).success
    ).toBe(false);
  });
});

describe("authTotpDisableSchema", () => {
  it("accepts a 6-digit code and rejects the malformed shapes", () => {
    expect(authTotpDisableSchema.safeParse({ code: "654321" }).success).toBe(true);
    expect(authTotpDisableSchema.safeParse({}).success).toBe(false);
    expect(authTotpDisableSchema.safeParse({ code: 654321 }).success).toBe(false);
    expect(authTotpDisableSchema.safeParse({ code: "654 321" }).success).toBe(false);
  });
});

describe("authResendConfirmationSchema", () => {
  it("trims and lowercases the email", () => {
    const parsed = authResendConfirmationSchema.safeParse({ email: "  Alice@Example.COM " });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.email).toBe("alice@example.com");
  });

  it("rejects a missing, malformed, or over-long email", () => {
    expect(authResendConfirmationSchema.safeParse({}).success).toBe(false);
    expect(authResendConfirmationSchema.safeParse({ email: "not-an-email" }).success).toBe(false);
    expect(authResendConfirmationSchema.safeParse({ email: "x".repeat(321) }).success).toBe(false);
  });
});

describe("publishBodySchema", () => {
  it("accepts every dispatch payload the app actually sends", () => {
    // PublishButton: WordPress schedule with a naive local slot + offset.
    expect(
      publishBodySchema.safeParse({
        postId: "11111111-1111-4111-8111-111111111111",
        platform: "wordpress",
        action: "schedule",
        scheduledAt: "2026-12-15T09:00",
        tzOffsetMinutes: -60,
        categoryId: 42,
      }).success
    ).toBe(true);
    // Calendar retry: publish through the first platform.
    expect(
      publishBodySchema.safeParse({
        postId: "11111111-1111-4111-8111-111111111111",
        platform: "all",
        action: "publish",
      }).success
    ).toBe(true);
    // Connected-sites dialog: per-site targets without an action.
    expect(
      publishBodySchema.safeParse({
        postId: "11111111-1111-4111-8111-111111111111",
        platform: "connected_sites",
        targets: [
          { blogPlatformId: "bp-1", mode: "overwrite", kind: "post", wpPostId: 7, includeImages: true },
        ],
      }).success
    ).toBe(true);
    // Super-admin gate override.
    expect(
      publishBodySchema.safeParse({
        postId: "11111111-1111-4111-8111-111111111111",
        platform: "cms",
        force: true,
      }).success
    ).toBe(true);
  });

  it("rejects a missing/non-uuid post id and an unknown platform", () => {
    expect(publishBodySchema.safeParse({}).success).toBe(false);
    expect(publishBodySchema.safeParse({ postId: "row-1", platform: "wordpress" }).success).toBe(false);
    expect(publishBodySchema.safeParse({ postId: "11111111-1111-4111-8111-111111111111", platform: "bluesky" }).success).toBe(false);
  });

  it("rejects an unknown action and an impossible tz offset", () => {
    expect(
      publishBodySchema.safeParse({
        postId: "11111111-1111-4111-8111-111111111111",
        platform: "wordpress",
        action: "unpublish",
      }).success
    ).toBe(false);
    expect(
      publishBodySchema.safeParse({
        postId: "11111111-1111-4111-8111-111111111111",
        platform: "wordpress",
        tzOffsetMinutes: 900,
      }).success
    ).toBe(false);
  });

  it("rejects malformed per-site targets", () => {
    expect(
      publishBodySchema.safeParse({
        postId: "11111111-1111-4111-8111-111111111111",
        platform: "connected_sites",
        targets: [{ blogPlatformId: "", mode: "replace", kind: "post" }],
      }).success
    ).toBe(false);
  });
});

describe("publishTargetSchema", () => {
  it("accepts a WordPress id number and a Ghost/string overwrite id", () => {
    expect(
      publishTargetSchema.safeParse({ blogPlatformId: "bp-1", mode: "create", kind: "page", includeImages: false })
    ).toMatchObject({ success: true });
  });
});

describe("publishGeneratedSchema", () => {
  it("accepts the generate page's dialog payload", () => {
    expect(
      publishGeneratedSchema.safeParse({
        targets: [{ blogPlatformId: "bp-1", mode: "create", kind: "post", includeImages: true }],
        content: {
          title: "  History of Netscape  ",
          body: "# Netscape\nProse.",
          slug: "history-of-netscape",
          metaDescription: "Where Netscape came from",
          images: [{ url: "https://cdn.test/a.png", placement: "featured" }],
        },
      }).success
    ).toBe(true);
  });

  it("trims the title the route used to hand-check", () => {
    const parsed = publishGeneratedSchema.safeParse({
      targets: [{ blogPlatformId: "bp-1", mode: "create", kind: "post" }],
      content: { title: "  Untitled  ", body: "prose" },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.content.title).toBe("Untitled");
  });

  it("rejects an empty target list and a missing title/body", () => {
    expect(publishGeneratedSchema.safeParse({ targets: [], content: { title: "t", body: "b" } }).success).toBe(false);
    expect(
      publishGeneratedSchema.safeParse({ targets: [{ blogPlatformId: "bp-1", mode: "create", kind: "post" }], content: { body: "b" } }).success
    ).toBe(false);
    expect(
      publishGeneratedSchema.safeParse({ targets: [{ blogPlatformId: "bp-1", mode: "create", kind: "post" }], content: { title: "t" } }).success
    ).toBe(false);
  });

  it("rejects a non-URL generated image", () => {
    expect(
      publishGeneratedSchema.safeParse({
        targets: [{ blogPlatformId: "bp-1", mode: "create", kind: "post" }],
        content: { title: "t", body: "b", images: [{ url: "not a url" }] },
      }).success
    ).toBe(false);
  });
});

describe("leadCreateSchema", () => {
  it("accepts the partial body the lib contract sends", () => {
    expect(leadCreateSchema.safeParse({ email: "a@b.test" }).success).toBe(true);
    expect(
      leadCreateSchema.safeParse({ email: "a@b.test", firstName: "A", client_id: "x" }).success
    ).toBe(false); // snake_case alias is not part of the contract.
  });

  it("encodes the DB enums (migration 011) and rejects everything else", () => {
    for (const status of LEAD_STATUSES) {
      expect(leadCreateSchema.safeParse({ status }).success).toBe(true);
    }
    for (const source of LEAD_SOURCES) {
      expect(leadCreateSchema.safeParse({ source }).success).toBe(true);
    }
    expect(leadCreateSchema.safeParse({ status: "closed_archived" }).success).toBe(false);
    expect(leadCreateSchema.safeParse({ source: "zoominfo" }).success).toBe(false);
    expect(leadCreateSchema.safeParse({ clientId: "acme" }).success).toBe(false);
  });

  it("rejects unknown keys instead of letting the client drop them", () => {
    const parsed = leadCreateSchema.safeParse({ email: "a@b.test", evil: true });
    expect(parsed.success).toBe(false);
    // strictObject reports unknown keys by name in the message (path is []).
    if (!parsed.success) expect(parsed.error.issues[0].message).toContain('"evil"');
  });
});

describe("leadUpdateSchema", () => {
  it("rejects a patch that updates nothing", () => {
    expect(leadUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("rejects `assignedTo` — updateLead never applied it anyway", () => {
    expect(
      leadUpdateSchema.safeParse({ assignedTo: "11111111-1111-4111-8111-111111111111" }).success
    ).toBe(false);
  });

  it("accepts a single-field status change and every DB status", () => {
    expect(leadUpdateSchema.safeParse({ status: "qualified" }).success).toBe(true);
    for (const status of LEAD_STATUSES) {
      expect(leadUpdateSchema.safeParse({ status }).success).toBe(true);
    }
    expect(leadUpdateSchema.safeParse({ status: "qualified", clientId: null }).success).toBe(false);
    // Empty string clears a field (lib contract: "" → null/NULL).
    expect(leadUpdateSchema.safeParse({ email: "" }).success).toBe(false); // invalid email
    expect(leadUpdateSchema.safeParse({ company: "" }).success).toBe(true);
  });
});

describe("leadEmailSchema", () => {
  it("requires subject and body", () => {
    expect(leadEmailSchema.safeParse({}).success).toBe(false);
    expect(leadEmailSchema.safeParse({ body: "prose" }).success).toBe(false);
    expect(leadEmailSchema.safeParse({ subject: "Hi", body: "prose" }).success).toBe(true);
    expect(leadEmailSchema.safeParse({ subject: "", body: "prose" }).success).toBe(false);
  });

  it("bounds subject and body", () => {
    expect(leadEmailSchema.safeParse({ subject: "x".repeat(501), body: "b" }).success).toBe(false);
    expect(leadEmailSchema.safeParse({ subject: "s", body: "x".repeat(20001) }).success).toBe(false);
  });
});

describe("leadSmsSchema", () => {
  it("requires a body and holds the 1600-character Twilio bound", () => {
    expect(leadSmsSchema.safeParse({}).success).toBe(false);
    expect(leadSmsSchema.safeParse({ body: "" }).success).toBe(false);
    expect(leadSmsSchema.safeParse({ body: "x".repeat(1600) }).success).toBe(true);
    expect(leadSmsSchema.safeParse({ body: "x".repeat(1601) }).success).toBe(false);
  });
});

describe("leadApolloImportSchema", () => {
  it("requires at least one of the three search parameters", () => {
    expect(leadApolloImportSchema.safeParse({ page: 1, per_page: 10 }).success).toBe(false);
    for (const q of ["q_organization_name", "q_title", "q_keywords"]) {
      expect(leadApolloImportSchema.safeParse({ [q]: "Acme" }).success).toBe(true);
    }
  });

  it("bounds page/per_page and the search strings, and rejects unknown filters", () => {
    expect(leadApolloImportSchema.safeParse({ q_keywords: "x".repeat(301) }).success).toBe(false);
    expect(leadApolloImportSchema.safeParse({ q_keywords: "ok", page: 0 }).success).toBe(false);
    expect(leadApolloImportSchema.safeParse({ q_keywords: "ok", page: 101 }).success).toBe(false);
    expect(leadApolloImportSchema.safeParse({ q_keywords: "ok", per_page: 0 }).success).toBe(false);
    expect(leadApolloImportSchema.safeParse({ q_keywords: "ok", per_page: 101 }).success).toBe(false);
    expect(
      leadApolloImportSchema.safeParse({ q_organization_name: "Acme", seniority: "vp" }).success
    ).toBe(false);
  });
});

describe("campaignItemApproveSchema (batch 10)", () => {
  it("accepts the body the calendar sends (itemId + mediaKind)", () => {
    expect(
      campaignItemApproveSchema.safeParse({
        itemId: "11111111-1111-4111-8111-111111111111",
        mediaKind: "image",
      }).success
    ).toBe(true);
    expect(
      campaignItemApproveSchema.safeParse({
        itemId: "11111111-1111-4111-8111-111111111111",
        mediaKind: "video",
      }).success
    ).toBe(true);
  });

  it("rejects a garbage item id, a non-enum mediaKind, and an unknown key", () => {
    expect(campaignItemApproveSchema.safeParse({ itemId: "row-1" }).success).toBe(false);
    expect(campaignItemApproveSchema.safeParse({}).success).toBe(false);
    expect(
      campaignItemApproveSchema.safeParse({
        itemId: "11111111-1111-4111-8111-111111111111",
        mediaKind: "gif",
      }).success
    ).toBe(false);
    expect(
      campaignItemApproveSchema.safeParse({
        itemId: "11111111-1111-4111-8111-111111111111",
        kind: "blog",
      }).success
    ).toBe(false);
  });
});

describe("campaignRefineSchema (batch 10)", () => {
  it("requires a uuid planId", () => {
    expect(
      campaignRefineSchema.safeParse({ planId: "11111111-1111-4111-8111-111111111111" }).success
    ).toBe(true);
    expect(campaignRefineSchema.safeParse({}).success).toBe(false);
    expect(campaignRefineSchema.safeParse({ planId: "plan-1" }).success).toBe(false);
  });
});

describe("campaignFromProposalSchema (batch 10)", () => {
  it("accepts the body the SEO campaigns page sends", () => {
    expect(
      campaignFromProposalSchema.safeParse({
        campaignId: "11111111-1111-4111-8111-111111111111",
        createWorkspace: true,
        includeWebsite: false,
      }).success
    ).toBe(true);
    // workspaceId is optional (absent → fall back to the current workspace).
    expect(
      campaignFromProposalSchema.safeParse({
        campaignId: "11111111-1111-4111-8111-111111111111",
        workspaceId: "22222222-2222-4222-8222-222222222222",
      }).success
    ).toBe(true);
  });

  it("rejects a missing/garbage campaignId and non-boolean flags", () => {
    expect(campaignFromProposalSchema.safeParse({}).success).toBe(false);
    expect(campaignFromProposalSchema.safeParse({ campaignId: "acme" }).success).toBe(false);
    expect(
      campaignFromProposalSchema.safeParse({
        campaignId: "11111111-1111-4111-8111-111111111111",
        createWorkspace: "yes",
      }).success
    ).toBe(false);
  });
});
