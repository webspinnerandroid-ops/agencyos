/**
 * api-validation — the shape of the two write routes that adopted
 * `parseJsonBody` (src/lib/api-validate.ts).
 *
 * Unit tests cover the helper and the schemas; this file proves the routes use
 * them: a bad body is refused with a field-level 400, and the bodies the app
 * actually sends still succeed end to end.
 */
import { test, expect } from "@playwright/test";
import { adminClient, requestWithCompileRetry } from "./qa-fixtures";
import type { APIRequestContext } from "@playwright/test";

test.describe.configure({ mode: "serial" });

let tenantId: string;
let postId: string;
let createdClientId: string | null = null;
let createdSequenceId: string | null = null;
const stamp = Date.now();

/**
 * request-fixture wrappers hardened against dev cold-compile status 0 (see
 * requestWithCompileRetry in qa-fixtures): the FIRST hit of each of these
 * routes compiles on the fly, which can outlast the request timeout and read
 * as a transport failure instead of the contract status the probe asserts.
 */
function hardPost(
  request: APIRequestContext,
  url: string,
  opts?: { data?: unknown; headers?: Record<string, string> }
) {
  return requestWithCompileRetry(request, url, { method: "POST", data: opts?.data, headers: opts?.headers });
}
function hardPatch(request: APIRequestContext, url: string, opts?: { data?: unknown }) {
  return requestWithCompileRetry(request, url, { method: "PATCH", data: opts?.data });
}
function hardDelete(request: APIRequestContext, url: string, opts?: { data?: unknown }) {
  return requestWithCompileRetry(request, url, { method: "DELETE", data: opts?.data });
}

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
  if (createdSequenceId) await db.from("sequences").delete().eq("id", createdSequenceId);
});

test("POST /api/clients refuses an empty body with field-level detail", async ({ request }) => {
  const res = await hardPost(request, "/api/clients", { data: {} });
  expect(res.status()).toBe(400);
  const body = (await res.json()) as {
    code?: string;
    issues?: { path: string; message: string }[];
  };
  expect(body.code).toBe("invalid_body");
  expect(body.issues?.map((i) => i.path)).toContain("name");
});

test("POST /api/clients accepts the body the create form sends", async ({ request }) => {
  const res = await hardPost(request, "/api/clients", {
    data: { name: `QA VALIDATION ${stamp}`, website: "", notes: "created by api-validation.spec" },
  });
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()) as { client?: { id: string; name: string } };
  expect(body.client?.name).toBe(`QA VALIDATION ${stamp}`);
  createdClientId = body.client?.id ?? null;
});

test("PATCH /api/posts/[id] refuses an empty update instead of a silent 200", async ({ request }) => {
  const res = await hardPatch(request, `/api/posts/${postId}`, { data: {} });
  expect(res.status()).toBe(400);
  const body = (await res.json()) as { code?: string; issues?: { message: string }[] };
  expect(body.code).toBe("invalid_body");
  expect(body.issues?.[0]?.message).toMatch(/scheduled_at, status, workspace_id/);
});

test("PATCH /api/posts/[id] refuses a naive timestamp and an unknown status", async ({ request }) => {
  const naive = await hardPatch(request, `/api/posts/${postId}`, {
    data: { scheduled_at: "2026-12-15T09:00" },
  });
  expect(naive.status()).toBe(400);

  const unknown = await hardPatch(request, `/api/posts/${postId}`, { data: { status: "deleted" } });
  expect(unknown.status()).toBe(400);
});

test("PATCH /api/posts/[id] still applies a real status change", async ({ request }) => {
  const res = await hardPatch(request, `/api/posts/${postId}`, { data: { status: "approved" } });
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
  const res = await hardPost(request, "/api/notifications", {
    data: { ids: [CLEAN_UUID] },
  });
  expect(res.status(), await res.text()).toBe(200);
  expect((await res.json()).success).toBe(true);
});

test("POST /api/notifications keeps the empty-body mark-all courtesy", async ({ request }) => {
  // An ABSENT body — no data, not even "": Playwright would otherwise send
  // a quoted empty string, which the tightened schema correctly rejects.
  const res = await hardPost(request, "/api/notifications", {
    headers: { "Content-Type": "application/json" },
  });
  expect(res.status(), await res.text()).toBe(200);
  expect((await res.json()).success).toBe(true);
});

test("POST /api/notifications refuses a non-array ids value with field detail", async ({ request }) => {
  // Previously a garbage ids value silently marked EVERYTHING read.
  const res = await hardPost(request, "/api/notifications", { data: { ids: "all" } });
  expect(res.status()).toBe(400);
  const body = (await res.json()) as { code?: string; issues?: { path: string }[] };
  expect(body.code).toBe("invalid_body");
  expect(body.issues?.map((i) => i.path)).toContain("ids");
});

test("DELETE /api/notifications accepts an ids list and an empty array no-op", async ({ request }) => {
  const noop = await hardDelete(request, "/api/notifications", { data: { ids: [] } });
  expect(noop.status(), await noop.text()).toBe(200);
  expect((await noop.json()).deleted).toBe(0);

  const junk = await hardDelete(request, "/api/notifications", { data: { ids: "all" } });
  expect(junk.status()).toBe(400);
});

test("POST /api/notifications/read-link validates link and keeps the no-op courtesy", async ({ request }) => {
  const res = await hardPost(request, "/api/notifications/read-link", {
    data: { link: "/dashboard/posts" },
  });
  expect(res.status(), await res.text()).toBe(200);

  const junk = await hardPost(request, "/api/notifications/read-link", { data: { link: 5 } });
  expect(junk.status()).toBe(400);

  // No body at all: historically a no-op, not an error.
  const empty = await hardPost(request, "/api/notifications/read-link", {
    headers: { "Content-Type": "application/json" },
  });
  expect(empty.status()).toBe(200);
});

// ---- Posts rescore/regenerate + publish family (batch 4) -------------------
// The probe post is used for read-only rescore shapes; regenerate and publish
// are only exercised on REJECTED bodies and on ids that match nothing, so the
// AI pipeline and any publisher stay untouched.

test("POST /api/posts/[id]/aeo-geo rejects a non-boolean deep flag with field detail", async ({ request }) => {
  const res = await hardPost(request, `/api/posts/${postId}/aeo-geo`, { data: { deep: "yes" } });
  expect(res.status()).toBe(400);
  const body = (await res.json()) as { code?: string; issues?: { path: string }[] };
  expect(body.code).toBe("invalid_body");
  expect(body.issues?.map((i) => i.path)).toContain("deep");
});

test("POST /api/posts/[id]/aeo-geo accepts the body the detail modal sends", async ({ request }) => {
  const res = await hardPost(request, `/api/posts/${postId}/aeo-geo`, { data: { deep: false } });
  expect(res.status(), await res.text()).toBe(200);
  expect(await res.json()).toHaveProperty("result");
});

test("POST /api/posts/[id]/regenerate rejects a garbage body before any pipeline runs", async ({ request }) => {
  const res = await hardPost(request, `/api/posts/${postId}/regenerate`, { data: { feedback: 42 } });
  expect(res.status()).toBe(400);
  const body = (await res.json()) as { code?: string; issues?: { path: string }[] };
  expect(body.code).toBe("invalid_body");
  expect(body.issues?.map((i) => i.path)).toContain("feedback");
});

test("POST /api/publish refuses an unvalidatable body with field-level detail", async ({ request }) => {
  const junkPlatform = await hardPost(request, "/api/publish", {
    data: { postId, platform: "bluesky" },
  });
  expect(junkPlatform.status()).toBe(400);
  expect((await junkPlatform.json()).code).toBe("invalid_body");

  const badId = await hardPost(request, "/api/publish", { data: { postId: "row-1", platform: "all" } });
  expect(badId.status()).toBe(400);
});

test("POST /api/publish routes a well-formed publish body past validation", async ({ request }) => {
  // A uuid that matches no post: validation accepts it, the branch logic
  // answers "Post not found" — proving the body got through the schema.
  const res = await hardPost(request, "/api/publish", {
    data: { postId: CLEAN_UUID, platform: "instagram", action: "publish" },
  });
  expect(res.status()).toBe(404);
});

test("POST /api/publish/generated keeps the empty-targets and missing-title contracts", async ({ request }) => {
  const noTargets = await hardPost(request, "/api/publish/generated", {
    data: { targets: [], content: { title: "t", body: "b" } },
  });
  expect(noTargets.status()).toBe(400);
  expect((await noTargets.json()).issues?.[0]?.message).toMatch(/at least one connected site/);

  const noTitle = await hardPost(request, "/api/publish/generated", {
    data: { targets: [{ blogPlatformId: "bp-1", mode: "create", kind: "post" }], content: { body: "prose" } },
  });
  expect(noTitle.status()).toBe(400);
  expect((await noTitle.json()).issues?.[0]?.message).toMatch(/missing a title/);
});

test("POST /api/publish/generated routes an app-shaped body past validation", async ({ request }) => {
  // Missing platform id: every attempt fails per-site without touching data.
  const res = await hardPost(request, "/api/publish/generated", {
    data: {
      targets: [{ blogPlatformId: "no-such-platform", mode: "create", kind: "post", includeImages: false }],
      content: { title: "QA-VALIDATION probe", body: "Validation probe." },
    },
  });
  expect(res.status(), await res.text()).toBe(200);
  expect((await res.json()).success).toBe(false);
});

// ---- Sequences family (batch 5) --------------------------------------------
// Create/patch/delete are exercised with no leads in sight; enroll is only
// exercised against a sequence id that matches nothing, so no real lead is
// ever enrolled.

test("POST /api/sequences refuses the old lenient contracts with field detail", async ({ request }) => {
  // Previously a truthiness 400 on missing name/steps; garbage steps row(s)
  // were stored verbatim (later crashing the automation on step.channel).
  const empty = await hardPost(request, "/api/sequences", { data: {} });
  expect(empty.status()).toBe(400);
  const emptyBody = (await empty.json()) as { code?: string; issues?: { path: string }[] };
  expect(emptyBody.code).toBe("invalid_body");
  expect(emptyBody.issues?.map((i) => i.path)).toContain("name");

  const junkSteps = await hardPost(request, "/api/sequences", {
    data: { name: `QA-VALIDATION ${stamp}`, steps: "three emails" },
  });
  expect(junkSteps.status()).toBe(400);

  const steplessStep = await hardPost(request, "/api/sequences", {
    data: { name: `QA-VALIDATION ${stamp}`, steps: [{ body_template: "x" }] },
  });
  expect(steplessStep.status()).toBe(400);
  expect(((await steplessStep.json()) as { issues?: { path: string }[] }).issues?.map((i) => i.path)).toContain("steps.0.channel");
});

test("POST /api/sequences accepts the body the sequence API sends", async ({ request }) => {
  const res = await hardPost(request, "/api/sequences", {
    data: {
      name: `QA-VALIDATION ${stamp}`,
      description: "created by api-validation.spec",
      steps: [{ channel: "email", delay_days: 0, subject: "Hi", body_template: "{{first_name}}" }],
      isActive: false,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  createdSequenceId = ((await res.json()) as { id: string }).id;
});

test("PATCH /api/sequences/[id] refuses an empty patch and a junk isActive", async ({ request }) => {
  const empty = await hardPatch(request, `/api/sequences/${createdSequenceId}`, { data: {} });
  expect(empty.status()).toBe(400);
  expect((await empty.json()).code).toBe("invalid_body");

  const junk = await hardPatch(request, `/api/sequences/${createdSequenceId}`, { data: { isActive: "sure" } });
  expect(junk.status()).toBe(400);
});

test("PATCH /api/sequences/[id] still applies a real update", async ({ request }) => {
  const res = await hardPatch(request, `/api/sequences/${createdSequenceId}`, {
    data: { name: `QA-VALIDATION ${stamp} renamed`, isActive: true },
  });
  expect(res.status(), await res.text()).toBe(200);

  const { db } = adminClient();
  const row = await db.from("sequences").select("name, is_active").eq("id", createdSequenceId).single();
  expect(row.data?.name).toBe(`QA-VALIDATION ${stamp} renamed`);
  expect(row.data?.is_active).toBe(true);
});

test("POST /api/sequences/[id]/enroll validates the body before the sequence lookup", async ({ request }) => {
  // A junk leadId is a field-level 400, not a 404 from the branch logic.
  const junk = await hardPost(request, `/api/sequences/${createdSequenceId}/enroll`, { data: { leadId: "lead-1" } });
  expect(junk.status()).toBe(400);
  expect(((await junk.json()) as { issues?: { path: string }[] }).issues?.map((i) => i.path)).toContain("leadId");

  // A well-formed body routes past validation to the sequence lookup.
  const unknown = await hardPost(request, 
    `/api/sequences/${"88888888-8888-4888-8888-888888888888"}/enroll`,
    { data: { leadId: "88888888-8888-4888-8888-888888888888" } }
  );
  expect(unknown.status(), await unknown.text()).toBe(404);
});

// ---- Auth token family (batch 6) -------------------------------------------
// The 2FA probes never disable or enroll anything (this account has no
// user_2fa row, so both calls stop at the "not enabled" branch); the
// resend-confirmation probe uses an email that owns no account, so no email
// is ever sent. Still exercised only up to the branch boundaries.

test("POST /api/auth/2fa/verify carries the friendly malformed-code message", async ({ request }) => {
  const junk = await hardPost(request, "/api/auth/2fa/verify", { data: { code: 123456 } });
  expect(junk.status()).toBe(400);
  const body = (await junk.json()) as { error?: string; issues?: { message: string }[] };
  expect(body.issues?.[0]?.message).toMatch(/6-digit/);

  // A syntactically valid code trips the "not enabled" branch, proving it
  // got past validation and into the route's own logic.
  const shaped = await hardPost(request, "/api/auth/2fa/verify", { data: { code: "123456" } });
  expect(shaped.status()).toBe(400);
  expect((await shaped.json()).error).toMatch(/not enabled/i);
});

test("POST /api/auth/2fa/verify refuses a non-string pending secret", async ({ request }) => {
  const res = await hardPost(request, "/api/auth/2fa/verify", {
    data: { code: "123456", secret: 42 },
  });
  expect(res.status()).toBe(400);
  expect(((await res.json()) as { issues?: { path: string }[] }).issues?.map((i) => i.path)).toContain("secret");
});

test("POST /api/auth/2fa/disable rejects a junk code and stops at the not-enabled branch", async ({ request }) => {
  const junk = await hardPost(request, "/api/auth/2fa/disable", { data: { code: "654 321" } });
  expect(junk.status()).toBe(400);

  const shaped = await hardPost(request, "/api/auth/2fa/disable", { data: { code: "654321" } });
  expect(shaped.status()).toBe(400);
  expect((await shaped.json()).error).toMatch(/not enabled/i);
});

test("POST /api/auth/resend-confirmation validates the email and keeps the opaque response", async ({ request }) => {
  const junk = await hardPost(request, "/api/auth/resend-confirmation", { data: { email: "not-an-email" } });
  expect(junk.status()).toBe(400);
  expect(((await junk.json()) as { issues?: { message: string }[] }).issues?.[0]?.message).toMatch(/valid email/i);

  // An email that owns no account: same opaque {ok:true} as ever.
  const unknown = await hardPost(request, "/api/auth/resend-confirmation", {
    data: { email: `qa-validation-${stamp}@no-such-account.test` },
  });
  expect(unknown.status(), await unknown.text()).toBe(200);
  expect(await unknown.json()).toEqual({ ok: true });
});

// ---- Scheduled resolve + push subscribe (batch 8) ----------------------------
// The resolve probe uses a uuid that matches no post (validation accepts it,
// the tenant/workspace scoping answers 404); the subscribe probe inserts one
// row and deletes it in the same test, so the sweep leaves nothing behind.

test("POST /api/scheduled/resolve refuses a garbage postId and a reasonless dismiss", async ({ request }) => {
  // Previously a non-uuid postId fell through to the lookup (a supabase
  // error read as "Post not found in this workspace", 404).
  const junkId = await hardPost(request, "/api/scheduled/resolve", {
    data: { postId: "row-1", action: "retry" },
  });
  expect(junkId.status()).toBe(400);
  const junkBody = (await junkId.json()) as { code?: string; issues?: { path: string }[] };
  expect(junkBody.code).toBe("invalid_body");
  expect(junkBody.issues?.map((i) => i.path)).toContain("postId");

  const noReason = await hardPost(request, "/api/scheduled/resolve", {
    data: { postId: CLEAN_UUID, action: "dismiss" },
  });
  expect(noReason.status()).toBe(400);
  expect(((await noReason.json()) as { issues?: { message: string }[] }).issues?.[0]?.message).toMatch(
    /A reason is required to dismiss a failure\./
  );

  const noAction = await hardPost(request, "/api/scheduled/resolve", { data: { postId: CLEAN_UUID } });
  expect(noAction.status()).toBe(400);
});

test("POST /api/scheduled/resolve routes a well-formed retry past validation", async ({ request }) => {
  // A uuid that matches no post: validation accepts it, the tenant/workspace
  // scoping answers "Post not found in this workspace" — proving the body
  // got through the schema.
  const res = await hardPost(request, "/api/scheduled/resolve", {
    data: { postId: CLEAN_UUID, action: "retry" },
  });
  expect(res.status()).toBe(404);
});

test("POST /api/push/subscribe refuses malformed subscriptions with field detail", async ({ request }) => {
  const noKeys = await hardPost(request, "/api/push/subscribe", {
    data: { endpoint: "https://push.example.test/qa" },
  });
  expect(noKeys.status()).toBe(400);
  expect(((await noKeys.json()) as { issues?: { path: string }[] }).issues?.map((i) => i.path)).toContain("keys");

  const insecure = await hardPost(request, "/api/push/subscribe", {
    data: { endpoint: "http://push.example.test/qa", keys: { p256dh: "k", auth: "a" } },
  });
  expect(insecure.status()).toBe(400);
  expect(((await insecure.json()) as { issues?: { path: string }[] }).issues?.map((i) => i.path)).toContain("endpoint");
});

test("POST /api/push/subscribe accepts the body PwaRegister sends and cleans up", async ({ request }) => {
  const endpoint = "https://push.example.test/subscribe/qa-validation";
  const res = await hardPost(request, "/api/push/subscribe", {
    data: { endpoint, keys: { p256dh: "qa-p256dh-probe", auth: "qa-auth-probe" } },
  });
  expect(res.status(), await res.text()).toBe(200);
  expect((await res.json()).ok).toBe(true);

  // Remove the probe row so the sweep leaves nothing behind.
  const { db } = adminClient();
  const gone = await db.from("push_subscriptions").delete().eq("endpoint", endpoint);
  expect(gone.error).toBeNull();
});

test("DELETE /api/push/subscribe validates the endpoint and keeps the no-match success", async ({ request }) => {
  const missing = await hardDelete(request, "/api/push/subscribe", { data: {} });
  expect(missing.status()).toBe(400);
  expect(((await missing.json()) as { issues?: { path: string }[] }).issues?.map((i) => i.path)).toContain("endpoint");

  // A well-formed endpoint that matches nothing: same {ok:true} as ever.
  const res = await hardDelete(request, "/api/push/subscribe", {
    data: { endpoint: "https://push.example.test/subscribe/never-registered" },
  });
  expect(res.status(), await res.text()).toBe(200);
});
