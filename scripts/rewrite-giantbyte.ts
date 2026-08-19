// Push the stored GiantByte rewrite past the 80 gate. Strategy: start from
// the CURRENT 62-score body (not the tiny original) in TARGETED mode — keeps
// the content, fixes only the failing checks. If targeted still stalls, falls
// back to a full rewrite with targeted=false.
//
// Run: npx vite-node --config vitest.config.ts scripts/rewrite-giantbyte.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

for (const line of readFileSync(join(__dirname, "..", ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
}

import { createClient } from "@supabase/supabase-js";
import { rewriteToPassGate } from "@/lib/seo/rewriter";
import { scoreContent } from "@/lib/seo-scorer";
import { scoreAeoGeo } from "@/lib/aeo-geo";

const POST_ID = "5ddb3c5f-17ce-4e66-819f-90e5134e57c9";
const TENANT_ID = "545ed904-3dc5-47e6-ba59-e9b9443d089d";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

async function main() {
  const { data: post, error } = await supabase
    .from("posts")
    .select("id, title, content")
    .eq("id", POST_ID)
    .maybeSingle();
  if (error || !post) throw new Error(`post fetch failed: ${error?.message}`);

  const c = typeof post.content === "string" ? JSON.parse(post.content) : post.content;
  const currentBody: string = c?.body || "";
  const keyword: string = c?.keyword || c?.seo?.keyword || "";
  const title: string = c?.title || post.title || "";

  console.log("keyword:", keyword);
  console.log("current body chars:", currentBody.length);

  // Show what the current 62 body fails so targeted mode has a target.
  const seoNow = scoreContent({ title, metaDescription: c?.metaDescription ?? "", slug: "", body: currentBody, keyword, internalUrls: [] });
  const aeoNow = scoreAeoGeo({ title, metaDescription: c?.metaDescription ?? "", body: currentBody, keyword, entities: [] });
  console.log("current: SEO=", seoNow.total, "AEO/GEO=", aeoNow.total);
  console.log("failing SEO checks:", seoNow.checks.filter((x) => !x.passed).map((x) => x.id).join(", ") || "(none)");
  console.log("failing AEO/GEO checks:", aeoNow.checks.filter((x) => !x.passed).map((x) => x.id).join(", ") || "(none)");

  // 1) Targeted pass on the current body.
  const targeted = await rewriteToPassGate(
    { text: currentBody, title, keyword, targeted: true },
    { tenantId: TENANT_ID }
  );
  console.log("\n=== TARGETED PASS ===");
  console.log("passed:", targeted.passed, "| attempts:", targeted.attempts.length);
  for (const a of targeted.attempts) {
    console.log(`  attempt ${a.attempt}: SEO=${a.seo?.total ?? "?"} AEO/GEO=${a.aeoGeo?.total ?? "?"} passed=${a.passed}`);
  }
  if (targeted.rewriteError) console.log("rewriteError:", targeted.rewriteError);

  // 2) If targeted didn't clear, one full rewrite pass on the targeted output.
  let result = targeted;
  if (!result.passed) {
    console.log("\n=== FULL REWRITE PASS (from targeted output) ===");
    result = await rewriteToPassGate(
      { text: result.finalBody, title, keyword, targeted: false },
      { tenantId: TENANT_ID }
    );
    for (const a of result.attempts) {
      console.log(`  attempt ${a.attempt}: SEO=${a.seo?.total ?? "?"} AEO/GEO=${a.aeoGeo?.total ?? "?"} passed=${a.passed}`);
    }
    if (result.rewriteError) console.log("rewriteError:", result.rewriteError);
  }

  if (!result.passed) {
    console.log("\nStill did NOT clear the gate — leaving post untouched.");
    process.exit(1);
  }

  const finalBody = result.finalBody;
  const now = new Date().toISOString();
  const patch = {
    title: result.title || title,
    content: {
      ...c,
      type: "blog",
      title: result.title || title,
      body: finalBody,
      keyword: result.keyword,
      metaDescription: c?.metaDescription ?? "",
      seo: {
        score: result.final.seo?.total ?? null,
        total: result.final.seo?.total ?? null,
        grade: result.final.seo?.grade ?? null,
        keyword: result.keyword,
        wordCount: result.final.seo?.wordCount ?? 0,
        checks: result.final.seo?.checks ?? [],
      },
      aeoGeo: {
        score: result.final.aeoGeo?.total ?? null,
        total: result.final.aeoGeo?.total ?? null,
        aeoScore: result.final.aeoGeo?.aeoScore ?? null,
        geoSscore: result.final.aeoGeo?.geoSscore ?? null,
        grade: result.final.aeoGeo?.grade ?? null,
        checks: result.final.aeoGeo?.checks ?? [],
        qaPairs: result.final.aeoGeo?.qaPairs ?? [],
      },
      rewrite: {
        kind: "rewrite",
        passed: result.passed,
        gate: result.gate,
        attempts: result.attempts.length,
        original_seo: result.originalScores.seo,
        original_aeo_geo: result.originalScores.aeoGeo,
        originalBody: (c?.rewrite?.originalBody || currentBody).slice(0, 60000),
        updatedAt: now,
      },
    },
    seo_score: result.final.seo?.total ?? null,
    aeo_geo_score: result.final.aeoGeo?.total ?? null,
  };

  const { error: updErr } = await supabase
    .from("posts")
    .update(patch)
    .eq("id", POST_ID)
    .eq("tenant_id", TENANT_ID);
  if (updErr) throw new Error(`post update failed: ${updErr.message}`);

  console.log("\nSaved passing rewrite to post", POST_ID);
  console.log("Final: SEO=", result.final.seo?.total, "AEO/GEO=", result.final.aeoGeo?.total);
  process.exit(0);
}

main().catch((e) => {
  console.error("fatal:", e?.message || e);
  process.exit(1);
});
