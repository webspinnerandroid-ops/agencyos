import { createClient } from "@supabase/supabase-js";
import { getTenantId } from "@/lib/auth";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import { RecentContentList } from "./recent-content";

export const dynamic = "force-dynamic";

interface SP { clientId?: string }

export default async function DashboardPage({ searchParams }: { searchParams?: Promise<SP> }) {
  const params = await (searchParams ?? Promise.resolve<SP>({}));
  const clientId = params.clientId || null;

  // Resolve tenant + workspace in parallel. middleware() now sets a
  // workspace_id cookie, so getCurrentWorkspaceId() is a cookie read and
  // this no longer forces a DB round-trip on first load.
  const [tenantId, workspaceId] = await Promise.all([
    getTenantId().catch(() => null),
    getCurrentWorkspaceId().catch(() => null),
  ]);

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const clientsQuery = tenantId
    ? db.from("clients").select("id, name").eq("tenant_id", tenantId).order("name").limit(200)
    : Promise.resolve({ data: [] });

  // Lightweight list query: posts carry megabytes of base64 image bodies, and
  // dragging those through PostgREST made this page take 20+ seconds and fail
  // intermittently. The list only needs title/type/platform — plain
  // denormalized columns (see migration 021), never JSON-path projections
  // into the content blob. The full body is lazy-loaded per post when the
  // detail modal is opened (see recent-content).
  let postsQuery = db
    .from("posts")
    .select("id, status, ai_generated, scheduled_at, title, type, platform, seo_score")
    .eq("tenant_id", tenantId ?? "")
    .order("created_at", { ascending: false })
    .limit(6);

  let auditsQuery = db
    .from("seo_campaigns")
    .select("id, url, tier_name, tier_price, status, created_at")
    .eq("tenant_id", tenantId ?? "")
    .order("created_at", { ascending: false })
    .limit(6);

  if (clientId) {
    postsQuery = postsQuery.eq("client_id", clientId);
    auditsQuery = auditsQuery.eq("client_id", clientId);
  }

  // apiKeyCount is just an onboarding signal — run it in the same batch so
  // it no longer blocks the page's real data on a separate serial round-trip.
  const apiKeyCountQuery = tenantId
    ? db
        .from("tenant_api_keys")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
    : Promise.resolve({ count: null });

  const [{ data: clients }, { data: posts }, { data: audits }, { count: apiKeyCountResult }] =
    await Promise.all([clientsQuery, postsQuery, auditsQuery, apiKeyCountQuery]);
  const clientsArr = (clients ?? []) as { id: string; name: string }[];
  const apiKeyCount = apiKeyCountResult ?? 0;

  const hasApiKey = apiKeyCount > 0;
  const hasWorkspace = !!workspaceId;
  const hasContent = (posts ?? []).length > 0;
  const showOnboarding = !hasApiKey || !hasWorkspace || !hasContent;

  const steps = [
    {
      title: "Add your AI API key",
      description: "Agency OS uses your own keys to generate content. Add one in Settings → AI.",
      href: "/dashboard/settings/ai",
      done: hasApiKey,
    },
    {
      title: "Create a workspace",
      description: "Organize clients, branding, and knowledge per workspace.",
      href: "/dashboard/workspaces",
      done: hasWorkspace,
    },
    {
      title: "Generate your first post",
      description: "Write a blog post or social caption from your workspace.",
      href: "/dashboard/generate",
      done: hasContent,
    },
  ];

  return (
    <div className="space-y-8">
      {showOnboarding && (
        <section className="rounded-xl border bg-card p-6" aria-label="Getting started">
          <h2 className="text-xl font-semibold tracking-tight">Getting started</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Complete these three steps to start generating content for your clients.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {steps.map((step, i) => (
              <a
                key={step.title}
                href={step.href}
                className={`rounded-lg border p-4 transition-colors ${
                  step.done ? "bg-background border-green-200" : "bg-background hover:border-primary/50"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                      step.done ? "bg-green-100 text-green-700" : "bg-primary text-primary-foreground"
                    }`}
                  >
                    {step.done ? "✓" : i + 1}
                  </span>
                  <span className="font-medium text-sm">{step.title}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-2">{step.description}</p>
                {!step.done && <span className="text-xs text-primary mt-2 inline-block">Start now →</span>}
                {step.done && <span className="text-xs text-green-600 mt-2 inline-block">Done</span>}
              </a>
            ))}
          </div>
        </section>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Overview of your agency activity.</p>
        </div>
        <form method="GET" className="flex items-center gap-2">
          <label htmlFor="clientFilter" className="text-sm text-muted-foreground">Client:</label>
          <select
            id="clientFilter"
            name="clientId"
            defaultValue={clientId ?? ""}
            className="w-56 rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">All Clients</option>
            {clientsArr.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-muted"
          >
            Apply
          </button>
        </form>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <a href="/dashboard/seo/campaigns" className="rounded-lg border bg-card p-6 hover:border-primary/50 transition-all">
          <h3 className="font-semibold">Start a Campaign →</h3>
          <p className="text-sm text-muted-foreground mt-1">Audit a site, pick a tier, launch an isolated campaign.</p>
        </a>
        <a href="/dashboard/generate" className="rounded-lg border bg-card p-6 hover:border-primary/50 transition-all">
          <h3 className="font-semibold">Generate Content →</h3>
          <p className="text-sm text-muted-foreground mt-1">AI blog posts and captions.</p>
        </a>
        <a href="/dashboard/calendar" className="rounded-lg border bg-card p-6 hover:border-primary/50 transition-all">
          <h3 className="font-semibold">Content Calendar →</h3>
          <p className="text-sm text-muted-foreground mt-1">Plan and schedule posts.</p>
        </a>
        <a href="/dashboard/generate-images" className="rounded-lg border bg-card p-6 hover:border-primary/50 transition-all">
          <h3 className="font-semibold">Generate Images →</h3>
          <p className="text-sm text-muted-foreground mt-1">AI images with prompt enhancement.</p>
        </a>
      </div>

      <div className="grid gap-8 lg:grid-cols-2 items-start">
        <div>
          <RecentContentList posts={(posts ?? []) as any} />
        </div>

        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold tracking-tight">Recent SEO Audits</h2>
            <a href="/dashboard/seo/campaigns" className="text-sm text-primary underline hover:underline">View all →</a>
          </div>
          {audits && audits.length > 0 ? (
            <div className="rounded-lg border divide-y">
              {(audits as any[]).map((a) => (
                <div key={a.id} className="flex items-center justify-between p-3 hover:bg-muted/30 transition-colors">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {String(a.url || "").replace(/^https?:\/\//, "").replace(/^www\./, "")}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-muted-foreground">{a.tier_name}</span>
                      <span className={"text-[10px] px-1.5 py-0.5 rounded-full capitalize " + (a.status === "proposed" ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700")}>
                        {a.status}
                      </span>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {a.tier_price == null || a.tier_price === 0 || String(a.tier_name ?? "").toLowerCase().includes("custom")
                      ? "Custom Consult"
                      : "$" + a.tier_price.toLocaleString() + "/mo"}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
              <p className="text-sm">No audits yet.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}