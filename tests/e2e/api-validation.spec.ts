/**
 * api-validation — the shape of the two write routes that adopted
 * `parseJsonBody` (src/lib/api-validate.ts).
 *
 * Unit tests cover the helper and the schemas; this file proves the routes use
 * them: a bad body is refused with a field-level 400, and the bodies the app
 * actually sends still succeed end to end.
 */
import { test, expect } from "@playwright/test";
import { adminClient } from "./qa-fixtures";

test.describe.configure({ mode: "serial" });

let tenantId: string;
let postId: string;
let createdClientId: string | null = null;
const stamp = Date.now();

test.beforeAll(async () => {
  const { db } = adminClient();
  const role = await db
    .from("user_roles")
    .select("tenant_id")
    .eq("role", "super_admin")
    .limit(1)
    .maybeSingle();
  if (role.error || !role.data) throw new Error(`could not resolve the session tenant: ${role.error?.message}`);
  tenantId = role.data.tenant_id as string;

  const post = await db
    .from("posts")
    .insert({
      tenant_id: tenantId,
      title: `QA-VALIDATION ${stamp}`,
      type: "blog",
      status: "draft",
      content: { type: "blog", title: `QA-VALIDATION ${stamp}`, body: "Validation probe." },
    })
    .select("id")
    .single();
  if (post.error) throw new Error(`probe post insert failed: ${post.error.message}`);
  postId = post.data.id;
});

test.afterAll(async () => {
  const { db } = adminClient();
  if (postId) await db.from("posts").delete().eq("id", postId);
  if (createdClientId) await db.from("clients").delete().eq("id", createdClientId);
});

test("POST /api/clients refuses an empty body with field-level detail", async ({ request }) => {
  const res = await request.post("/api/clients", { data: {} });
  expect(res.status()).toBe(400);
  const body = (await res.json()) as {
    code?: string;
    issues?: { path: string; message: string }[];
  };
  expect(body.code).toBe("invalid_body");
  expect(body.issues?.map((i) => i.path)).toContain("name");
});

test("POST /api/clients accepts the body the create form sends", async ({ request }) => {
  const res = await request.post("/api/clients", {
    data: { name: `QA VALIDATION ${stamp}`, website: "", notes: "created by api-validation.spec" },
  });
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()) as { client?: { id: string; name: string } };
  expect(body.client?.name).toBe(`QA VALIDATION ${stamp}`);
  createdClientId = body.client?.id ?? null;
});

test("PATCH /api/posts/[id] refuses an empty update instead of a silent 200", async ({ request }) => {
  const res = await request.patch(`/api/posts/${postId}`, { data: {} });
  expect(res.status()).toBe(400);
  const body = (await res.json()) as { code?: string; issues?: { message: string }[] };
  expect(body.code).toBe("invalid_body");
  expect(body.issues?.[0]?.message).toMatch(/scheduled_at, status, workspace_id/);
});

test("PATCH /api/posts/[id] refuses a naive timestamp and an unknown status", async ({ request }) => {
  const naive = await request.patch(`/api/posts/${postId}`, {
    data: { scheduled_at: "2026-12-15T09:00" },
  });
  expect(naive.status()).toBe(400);

  const unknown = await request.patch(`/api/posts/${postId}`, { data: { status: "deleted" } });
  expect(unknown.status()).toBe(400);
});

test("PATCH /api/posts/[id] still applies a real status change", async ({ request }) => {
  const res = await request.patch(`/api/posts/${postId}`, { data: { status: "approved" } });
  expect(res.status(), await res.text()).toBe(200);

  const { db } = adminClient();
  const row = await db.from("posts").select("status").eq("id", postId).single();
  expect(row.data?.status).toBe("approved");
});

// ---- Notifications family (batch 3) --------------------------------------
// Random uuids never match a real row, so the mark/delete calls under test
// are proven without touching the tenant's actual notifications.

const CLEAN_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

test("POST /api/notifications applies the body the page sends (ids list)", async ({ request }) => {
  const res = await request.post("/api/notifications", {
    data: { ids: [CLEAN_UUID] },
  });
  expect(res.status(), await res.text()).toBe(200);
  expect((await res.json()).success).toBe(true);
});

test("POST /api/notifications keeps the empty-body mark-all courtesy", async ({ request }) => {
  // An ABSENT body — no data, not even "": Playwright would otherwise send
  // a quoted empty string, which the tightened schema correctly rejects.
  const res = await request.post("/api/notifications", {
    headers: { "Content-Type": "application/json" },
  });
  expect(res.status(), await res.text()).toBe(200);
  expect((await res.json()).success).toBe(true);
});

test("POST /api/notifications refuses a non-array ids value with field detail", async ({ request }) => {
  // Previously a garbage ids value silently marked EVERYTHING read.
  const res = await request.post("/api/notifications", { data: { ids: "all" } });
  expect(res.status()).toBe(400);
  const body = (await res.json()) as { code?: string; issues?: { path: string }[] };
  expect(body.code).toBe("invalid_body");
  expect(body.issues?.map((i) => i.path)).toContain("ids");
});

test("DELETE /api/notifications accepts an ids list and an empty array no-op", async ({ request }) => {
  const noop = await request.delete("/api/notifications", { data: { ids: [] } });
  expect(noop.status(), await noop.text()).toBe(200);
  expect((await noop.json()).deleted).toBe(0);

  const junk = await request.delete("/api/notifications", { data: { ids: "all" } });
  expect(junk.status()).toBe(400);
});

test("POST /api/notifications/read-link validates link and keeps the no-op courtesy", async ({ request }) => {
  const res = await request.post("/api/notifications/read-link", {
    data: { link: "/dashboard/posts" },
  });
  expect(res.status(), await res.text()).toBe(200);

  const junk = await request.post("/api/notifications/read-link", { data: { link: 5 } });
  expect(junk.status()).toBe(400);

  // No body at all: historically a no-op, not an error.
  const empty = await request.post("/api/notifications/read-link", {
    headers: { "Content-Type": "application/json" },
  });
  expect(empty.status()).toBe(200);
});

// ---- Posts rescore/regenerate + publish family (batch 4) -------------------
// The probe post is used for read-only rescore shapes; regenerate and publish
// are only exercised on REJECTED bodies and on ids that match nothing, so the
// AI pipeline and any publisher stay untouched.

test("POST /api/posts/[id]/aeo-geo rejects a non-boolean deep flag with field detail", async ({ request }) => {
  const res = await request.post(`/api/posts/${postId}/aeo-geo`, { data: { deep: "yes" } });
  expect(res.status()).toBe(400);
  const body = (await res.json()) as { code?: string; issues?: { path: string }[] };
  expect(body.code).toBe("invalid_body");
  expect(body.issues?.map((i) => i.path)).toContain("deep");
});

test("POST /api/posts/[id]/aeo-geo accepts the body the detail modal sends", async ({ request }) => {
  const res = await request.post(`/api/posts/${postId}/aeo-geo`, { data: { deep: false } });
  expect(res.status(), await res.text()).toBe(200);
  expect(await res.json()).toHaveProperty("result");
});

test("POST /api/posts/[id]/regenerate rejects a garbage body before any pipeline runs", async ({ request }) => {
  const res = await request.post(`/api/posts/${postId}/regenerate`, { data: { feedback: 42 } });
  expect(res.status()).toBe(400);
  const body = (await res.json()) as { code?: string; issues?: { path: string }[] };
  expect(body.code).toBe("invalid_body");
  expect(body.issues?.map((i) => i.path)).toContain("feedback");
});

test("POST /api/publish refuses an unvalidatable body with field-level detail", async ({ request }) => {
  const junkPlatform = await request.post("/api/publish", {
    data: { postId, platform: "bluesky" },
  });
  expect(junkPlatform.status()).toBe(400);
  expect((await junkPlatform.json()).code).toBe("invalid_body");

  const badId = await request.post("/api/publish", { data: { postId: "row-1", platform: "all" } });
  expect(badId.status()).toBe(400);
});

test("POST /api/publish routes a well-formed publish body past validation", async ({ request }) => {
  // A uuid that matches no post: validation accepts it, the branch logic
  // answers "Post not found" — proving the body got through the schema.
  const res = await request.post("/api/publish", {
    data: { postId: CLEAN_UUID, platform: "instagram", action: "publish" },
  });
  expect(res.status()).toBe(404);
});

test("POST /api/publish/generated keeps the empty-targets and missing-title contracts", async ({ request }) => {
  const noTargets = await request.post("/api/publish/generated", {
    data: { targets: [], content: { title: "t", body: "b" } },
  });
  expect(noTargets.status()).toBe(400);
  expect((await noTargets.json()).issues?.[0]?.message).toMatch(/at least one connected site/);

  const noTitle = await request.post("/api/publish/generated", {
    data: { targets: [{ blogPlatformId: "bp-1", mode: "create", kind: "post" }], content: { body: "prose" } },
  });
  expect(noTitle.status()).toBe(400);
  expect((await noTitle.json()).issues?.[0]?.message).toMatch(/missing a title/);
});

test("POST /api/publish/generated routes an app-shaped body past validation", async ({ request }) => {
  // Missing platform id: every attempt fails per-site without touching data.
  const res = await request.post("/api/publish/generated", {
    data: {
      targets: [{ blogPlatformId: "no-such-platform", mode: "create", kind: "post", includeImages: false }],
      content: { title: "QA-VALIDATION probe", body: "Validation probe." },
    },
  });
  expect(res.status(), await res.text()).toBe(200);
  expect((await res.json()).success).toBe(false);
});
