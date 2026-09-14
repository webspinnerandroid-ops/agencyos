import Link from "next/link";
import { getTenantId } from "@/lib/auth";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import { createServiceClient } from "@/lib/supabase/server";
import { scoreBadgeClass } from "@/lib/seo-scorer";
import { buildAnswerFaqSchema, dedupeEntries } from "@/lib/answer-library";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Answer Library",
  description:
    "Every question your content answers, ready for AI answer engines to cite — with copyable FAQPage schema.",
};

interface QaEntry {
  q: string;
  a: string;
  postId: string;
  postTitle: string;
  slug: string | null;
  clientId: string | null;
  clientName: string | null;
  aeoGeoScore: number | null;
  status: string;
}

export default async function AnswerLibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string }>;
}) {
  const params = await searchParams;
  const clientIdFilter = params.clientId ?? "";

  // The page shell still guards unauthenticated access, but never throw on a
  // missing tenant — render the empty state instead.
  const entries: QaEntry[] = [];
  let clients: { id: string; name: string }[] = [];
  let loadError: string | null = null;

  try {
    const tenantId = await getTenantId();
    const workspaceId = await getCurrentWorkspaceId().catch(() => null);
    const supabase = await createServiceClient();

    const clientsRes = await supabase
      .from("clients")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .order("name");
    clients = clientsRes.data ?? [];

    let query = supabase
      .from("posts")
      .select("id, content, aeo_geo_score, status, client_id, clients(name)")
      .eq("tenant_id", tenantId)
      .order("scheduled_at", { ascending: false, nullsFirst: false })
      .limit(300);
    if (workspaceId) query = query.eq("workspace_id", workspaceId);
    if (clientIdFilter) query = query.eq("client_id", clientIdFilter);

    const { data: posts, error } = await query;
    if (error) throw new Error(error.message);

    for (const row of posts ?? []) {
      const c = (row.content ?? {}) as {
        type?: string;
        title?: string;
        slug?: string;
        aeoGeo?: { qaPairs?: { q: string; a: string }[] };
      };
      if (c.type !== "blog") continue;
      const clientJoin = row.clients as
        | { name?: string }
        | { name?: string }[]
        | null;
      const rowClientName = Array.isArray(clientJoin)
        ? clientJoin[0]?.name ?? null
        : clientJoin?.name ?? null;
      const pairs = c.aeoGeo?.qaPairs ?? [];
      for (const p of pairs) {
        if (!p?.q || !p?.a) continue;
        entries.push({
          q: p.q,
          a: p.a,
          postId: row.id,
          postTitle: c.title || "Untitled post",
          slug: c.slug ?? null,
          clientId: row.client_id ?? null,
          clientName: rowClientName,
          aeoGeoScore:
            typeof row.aeo_geo_score === "number" ? row.aeo_geo_score : null,
          status: row.status ?? "draft",
        });
      }
    }
    // Most recent post first, then question order within the post.
    entries.reverse();

    // Collapse the same question asked across posts — keep the best-scored
    // answer, then order the library score-desc for a deterministic listing.
    const scoreByPost = new Map<string, number>();
    for (const row of posts ?? []) {
      scoreByPost.set(
        row.id,
        typeof row.aeo_geo_score === "number" ? row.aeo_geo_score : 0
      );
    }
    const deduped = dedupeEntries(entries, (postId) => scoreByPost.get(postId) ?? 0);
    entries.length = 0;
    entries.push(...deduped);
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Failed to load the library";
  }

  const schemaJson = buildAnswerFaqSchema(entries);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Answer Library</h1>
          <p className="text-muted-foreground mt-1 max-w-2xl">
            Every question your content answers, extracted from your posts —
            the raw material AI answer engines look for.{" "}
            <span className="text-xs">
              AI-estimated readiness, not a guarantee of citation.
            </span>
          </p>
        </div>
        <Link
          href="/dashboard/generate"
          className="text-sm text-primary underline hover:no-underline"
        >
          Generate more →
        </Link>
      </div>

      {/* Filters */}
      <form className="flex flex-wrap items-end gap-3" action="/dashboard/answer-library">
        <div className="space-y-1">
          <label htmlFor="clientId" className="text-xs font-medium">
            Client
          </label>
          <select
            id="clientId"
            name="clientId"
            defaultValue={clientIdFilter}
            className="w-56 rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">All clients</option>
            {clients.map((cl) => (
              <option key={cl.id} value={cl.id}>
                {cl.name}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="rounded-md border px-3 py-2 text-sm hover:bg-muted"
        >
          Apply
        </button>
        <span className="text-xs text-muted-foreground ml-auto">
          {entries.length} Q&A pair{entries.length === 1 ? "" : "s"}
        </span>
      </form>

      {loadError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {loadError}
        </div>
      )}

      {/* FAQPage schema — generated from the filtered entries, copy-ready */}
      {entries.length > 0 && (
        <details className="rounded-md border p-3">
          <summary className="cursor-pointer text-xs font-semibold">
            FAQPage JSON-LD for this library
            <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-muted font-normal">
              {entries.length} question{entries.length === 1 ? "" : "s"}
            </span>
          </summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/40 p-3 text-[10px] text-muted-foreground">
            {schemaJson}
          </pre>
          <p className="mt-1.5 text-[10px] text-muted-foreground">
            Embed on any page to declare these answers as FAQPage structured
            data — pairs with the per-post schema shipped on publish.
          </p>
        </details>
      )}

      {/* The library itself — grouped by source post */}
      {entries.length === 0 && !loadError ? (
        <div className="rounded-md border bg-muted/30 p-8 text-center">
          <p className="text-sm font-medium">No Q&A pairs yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Posts generated with the AEO/GEO engine contribute their question→
            answer pairs here automatically. Generate a post with an FAQ or
            question headings and it will fill this library.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {groupByPost(entries).map((group) => (
            <div key={group.postId} className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold">{group.postTitle}</h2>
                {group.aeoGeoScore != null && (
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${scoreBadgeClass(group.aeoGeoScore)}`}
                  >
                    AEO/GEO {group.aeoGeoScore}/100
                  </span>
                )}
                {group.clientName && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                    {group.clientName}
                  </span>
                )}
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">
                  {group.status}
                </span>
                <Link
                  href={`/dashboard/posts?post=${group.postId}`}
                  className="ml-auto text-xs text-primary underline hover:no-underline"
                >
                  View post →
                </Link>
              </div>
              <ul className="space-y-2">
                {group.pairs.map((p, i) => (
                  <li
                    key={i}
                    className="rounded-md border bg-card p-3 space-y-1"
                  >
                    <p className="text-sm font-medium">Q: {p.q}</p>
                    <p className="text-sm text-muted-foreground">A: {p.a}</p>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface Group {
  postId: string;
  postTitle: string;
  clientId: string | null;
  clientName: string | null;
  aeoGeoScore: number | null;
  status: string;
  pairs: { q: string; a: string }[];
}

function groupByPost(entries: QaEntry[]): Group[] {
  const groups = new Map<string, Group>();
  for (const e of entries) {
    let g = groups.get(e.postId);
    if (!g) {
      g = {
        postId: e.postId,
        postTitle: e.postTitle,
        clientId: e.clientId,
        clientName: e.clientName,
        aeoGeoScore: e.aeoGeoScore,
        status: e.status,
        pairs: [],
      };
      groups.set(e.postId, g);
    }
    g.pairs.push({ q: e.q, a: e.a });
  }
  return [...groups.values()];
}
