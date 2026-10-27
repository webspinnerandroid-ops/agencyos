/**
 * saas-qa-audit · Part 1 — Database integrity, multi-tenancy, scheduling and
 * the AI engine.
 *
 * Runs against the local dev server (:3100) and the live Supabase project with
 * disposable QA tenants. Every row created here is removed in teardown.
 *
 * Checklist coverage:
 *   1. Foreign-key cascades for client workspaces
 *   1. RLS isolation (direct PostgREST reads by a tenant user)
 *   1. Cross-tenant API access (BOLA) with a real second tenant
 *   2. AI engine: auth, validation, rate limiting, concurrent generation
 *   3. Timezone conversion UTC vs. agency local time (+ DST edge)
 */
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import {
  adminClient,
  count,
  createFixtures,
  destroyFixtures,
  requestWithCompileRetry,
  tenantSession,
  type QaFixtures,
} from "./qa-fixtures";
import { normalizeScheduledAt, offsetMinutesForLocalDateTime } from "../../src/lib/scheduling";

test.describe("saas-qa-audit · DB integrity & tenancy", () => {
  test.describe.configure({ mode: "serial" });

  let fx: QaFixtures;
  let db: ReturnType<typeof adminClient>["db"];

  test.beforeAll(async () => {
    fx = await createFixtures();
    db = adminClient().db;
  });

  test.afterAll(async () => {
    if (!fx) return;
    await destroyFixtures(fx);
    expect(await count(db, "workspaces", "tenant_id", fx.tenantId)).toBe(0);
    expect(await count(db, "clients", "tenant_id", fx.tenantId)).toBe(0);
    expect(await count(db, "posts", "tenant_id", fx.tenantId)).toBe(0);
    expect(await count(db, "tenants", "id", fx.tenantId)).toBe(0);
  });

  test("FK cascade: deleting a workspace orphans its clients safely (SET NULL, no data loss)", async () => {
    const before = await db.from("clients").select("id, workspace_id").eq("id", fx.client2Id).single();
    expect(before.data?.workspace_id).toBe(fx.workspace2Id);

    const del = await db.from("workspaces").delete().eq("id", fx.workspace2Id);
    expect(del.error).toBeNull();

    const after = await db.from("clients").select("id, workspace_id").eq("id", fx.client2Id).single();
    expect(after.error).toBeNull();
    expect(after.data?.workspace_id).toBeNull(); // client survived, only the link was cleared
  });

  test("FK cascade: deleting a client detaches its posts instead of destroying content", async () => {
    const post = await db
      .from("posts")
      .insert({
        tenant_id: fx.tenantId,
        workspace_id: fx.workspaceId,
        client_id: fx.client2Id,
        title: `${fx.tag} detach probe`,
        type: "blog",
        status: "draft",
      })
      .select("id")
      .single();
    expect(post.error).toBeNull();
    const postId = post.data!.id;

    const del = await db.from("clients").delete().eq("id", fx.client2Id);
    expect(del.error).toBeNull();

    const row = await db.from("posts").select("id, client_id").eq("id", postId).single();
    expect(row.error).toBeNull();
    // posts.client_id is ON DELETE SET NULL (001_initial_schema.sql:68): the
    // post survives with no client. Documented behaviour, verified live.
    expect(row.data?.client_id).toBeNull();
    await db.from("posts").delete().eq("id", postId);
  });

  test("RLS: a tenant user cannot read tenant tables directly through PostgREST", async () => {
    // Positive control — the service role sees the fixture rows.
    expect(await count(db, "clients", "tenant_id", fx.tenantId)).toBeGreaterThan(0);

    // Negative — the tenant's own authenticated user gets nothing, because the
    // policies key on a JWT claim the app never sets (see the audit report).
    const session = await tenantSession(fx);
    const { data, error } = await session.from("clients").select("id, name, tenant_id");
    expect(error, `unexpected PostgREST error: ${error?.message ?? ""}`).toBeNull();
    expect(data ?? []).toHaveLength(0);

    const anon = createClient(fx.url, fx.anonKey, { auth: { persistSession: false } });
    const anonRes = await anon.from("clients").select("id");
    expect(anonRes.data ?? []).toHaveLength(0);
  });

  test("cross-tenant API probes from another tenant cannot read or mutate this tenant's objects", async ({ request }) => {
    // `request` carries the super-admin session (a different tenant).
    // Cold-compile hardened: these are the suite's first API hits — a dev
    // compile outlasting the probe's timeout read as a transport throw.
    const clients = await requestWithCompileRetry(request, "/api/clients");
    expect(clients.status()).toBe(200);
    const clientsBody = (await clients.json()) as { clients?: Array<{ id: string }> };
    expect(clientsBody.clients?.map((c) => c.id) ?? []).not.toContain(fx.clientId);

    const posts = await requestWithCompileRetry(request, `/api/posts?clientId=${fx.clientId}`);
    expect(posts.status()).toBe(200);
    const postsBody = (await posts.json()) as Array<{ id: string }> | { posts?: Array<{ id: string }> };
    const postIds = Array.isArray(postsBody) ? postsBody.map((p) => p.id) : (postsBody.posts ?? []).map((p) => p.id);
    expect(postIds).not.toContain(fx.postId);

    const map = await requestWithCompileRetry(request, `/api/content-map?clientId=${fx.clientId}`);
    expect(map.status()).toBe(200);
    const mapBody = (await map.json()) as { items?: Array<{ id: string }> };
    expect(mapBody.items?.map((i) => i.id) ?? []).not.toContain(fx.mapItemId);

    // Cold-compile hardened: these can be the suite's first hits of /api/posts/[id].
    const patch = await requestWithCompileRetry(request, `/api/posts/${fx.postId}`, {
      method: "PATCH",
      data: { status: "published" },
    });
    expect(patch.status()).toBe(404);
    const del = await requestWithCompileRetry(request, `/api/posts/${fx.postId}`, { method: "DELETE" });
    expect(del.status()).toBe(404);

    const row = await db.from("posts").select("status").eq("id", fx.postId).single();
    expect(row.data?.status).toBe("draft");
  });

  test("tenant delete cascades every child row", async () => {
    const throwaway = await createFixtures();
    try {
      expect(await count(db, "posts", "tenant_id", throwaway.tenantId)).toBe(1);
      const del = await db.from("tenants").delete().eq("id", throwaway.tenantId);
      expect(del.error).toBeNull();

      for (const table of ["workspaces", "clients", "posts", "content_map_items", "user_roles"]) {
        expect(await count(db, table, "tenant_id", throwaway.tenantId), `${table} leaked`).toBe(0);
      }
    } finally {
      await destroyFixtures(throwaway);
    }
  });
});

test.describe("saas-qa-audit · scheduling engine", () => {
  test("timezone conversion is offset-exact for naive local input", () => {
    expect(normalizeScheduledAt("2026-12-15T09:00", 360)).toBe("2026-12-15T15:00:00.000Z");
    expect(normalizeScheduledAt("2026-12-15T09:00", -120)).toBe("2026-12-15T07:00:00.000Z");
    expect(normalizeScheduledAt("2026-12-15", 420)).toBe("2026-12-15T16:00:00.000Z");
    expect(normalizeScheduledAt("2026-12-15T09:00:00-07:00")).toBe("2026-12-15T16:00:00.000Z");
    // A naive value with no offset falls back to UTC (server-side path).
    expect(normalizeScheduledAt("2026-12-15T09:00")).toBe("2026-12-15T09:00:00.000Z");
  });

  test("a DST-crossing slot uses the offset of the picked date, not of today", () => {
    // Regression for the old `new Date().getTimezoneOffset()` in PublishButton:
    // the offset is captured per selected date now, so the scheduler's own
    // offset can no longer drift a slot by an hour across a DST boundary.
    const summerOffset = 360; // July, America/Denver
    const winterOffset = 420; // December, America/Denver
    const summerStored = normalizeScheduledAt("2026-12-15T09:00", summerOffset);
    const winterStored = normalizeScheduledAt("2026-12-15T09:00", winterOffset);
    // Both are legitimate UTC instants — the point is that the helper reads the
    // picked date, and that the two offsets differ by exactly the DST hour.
    expect(summerStored).toBe("2026-12-15T15:00:00.000Z");
    expect(winterStored).toBe("2026-12-15T16:00:00.000Z");

    // The helper (what PublishButton now calls) returns the picked date's
    // offset, so the round-trip preserves the wall clock the user typed.
    const local = "2026-12-15T09:00";
    const iso = normalizeScheduledAt(local, offsetMinutesForLocalDateTime(local))!;
    const back = new Date(iso);
    expect(
      `${back.getHours()}:${String(back.getMinutes()).padStart(2, "0")}`,
      "the scheduled wall-clock time drifted"
    ).toBe("9:00");
  });

  test("scheduled_at round-trips through Postgres as the same UTC instant", async () => {
    const { db } = adminClient();
    const role = await db.from("user_roles").select("tenant_id").eq("role", "super_admin").limit(1).maybeSingle();
    expect(role.error).toBeNull();
    const tenantId = role.data!.tenant_id as string;

    const post = await db
      .from("posts")
      .insert({
        tenant_id: tenantId,
        title: `QA-AUDIT tz round-trip ${Date.now()}`,
        type: "blog",
        status: "draft",
        scheduled_at: "2026-12-15T09:00:00-07:00", // 09:00 MST
      })
      .select("id, scheduled_at")
      .single();
    expect(post.error).toBeNull();
    expect(new Date(post.data!.scheduled_at).toISOString()).toBe("2026-12-15T16:00:00.000Z");
    await db.from("posts").delete().eq("id", post.data!.id);
  });
});

test.describe("saas-qa-audit · AI content engine", () => {
  test.describe.configure({ mode: "serial" });

  let fx: QaFixtures;

  test.beforeAll(async () => {
    fx = await createFixtures();
  });

  test.afterAll(async () => {
    if (fx) await destroyFixtures(fx);
  });

  test("unauthenticated generation is rejected before any work happens", async ({ playwright, baseURL }) => {
    // A genuinely cookie-less context (the global `request` fixture inherits
    // the suite's storageState, which made an earlier version of this test
    // authenticated by accident).
    const anon = await playwright.request.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
      timeout: 60_000,
    });
    // Cold-compile hardened: this is the suite's first hit of the route.
    const res = await requestWithCompileRetry(anon, "/api/generate-content", {
      method: "POST",
      data: { topic: "unauth probe topic" },
    });
    expect(res.status()).toBe(401);
    await anon.dispose();
  });

  test("malformed bodies fail validation (400) and the limiter answers 429 past its budget", async ({ request }) => {
    test.setTimeout(120_000);
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      // Cold-compile hardened for the FIRST hit only: a retry inside the loop
      // would spend a second request against the server-side limiter budget
      // and shift the 429's expected position.
      const res =
        i === 0
          ? await requestWithCompileRetry(request, "/api/generate-content", {
              method: "POST",
              data: { topic: "x" },
            })
          : await request.post("/api/generate-content", { data: { topic: "x" } }); // too short
      statuses.push(res.status());
    }
    expect(statuses.slice(0, 5).every((s) => s === 400)).toBeTruthy();
    expect(statuses, `statuses=${statuses.join(",")}`).toContain(429);
    expect(statuses.indexOf(429)).toBeGreaterThanOrEqual(9); // limit is 10/min
  });

  test("concurrent generation stays bounded, isolated, and produces distinct drafts", async ({ browser, baseURL }) => {
    test.setTimeout(300_000);
    // A dedicated context: the suite's shared context is signed in as the
    // super admin, and signing in as the QA user there would fight that session.
    const ctx = await browser.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
      viewport: { width: 1280, height: 900 },
    });
    // Sign in through the auth API and hand the context the same cookie the
    // app writes, instead of driving the login form (which is slow to compile
    // and flaky under the dev server's first-hit cost).
    const auth = createClient(fx.url, fx.anonKey, { auth: { persistSession: false } });
    const signedIn = await auth.auth.signInWithPassword({ email: fx.email, password: fx.password });
    expect(signedIn.error, signedIn.error?.message).toBeNull();
    const ref = new URL(fx.url).hostname.split(".")[0];
    const cookieValue =
      "base64-" + Buffer.from(JSON.stringify(signedIn.data.session), "utf8").toString("base64url");
    await ctx.addCookies([
      { name: `sb-${ref}-auth-token`, value: cookieValue, url: baseURL ?? "http://localhost:3100", httpOnly: false, sameSite: "Lax" },
    ]);
    const page = await ctx.newPage();
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    expect(page.url(), "the injected tenant session must reach the dashboard").toContain("/dashboard");

    const body = { topic: "QA audit concurrency probe for a niche agency", imageCount: 0, fiction: true };
    const started = Date.now();
    const [a, b] = await Promise.all([
      ctx.request.post("/api/generate-content", { data: body, timeout: 240_000 }),
      ctx.request.post("/api/generate-content", { data: body, timeout: 240_000 }),
    ]);
    const elapsed = Date.now() - started;

    expect([a.status(), b.status()].every((s) => s < 500), `statuses ${a.status()},${b.status()}`).toBeTruthy();
    expect(elapsed).toBeLessThan(240_000);
    console.log(`[ai] two concurrent fiction generations in ${elapsed}ms → ${a.status()},${b.status()}`);

    if (a.ok() && b.ok()) {
      const ja = (await a.json()) as { blogPost?: { id: string; wordCount?: number } };
      const jb = (await b.json()) as { blogPost?: { id: string; wordCount?: number } };
      expect(ja.blogPost?.id).toBeTruthy();
      expect(jb.blogPost?.id).toBeTruthy();
      expect(ja.blogPost!.id).not.toBe(jb.blogPost!.id);

      // Both drafts landed in the QA tenant and nowhere else.
      const { db } = adminClient();
      const drafts = await db
        .from("posts")
        .select("id, tenant_id")
        .in("id", [ja.blogPost!.id, jb.blogPost!.id]);
      expect(drafts.data ?? []).toHaveLength(2);
      expect((drafts.data ?? []).every((d) => d.tenant_id === fx.tenantId)).toBe(true);

      // Token consumption is recorded per generation (informational: the QA
      // tenant is deleted in teardown, so nothing is billed onward).
      const ledger = await db
        .from("token_ledger")
        .select("unit_qty, total_usd, model_identifier")
        .eq("tenant_id", fx.tenantId);
      const rows = ledger.data ?? [];
      const spend = rows.reduce((sum, r) => sum + Number(r.total_usd ?? 0), 0);
      console.log(`[ai] ledger rows=${rows.length} spend=$${spend.toFixed(4)} models=${[...new Set(rows.map((r) => r.model_identifier))].join(",")}`);
      expect(rows.length, "generation produced no token_ledger rows").toBeGreaterThan(0);
    }
    await ctx.close();
  });
});
