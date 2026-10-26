/**
 * QA-AUDIT fixtures — a disposable, fully isolated tenant used by the
 * saas-qa-audit suite (DB cascades, RLS isolation, cross-tenant API probes).
 *
 * Everything here is created under a `QA-AUDIT-<ts>` tag and destroyed in
 * teardown (with a forced sweep, so a failed run never leaves rows behind).
 * The service role is read from .env.local exactly like the dev server does;
 * no secret is ever printed.
 */
import fs from "fs";
import path from "path";
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
  // Safety net: a previous run that died inside createFixtures never reached
  // afterAll, so sweep any QA tenant older than an hour before starting.
  try {
    const stale = await db
      .from("tenants")
      .select("id")
      .like("name", "QA-AUDIT-%")
      .lt("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());
    for (const row of stale.data ?? []) await db.from("tenants").delete().eq("id", row.id);
  } catch {
    /* best effort */
  }

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

export async function count(db: SupabaseClient, table: string, column: string, value: string): Promise<number> {
  // `*` because join tables (user_roles) have no `id` column.
  const { count: n, error } = await db.from(table).select("*", { count: "exact", head: true }).eq(column, value);
  if (error) throw new Error(`count ${table}.${column} failed: ${error.message}`);
  return n ?? 0;
}

/**
 * Delete the QA tenant and every row it owns. The tenant delete is the cascade
 * under test; the explicit deletes after it are a safety net so a broken
 * cascade cannot leave junk in the production database.
 */
export async function destroyFixtures(fx: QaFixtures): Promise<void> {
  const { db } = adminClient();
  try {
    await db.from("user_roles").delete().eq("tenant_id", fx.tenantId);
    await db.from("tenants").delete().eq("id", fx.tenantId);
  } catch {
    /* fall through to the sweep */
  }
  // Sweep (only matches this fixture's tenant id, so it is inert otherwise).
  await db.from("posts").delete().eq("tenant_id", fx.tenantId);
  await db.from("content_map_items").delete().eq("tenant_id", fx.tenantId);
  await db.from("content_map_imports").delete().eq("tenant_id", fx.tenantId);
  await db.from("brand_profiles").delete().eq("tenant_id", fx.tenantId);
  await db.from("clients").delete().eq("tenant_id", fx.tenantId);
  await db.from("workspaces").delete().eq("tenant_id", fx.tenantId);
  await db.from("tenants").delete().eq("id", fx.tenantId);
  await db.auth.admin.deleteUser(fx.userId).catch(() => undefined);
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
