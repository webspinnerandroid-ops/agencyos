import { inngest } from "@/lib/inngest/client";
import { createClient } from "@supabase/supabase-js";
import { analyzeContent } from "@/lib/seo/analyzer";
import { createNotification } from "@/lib/in-app-notifications";

/**
 * Weekly auto-audit of monitored sites — Mondays 09:00 UTC.
 *
 * For every distinct URL in site_audits (mode = 'url'), re-runs the same
 * SEO/AEO/GEO analyzer the dashboard uses and persists a new row, so the
 * Monitored Sites dashboard tracks score trends without manual re-runs.
 * When the combined score changed vs the previous run, a bell notification
 * links back to the site's detail page.
 */
export const autoAuditMonitoredSites = inngest.createFunction(
  {
    id: "auto-audit-monitored-sites",
    name: "Weekly auto-audit of monitored sites",
    triggers: [{ cron: "0 9 * * 1" }], // Mondays 09:00 UTC
  },
  async ({ step }) => {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    const rows = await step.run("fetch-monitored-urls", async () => {
      const { data, error } = await supabase
        .from("site_audits")
        .select("tenant_id, url, created_at")
        .eq("mode", "url")
        .not("url", "is", null)
        .order("created_at", { ascending: false })
        .limit(5000);
      if (error) throw new Error(`Query failed: ${error.message}`);
      return (data ?? []) as { tenant_id: string; url: string | null; created_at: string }[];
    });

    // Latest audit per (tenant, url).
    const seen = new Map<string, { tenant_id: string; url: string }>();
    for (const row of rows) {
      if (!row.url) continue;
      const key = `${row.tenant_id}|${row.url}`;
      if (!seen.has(key)) seen.set(key, { tenant_id: row.tenant_id, url: row.url });
    }
    const sites = [...seen.values()];

    if (sites.length === 0) {
      return { audited: 0, changed: 0, skipped: 0 };
    }

    let audited = 0;
    let changed = 0;
    let skipped = 0;

    for (const site of sites) {
      await step.run(`audit-${site.tenant_id}-${site.url}`, async () => {
        const prev = await supabase
          .from("site_audits")
          .select("seo_score, aeo_score, geo_score")
          .eq("tenant_id", site.tenant_id)
          .eq("url", site.url)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const prevScores = prev.data as { seo_score: number | null; aeo_score: number | null; geo_score: number | null } | null;

        let result;
        try {
          result = await analyzeContent({ url: site.url });
        } catch (err) {
          skipped++;
          console.warn(
            `[autoAuditMonitoredSites] analyze failed for ${site.url}:`,
            (err as Error).message
          );
          return;
        }

        const failed = [
          ...(result.seo?.checks ?? []),
          ...(result.aeoGeo?.checks ?? []),
        ].filter((c) => !c.passed).length;

        const { error: insertErr } = await supabase.from("site_audits").insert({
          tenant_id: site.tenant_id,
          mode: "url",
          url: result.url ?? site.url,
          title: result.title.slice(0, 300),
          keyword: result.keyword,
          seo_score: result.seo?.total ?? null,
          aeo_score: result.aeoGeo?.aeoScore ?? null,
          geo_score: result.aeoGeo?.geoSscore ?? null,
          word_count: result.wordCount,
          issues: failed,
          checks_json: {
            seo: result.seo?.checks ?? [],
            aeoGeo: result.aeoGeo?.checks ?? [],
          },
          fetched: result.fetched ?? null,
          fetch_error: result.fetchError?.slice(0, 500) ?? null,
        });
        if (insertErr) {
          skipped++;
          console.warn(`[autoAuditMonitoredSites] insert failed for ${site.url}:`, insertErr.message);
          return;
        }
        audited++;

        const prevTotal = prevScores
          ? (prevScores.seo_score ?? 0) + (prevScores.aeo_score ?? 0) + (prevScores.geo_score ?? 0)
          : null;
        const newTotal =
          (result.seo?.total ?? 0) + (result.aeoGeo?.aeoScore ?? 0) + (result.aeoGeo?.geoSscore ?? 0);

        if (prevTotal == null || newTotal !== prevTotal) {
          changed++;
          await createNotification({
            tenantId: site.tenant_id,
            kind: "info",
            title: "Weekly audit complete",
            body:
              prevTotal == null
                ? `${site.url} — first audit: SEO ${result.seo?.total ?? "—"} / AEO ${result.aeoGeo?.aeoScore ?? "—"} / GEO ${result.aeoGeo?.geoSscore ?? "—"}.`
                : `${site.url} — combined score ${prevTotal} → ${newTotal} (${newTotal - prevTotal >= 0 ? "+" : ""}${newTotal - prevTotal}) since last week's audit.`,
            link: `/dashboard/seo/sites?url=${encodeURIComponent(site.url)}`,
            groupKey: `site-audit:${site.url}`,
          });
        }
      });
    }

    return { audited, changed, skipped };
  }
);
