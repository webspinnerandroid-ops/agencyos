import { describe, expect, it } from "vitest";
import { MAX_JSON_BYTES, validateJson } from "./api-validate";
import {
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
