// scripts/manual-traffic-sync.cjs
// One-off manual run of the syncSiteMetrics Inngest job: pulls real GA4 +
// Search Console daily metrics for every connected tenant into
// traffic_snapshots. Mirrors src/lib/inngest/functions/syncSiteMetrics.ts.
// Usage: cd agency-os && set -a && . ./.env.local && node scripts/manual-traffic-sync.cjs
const CryptoJS = require("crypto-js");
const { createClient } = require("@supabase/supabase-js");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

function decrypt(hex) {
  const key = CryptoJS.enc.Hex.parse(process.env.ENCRYPTION_KEY);
  const dec = CryptoJS.AES.decrypt(
    { ciphertext: CryptoJS.enc.Hex.parse(hex.substring(32)) },
    key,
    { iv: CryptoJS.enc.Hex.parse(hex.substring(0, 32)), mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }
  );
  return dec.toString(CryptoJS.enc.Utf8);
}

function dateNDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

async function getAccessToken(conn) {
  const bundle = JSON.parse(decrypt(conn.encrypted_token));
  if (bundle.expires_at && bundle.expires_at > Math.floor(Date.now() / 1000) + 60 && bundle.access_token) {
    return { accessToken: bundle.access_token, fresh: null };
  }
  if (!bundle.refresh_token) throw new Error("no refresh token");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: bundle.refresh_token,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });
  const fresh = await res.json();
  if (!fresh.access_token) throw new Error("refresh failed: " + JSON.stringify(fresh).slice(0, 120));
  if (!fresh.refresh_token) fresh.refresh_token = bundle.refresh_token;
  const freshBundle = JSON.stringify(fresh);
  return { accessToken: fresh.access_token, fresh };
}

async function gaDaily(accessToken, propertyId, days = 90) {
  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`,
    { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ dateRanges: [{ startDate: dateNDaysAgo(days), endDate: "today" }],
        dimensions: [{ name: "date" }],
        metrics: [{ name: "sessions" }, { name: "totalUsers" }, { name: "screenPageViews" }, { name: "engagementRate" }],
        keepEmptyRows: true }),
      signal: AbortSignal.timeout(30_000) }
  );
  const text = await res.text();
  const data = JSON.parse(text || "{}");
  if (!res.ok) throw new Error(data.error?.message ?? `GA4 ${res.status}`);
  return (data.rows ?? []).map((row) => {
    const raw = row.dimensionValues?.[0]?.value ?? "";
    const date = raw.length === 8 ? `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}` : raw;
    const num = (i) => Number(row.metricValues?.[i]?.value ?? 0);
    return { date, sessions: num(0), users: num(1), pageviews: num(2), engagementRate: num(3) };
  });
}

async function scDaily(accessToken, siteUrl, days = 90) {
  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ startDate: dateNDaysAgo(days), endDate: "today", dimensions: ["date"], rowLimit: 60 }),
      signal: AbortSignal.timeout(30_000) }
  );
  const text = await res.text();
  const data = JSON.parse(text || "{}");
  if (!res.ok) throw new Error(data.error?.message ?? `SC ${res.status}`);
  return (data.rows ?? []).map((row) => ({
    date: row.keys?.[0] ?? "", clicks: row.clicks ?? 0, impressions: row.impressions ?? 0,
    ctr: row.ctr ?? 0, position: row.position ?? 0,
  }));
}

(async () => {
  const { data: connections, error } = await sb
    .from("tenant_connections")
    .select("*")
    .not("selected_resource", "is", null)
    .eq("connected", true)
    .limit(500);
  if (error) throw new Error(error.message);
  console.log(`connections with resources: ${connections.length}`);
  let updated = 0, failed = 0;
  for (const conn of connections) {
    try {
      const { accessToken, fresh } = await getAccessToken(conn);
      if (fresh) {
        // Same encrypt as src/lib/encryption.ts: random IV + AES-256-CBC
        const iv = CryptoJS.lib.WordArray.random(16);
        const enc = CryptoJS.AES.encrypt(JSON.stringify(fresh), CryptoJS.enc.Hex.parse(process.env.ENCRYPTION_KEY), { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 });
        const proper = iv.toString(CryptoJS.enc.Hex) + enc.ciphertext.toString(CryptoJS.enc.Hex);
        await sb.from("tenant_connections").update({ encrypted_token: proper }).eq("id", conn.id);
      }
      const resource = conn.selected_resource;
      const rows = conn.provider === "google_analytics"
        ? (await gaDaily(accessToken, resource)).map((r) => ({ tenant_id: conn.tenant_id, provider: "google_analytics", resource, metric_date: r.date, sessions: r.sessions, users: r.users, pageviews: r.pageviews, engagement_rate: r.engagementRate }))
        : (await scDaily(accessToken, resource)).map((r) => ({ tenant_id: conn.tenant_id, provider: "search_console", resource, metric_date: r.date, clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position }));
      if (rows.length === 0) { console.log(`  ${conn.provider}: no rows`); continue; }
      const { error: uerr } = await sb.from("traffic_snapshots").upsert(rows, { onConflict: "tenant_id,provider,metric_date" });
      if (uerr) throw new Error(uerr.message);
      await sb.from("tenant_connections").update({ last_synced_at: new Date().toISOString() }).eq("id", conn.id);
      updated += rows.length;
      console.log(`  ${conn.provider} (${resource.slice(0, 40)}): ${rows.length} days`);
    } catch (e) {
      failed += 1;
      console.log(`  FAIL ${conn.provider}: ${e.message.slice(0, 140)}`);
    }
  }
  console.log(`DONE: ${updated} rows upserted, ${failed} connection(s) failed`);
})();
