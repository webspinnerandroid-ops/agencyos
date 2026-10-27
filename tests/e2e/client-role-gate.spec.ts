/**
 * client-role-gate — proves the middleware role gate (src/proxy.ts).
 *
 * A `client` user is a read-only portal consumer. Before the gate existed only
 * ~41 of 151 routes called requireRole(), so a client session could reach agency
 * tooling (list clients, publish or delete posts) inside its own tenant.
 *
 * The gate lives in middleware, so this suite drives it the way a browser does:
 * a real signed-in client session, over HTTP. It also re-checks the positive
 * control (an agency session still reaches the same routes), which is what
 * catches an over-broad allowlist.
 *
 * Every row this file creates is removed in afterAll (QA-AUDIT tag + cascade).
 */
import { test, expect, type BrowserContext, type APIRequestContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { adminClient, createFixtures, destroyFixtures, gotoWithCompileRetry, requestWithCompileRetry, type QaFixtures } from "./qa-fixtures";

test.describe.configure({ mode: "serial" });

let fx: QaFixtures;
let ctx: BrowserContext;
let api: APIRequestContext;
let clientUserId: string;

/** Same cookie the app's SSR client reads: sb-<project-ref>-auth-token. */
function sessionCookie(url: string, baseURL: string, session: unknown) {
  const ref = new URL(url).hostname.split(".")[0];
  return {
    name: `sb-${ref}-auth-token`,
    value: "base64-" + Buffer.from(JSON.stringify(session), "utf8").toString("base64url"),
    url: baseURL,
    httpOnly: false,
    sameSite: "Lax" as const,
  };
}

test.beforeAll(async ({ browser, baseURL }) => {
  fx = await createFixtures();
  const { db } = adminClient();

  // A client-role user bound to the fixture client — the subject of the gate.
  const email = `qa-client-${Date.now()}@example.com`;
  const password = `Qa!${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const created = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`client user failed: ${created.error?.message}`);
  clientUserId = created.data.user.id;

  const role = await db.from("user_roles").insert({
    user_id: clientUserId,
    tenant_id: fx.tenantId,
    role: "client",
    client_id: fx.clientId,
  });
  if (role.error) throw new Error(`client role row failed: ${role.error.message}`);

  const auth = createClient(fx.url, fx.anonKey, { auth: { persistSession: false } });
  const signedIn = await auth.auth.signInWithPassword({ email, password });
  expect(signedIn.error, signedIn.error?.message).toBeNull();

  ctx = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  await ctx.addCookies([sessionCookie(fx.url, baseURL ?? "http://localhost:3100", signedIn.data.session)]);
  api = ctx.request;
});

test.afterAll(async () => {
  await ctx?.close();
  if (clientUserId) await adminClient().db.auth.admin.deleteUser(clientUserId).catch(() => undefined);
  if (fx) await destroyFixtures(fx);
});

test("client session is admitted to the portal", async () => {
  // Cold-compile hardened: these are the suite's first route hits.
  const res = await requestWithCompileRetry(api, "/portal/dashboard");
  expect(res.status(), "portal dashboard must stay reachable for clients").toBeLessThan(400);
});

test("client session is bounced off agency pages to the portal", async () => {
  // A page from the CLIENT context — the default `page` fixture carries the
  // suite's super-admin storageState and would prove nothing here.
  const page = await ctx.newPage();
  // Cold-compile hardened: the redirect target may compile on this first
  // hit (45s navTimeout would misread that as status 0).
  await gotoWithCompileRetry(page, "/dashboard/clients");
  expect(page.url()).toContain("/portal/dashboard");
  await page.close();
});

test("client session cannot read agency data through the API", async () => {
  const res = await api.get("/api/clients");
  expect(res.status()).toBe(403);
  const body = (await res.json()) as { code?: string };
  expect(body.code, `body=${JSON.stringify(body)}`).toBe("client_role_blocked");

  const posts = await api.get(`/api/posts?clientId=${fx.clientId}`);
  expect(posts.status()).toBe(403);
});

test("client session cannot mutate agency data", async () => {
  const patch = await api.patch(`/api/posts/${fx.postId}`, { data: { status: "published" } });
  expect(patch.status()).toBe(403);

  const del = await api.delete(`/api/posts/${fx.postId}`);
  expect(del.status()).toBe(403);

  // Nothing landed anyway.
  const { db } = adminClient();
  const row = await db.from("posts").select("status").eq("id", fx.postId).single();
  expect(row.data?.status).toBe("draft");
});

test("client session keeps its allowlisted self-service endpoints", async () => {
  // Cold-compile hardened: /api/me and /api/notifications can be this
  // suite's first hits of those routes.
  const me = await requestWithCompileRetry(api, "/api/me");
  expect(me.status()).toBe(200);
  const body = (await me.json()) as { role?: string };
  expect(body.role).toBe("client");

  const notifications = await requestWithCompileRetry(api, "/api/notifications?limit=5");
  expect(notifications.status(), "the portal notification bell must keep working").toBe(200);
});

test("agency session is unaffected (positive control)", async ({ request }) => {
  // Cold-compile hardened: /api/clients is this suite's first hit of the route.
  const res = await requestWithCompileRetry(request, "/api/clients");
  expect(res.status(), "the gate must not touch agency staff").toBe(200);

  const posts = await requestWithCompileRetry(request, "/api/posts");
  expect(posts.status()).toBe(200);
});
