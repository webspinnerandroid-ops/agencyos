import { describe, expect, it } from "vitest";
import { MAX_JSON_BYTES, validateJson } from "./api-validate";
import { clientCreateSchema, postUpdateSchema } from "./validations";

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
