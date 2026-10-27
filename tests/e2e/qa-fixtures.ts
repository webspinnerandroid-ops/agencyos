/**
 * QA-AUDIT fixtures — a disposable, fully isolated tenant used by the
 * saas-qa-audit suite (DB cascades, RLS isolation, cross-tenant API probes).
 *
 * Everything here is created under a `QA-AUDIT-<ts>` tag and destroyed in
 * teardown (with a forced sweep, so a failed run never leaves rows behind).
 *
 * Kill-mid-test hardening: a run that dies (CI kill, Ctrl-C, closed laptop)
 * never reaches afterAll/destroyFixtures, so its tenant, posts and auth user
 * would leak. Every live run therefore journals itself in
 * test-results/qa-audit-runs.json (pid + tag + tenantId + email, written
 * with plain fs so it survives an interrupted process), and the NEXT suite
 * start sweeps any journaled run whose pid is dead, any QA-AUDIT tenant
 * older than an hour, and any orphaned fixture auth user by its reserved
 * email tag. The journal entry is punched only after a full clean sweep.
 * The service role is read from .env.local exactly like the dev server does;
 * no secret is ever printed.
 */
import fs from "fs";
import path from "path";
import type {
  APIRequestContext,
  APIResponse,
  Page,
  Response,
} from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface QaFixtures {
  tag: string;
  tenantId: string;
  workspaceId: string;
  workspace2Id: string;
  clientId: string;
  client2Id: string;
  postId: string;
  mapItemId: string;
  userId: string;
  email: string;
  password: string;
  url: string;
  anonKey: string;
  serviceKey: string;
}

function loadEnv(): Record<string, string> {
  const envPath = path.join(process.cwd(), ".env.local");
  const env: Record<string, string> = {};
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  // Process env wins (CI passes real vars).
  for (const [k, v] of Object.entries(process.env)) {
    if (v && /^(NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY)$/.test(k)) {
      env[k] = v;
    }
  }
  return env;
}

export function adminClient(): { db: SupabaseClient; env: Record<string, string> } {
  const env = loadEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("QA fixtures need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY");
  return {
    db: createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }),
    env,
  };
}

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): NonNullable<T> {
  if (res.error) throw new Error(`fixture ${what} failed: ${res.error.message}`);
  if (res.data == null) throw new Error(`fixture ${what} returned no row`);
  return res.data as NonNullable<T>;
}

export async function createFixtures(): Promise<QaFixtures> {
  const { db, env } = adminClient();

  // Kill-safe sweep part 1: journal-tracked runs whose process is gone never
  // got a clean teardown — sweep everything they created before starting.
  // Entries whose pid is still alive belong to a concurrent run and are left
  // strictly alone.
  const journal = readJournal();
  const liveEntries: JournalEntry[] = [];
  if (process.env.QA_SWEEP_DEBUG) {
    console.error("[qa-sweep] journal read:", JSON.stringify(journal), "cwd:", process.cwd(), "own pid:", process.pid);
  }
  for (const e of journal) {
    const alive = e.pid === process.pid || pidAlive(e.pid);
    if (process.env.QA_SWEEP_DEBUG) {
      console.error(`[qa-sweep] entry pid=${e.pid} tenant=${e.tenantId} alive=${alive}`);
    }
    if (alive) {
      liveEntries.push(e);
      continue;
    }
    try {
      await sweepTenant(db, e.tenantId);
    } catch (err) {
      /* best effort — the age rule below is the second net */
      if (process.env.QA_SWEEP_DEBUG) {
        console.error(`[qa-sweep] journaled dead-pid ${e.pid} tenant ${e.tenantId}:`, (err as Error)?.message ?? err);
      }
    }
  }
  // Dead entries are now swept from the database AND the journal itself, so
  // future runs don't rescan them. Filtering by pid aliveness (rather than
  // deleting exactly the entries swept above) also preserves any entry a
  // concurrent run appended after this process read the file.
  writeJournal(readJournal().filter((e) => e.pid === process.pid || pidAlive(e.pid)));

  // Kill-safe sweep part 2 (pre-journaling runs and crashes before the
  // journal write): any QA-AUDIT tenant older than an hour, unless a live
  // journaled run owns it.
  try {
    const stale = await db
      .from("tenants")
      .select("id")
      .like("name", "QA-AUDIT-%")
      .lt("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());
    for (const row of stale.data ?? []) {
      if (liveEntries.some((e) => e.tenantId === row.id)) continue;
      await sweepTenant(db, row.id);
    }
  } catch {
    /* best effort */
  }

  // Kill-safe sweep part 3: fixture auth users orphaned outside any tenant
  // (killed between createUser and the user_roles insert), matched by their
  // reserved email tag. Journal emails of live runs are protected.
  await sweepOrphanQaUsers(db, new Set(liveEntries.map((e) => e.email)));

  const tag = `QA-AUDIT-${Date.now()}`;
  const slug = tag.toLowerCase();

  const tenant = must(
    await db.from("tenants").insert({ name: tag, slug }).select("id").single<{ id: string }>(),
    "tenant"
  );
  const tenantId = tenant.id;

  const ws = must(
    await db
      .from("workspaces")
      .insert({ tenant_id: tenantId, name: `${tag} Main`, slug: "main", is_default: true })
      .select("id")
      .single<{ id: string }>(),
    "workspace"
  );
  const ws2 = must(
    await db
      .from("workspaces")
      .insert({ tenant_id: tenantId, name: `${tag} Spare`, slug: "spare", is_default: false })
      .select("id")
      .single<{ id: string }>(),
    "workspace2"
  );

  const client = must(
    await db
      .from("clients")
      .insert({ tenant_id: tenantId, workspace_id: ws.id, name: `${tag} Client`, website: "https://example.com" })
      .select("id")
      .single<{ id: string }>(),
    "client"
  );
  const client2 = must(
    await db
      .from("clients")
      .insert({ tenant_id: tenantId, workspace_id: ws2.id, name: `${tag} Client 2` })
      .select("id")
      .single<{ id: string }>(),
    "client2"
  );

  await db.from("brand_profiles").insert({
    tenant_id: tenantId,
    workspace_id: ws.id,
    name: `${tag} Brand`,
    is_default: true,
  });

  const post = must(
    await db
      .from("posts")
      .insert({
        tenant_id: tenantId,
        workspace_id: ws.id,
        client_id: client.id,
        title: `${tag} Cascade Post`,
        type: "blog",
        status: "draft",
        content: { type: "blog", title: `${tag} Cascade Post`, body: "QA fixture body." },
        scheduled_at: "2026-12-15T16:00:00.000Z",
      })
      .select("id")
      .single<{ id: string }>(),
    "post"
  );

  const item = must(
    await db
      .from("content_map_items")
      .insert({
        tenant_id: tenantId,
        workspace_id: ws.id,
        client_id: client.id,
        title: `${tag} Map Row`,
        topic: "qa",
        status: "planned",
      })
      .select("id")
      .single<{ id: string }>(),
    "content_map_item"
  );

  const email = `qa-audit-${Date.now()}@example.com`;
  const password = `Qa!${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const created = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`fixture user failed: ${created.error?.message}`);
  const userId = created.data.user.id;

  must(
    await db
      .from("user_roles")
      .insert({ user_id: userId, tenant_id: tenantId, role: "agency_admin" })
      .select("user_id")
      .single(),
    "user_role"
  );

  // Journal this run so a kill before afterAll is recoverable. (Written with
  // fs, after both the tenant and the user exist — a crash earlier than this
  // point is still covered by the hour-old tenant rule and the email sweep.)
  writeJournal([
    ...liveEntries.filter((e) => e.tenantId !== tenantId),
    { pid: process.pid, startedAt: new Date().toISOString(), tag, tenantId, email },
  ]);

  return {
    tag,
    tenantId,
    workspaceId: ws.id,
    workspace2Id: ws2.id,
    clientId: client.id,
    client2Id: client2.id,
    postId: post.id,
    mapItemId: item.id,
    userId,
    email,
    password,
    url: env.NEXT_PUBLIC_SUPABASE_URL!,
    anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY!,
  };
}

// --- Kill-safe sweep machinery ------------------------------------------

// Lives as a root dot-file, deliberately NOT inside test-results/: Playwright
// wipes its outputDir at the start of every run, which would erase a killed
// run's journal entry before the next run could sweep it.
const RUNS_JOURNAL = path.join(".qa-audit-runs.json");

interface JournalEntry {
  pid: number;
  startedAt: string;
  tag: string;
  tenantId: string;
  email: string;
}

function readJournal(): JournalEntry[] {
  try {
    return JSON.parse(fs.readFileSync(RUNS_JOURNAL, "utf8")) as JournalEntry[];
  } catch {
    return [];
  }
}

function writeJournal(entries: JournalEntry[]): void {
  try {
    fs.mkdirSync(path.dirname(RUNS_JOURNAL), { recursive: true });
    fs.writeFileSync(RUNS_JOURNAL, JSON.stringify(entries, null, 2));
  } catch {
    /* journaling is best effort */
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but belongs to someone else — alive.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function softDelete(db: SupabaseClient, table: string, column: string, value: string): Promise<void> {
  try {
    await db.from(table).delete().eq(column, value);
  } catch (err) {
    /* best effort — the CASCADE under test or the next sweep owns leftovers */
    if (process.env.QA_SWEEP_DEBUG) {
      console.error(`[qa-sweep] ${table} ${column}=${value}:`, (err as Error)?.message ?? err);
    }
  }
}

/**
 * Delete one QA-AUDIT tenant and EVERYTHING it owns, used both by the clean
 * teardown and by the kill-safe sweeps. Real auth users go first (their
 * user_roles rows vanish with the tenant cascade, leaving no handle), then
 * the tenant itself, then an explicit belt-and-braces pass so a broken
 * cascade cannot strand QA-owned rows in the shared database.
 */
export async function sweepTenant(db: SupabaseClient, tenantId: string): Promise<void> {
  try {
    const { data: roles } = await db
      .from("user_roles")
      .select("user_id")
      .eq("tenant_id", tenantId);
    for (const r of roles ?? []) {
      try {
        await db.auth.admin.deleteUser(r.user_id);
      } catch {
        /* best effort */
      }
    }
  } catch {
    /* best effort */
  }
  for (const table of [
    "posts",
    "content_map_items",
    "content_map_imports",
    "brand_profiles",
    "clients",
    "workspaces",
  ]) {
    await softDelete(db, table, "tenant_id", tenantId);
  }
  await softDelete(db, "user_roles", "tenant_id", tenantId);
  await softDelete(db, "tenants", "id", tenantId);
}

/**
 * Fixture auth users whose tenant is already gone — the shape a kill leaves
 * when the process died between createUser and the user_roles insert. Matched
 * by the reserved `qa-audit-<ts>@example.com` tag and swept when older than
 * an hour; the email journal of every live run is protected. Bounded to five
 * pages of the auth admin listing: this is a sweep, not an account scan.
 */
async function sweepOrphanQaUsers(db: SupabaseClient, protectedEmails: Set<string>): Promise<void> {
  const pattern = /^qa-audit-\d+@example\.com$/;
  const cutoff = Date.now() - 60 * 60 * 1000;
  const staleIds: string[] = [];
  for (let page = 1; page <= 5; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data || data.users.length === 0) break;
    for (const u of data.users) {
      if (!u.email || !pattern.test(u.email) || protectedEmails.has(u.email)) continue;
      if (!u.created_at || new Date(u.created_at).getTime() >= cutoff) continue;
      staleIds.push(u.id);
    }
    if (data.users.length < 200) break;
  }
  for (const id of staleIds) {
    try {
      await db.auth.admin.deleteUser(id);
    } catch {
      /* best effort */
    }
  }
}

// -------------------------------------------------------------------------

export async function count(db: SupabaseClient, table: string, column: string, value: string): Promise<number> {
  // `*` because join tables (user_roles) have no `id` column.
  const { count: n, error } = await db.from(table).select("*", { count: "exact", head: true }).eq(column, value);
  if (error) throw new Error(`count ${table}.${column} failed: ${error.message}`);
  return n ?? 0;
}

/**
 * Delete the fixture tenant, every row it owns and its auth users — the
 * explicit belt-and-braces pass lives in sweepTenant so the same contract
 * covers the kill-safe sweeps. The journal entry is punched ONLY after the
 * whole sweep is done: an interrupted teardown leaves the entry behind, and
 * the dead-pid sweep on the next suite start picks up exactly where this one
 * got killed.
 */
export async function destroyFixtures(fx: QaFixtures): Promise<void> {
  const { db } = adminClient();
  await sweepTenant(db, fx.tenantId);
  // Last direct handle on the fixture user: covers the edge where the
  // user_roles insert never happened, leaving no role row to resolve ids by.
  try {
    await db.auth.admin.deleteUser(fx.userId);
  } catch {
    /* best effort — the email-tag sweep catches orphans */
  }
  writeJournal(readJournal().filter((e) => e.tenantId !== fx.tenantId));
}

/** Sign in as the fixture user through the public auth API (RLS client). */
export async function tenantSession(fx: QaFixtures): Promise<SupabaseClient> {
  const client = createClient(fx.url, fx.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email: fx.email, password: fx.password });
  if (error) throw new Error(`fixture sign-in failed: ${error.message}`);
  return client;
}

/**
 * Cold-compile retry helpers for HTTP probes (mirrors the inline
 * probeDestination retry in saas-qa-ui's navigation-dead-ends test).
 *
 * Transport status 0 — or a thrown navigation — is not a dead route: in dev,
 * the FIRST hit of an uncached route can trigger an on-the-fly Next.js
 * compile that outlasts the probe's timeout, so an app failure looks
 * identical to a network hiccup. Retry transport failures once with a
 * longer timeout before declaring the probe dead; a real status answer
 * (4xx/5xx included) is taken at face value on attempt one.
 */
async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** page.goto hardened against dev cold-compile windows (45s navTimeout would throw). */
export async function gotoWithCompileRetry(
  page: Page,
  url: string,
  timeoutMs = 90_000
): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await sleep(1_000); // let the compile settle in
    const res = await page
      .goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs })
      .catch(() => null);
    if (res) return res;
  }
  throw new Error(`probe transport failure after compile retry (status 0): ${url}`);
}

export interface ProbeOpts {
  method?: string;
  data?: unknown;
  headers?: Record<string, string>;
  maxRedirects?: number;
  timeoutMs?: number;
}

/** request.* hardened the same way: retry transport failure once, longer timeout. */
export async function requestWithCompileRetry(
  request: APIRequestContext,
  url: string,
  opts: ProbeOpts = {}
): Promise<APIResponse> {
  const timeout = opts.timeoutMs ?? 90_000;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await sleep(1_000);
    const res = await request
      .fetch(url, {
        method: opts.method ?? "GET",
        data: opts.data,
        headers: opts.headers,
        maxRedirects: opts.maxRedirects,
        timeout,
      })
      .catch(() => null);
    if (res) return res; // a real status answer is face-value, even 4xx/5xx
  }
  throw new Error(`probe transport failure after compile retry (status 0): ${url}`);
}
