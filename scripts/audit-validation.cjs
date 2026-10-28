#!/usr/bin/env node
/**
 * audit-validation.cjs
 *
 * Ratchet for request-body validation coverage.
 *
 * 90 of the write routes still do `await request.json()` and destructure the
 * result, which accepts any shape, any type, and any size. Migrating all of
 * them at once is a rewrite; migrating a route FAMILY at a time is not. This
 * script is what stops the number from quietly growing while that happens:
 *
 *   - `unvalidated` must not increase
 *   - `validated` must not decrease
 *
 * Both directions require deliberately editing BASELINE below, so a new route
 * without a schema fails CI instead of joining the backlog silently.
 *
 * A route counts as validated when it reads the body through
 * `parseJsonBody()` (src/lib/api-validate.ts) or calls `.safeParse(...)` on the
 * body itself.
 *
 * Usage: node scripts/audit-validation.cjs [--json]
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const API = path.join(ROOT, "src", "app", "api");

/**
 * Current state. Lower `unvalidated` and raise `validated` as
 * families migrate — never the other way round.
 *
 * Migrated so far: clients + posts (batch 1), content-map + asset folders
 * (batch 2), notifications + read-link (batch 3), posts rescore/regenerate +
 * the publish family (batch 4), the sequences family (batch 5), the auth
 * token family — 2FA verify/disable + resend-confirmation (batch 6), the
 * media-assets reassign/duplicate family (batch 7).
 */
const BASELINE = {
  unvalidated: 71,
  validated: 23,
};

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.name === "route.ts") out.push(p);
  }
  return out;
}

const validated = [];
const unvalidated = [];

for (const file of walk(API)) {
  const src = fs.readFileSync(file, "utf8");
  const writes = /\bexport async function (POST|PATCH|PUT)\b/.test(src);
  if (!writes) continue;

  const readsBody =
    /request\.json\(\)/.test(src) || /parseJsonBody\(/.test(src);
  if (!readsBody) continue;

  const rel = path.relative(ROOT, file).replace(/\\/g, "/");
  if (/parseJsonBody\(|\.safeParse\(/.test(src)) validated.push(rel);
  else unvalidated.push(rel);
}

const report = {
  validated: validated.length,
  unvalidated: unvalidated.length,
  baseline: BASELINE,
  unvalidatedFiles: unvalidated.sort(),
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

console.log(
  `Body validation — validated: ${validated.length}/${validated.length + unvalidated.length} write routes ` +
    `(baseline: ${BASELINE.validated} validated, ${BASELINE.unvalidated} unvalidated)`
);

const problems = [];
if (unvalidated.length > BASELINE.unvalidated) {
  problems.push(
    `${unvalidated.length - BASELINE.unvalidated} new unvalidated write route(s) — ` +
      `read the body through parseJsonBody() with a schema in src/lib/validations.ts`
  );
}
if (validated.length < BASELINE.validated) {
  problems.push(
    `${BASELINE.validated - validated.length} route(s) lost their validation — ` +
      `if this was a deletion, lower BASELINE.validated in scripts/audit-validation.cjs`
  );
}

if (problems.length > 0) {
  console.error("\nFAIL:");
  for (const p of problems) console.error(`- ${p}`);
  if (unvalidated.length > BASELINE.unvalidated) {
    console.error("\nUnvalidated write routes:");
    for (const f of report.unvalidatedFiles) console.error(`- ${f}`);
  }
  process.exit(1);
}

if (unvalidated.length < BASELINE.unvalidated) {
  console.log(
    `Improved: ${BASELINE.unvalidated - unvalidated.length} route(s) now validate. ` +
      `Update BASELINE in scripts/audit-validation.cjs to lock the gain in.`
  );
}
process.exit(0);
