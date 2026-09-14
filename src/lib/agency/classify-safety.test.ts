import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join } from "path";

// ============================================================================
// classify-safety.test.ts — the CI import-graph gate.
//
// docs/email-module-mvp.md §5.1: "the classification module imports no
// mail transport and calls no outreach endpoints. A dedicated integration
// test asserts this statically (import graph check) — it fails CI if a send
// capability becomes reachable from classifier code."
//
// This test walks every source file in src/lib/agency/ (plus the classifier
// Inngest function) and fails if any of them statically references a
// mail-sending module or symbol.
// ============================================================================

const FORBIDDEN_PATTERNS: { pattern: RegExp; why: string }[] = [
  { pattern: /nodemailer/i, why: "SMTP client" },
  { pattern: /from\s+["']@\/lib\/outreach/i, why: "outreach module" },
  { pattern: /sendEmail|sendMail|sendOutreach|transporter\.send/i, why: "send call" },
  { pattern: /RESEND_API_KEY/i, why: "transactional send provider" },
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const AGENCY_DIR = join(__dirname);
const CLASSIFY_FUNCTION = join(
  __dirname,
  "..",
  "inngest",
  "functions",
  "classifyEmails.ts"
);

describe("email module stays read-only (CI gate)", () => {
  const files = walk(AGENCY_DIR).concat(
    existsSync(CLASSIFY_FUNCTION) ? [CLASSIFY_FUNCTION] : []
  );

  it("has files to check (test wiring is intact)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const patternDef of FORBIDDEN_PATTERNS) {
    it(`imports no ${patternDef.why}`, () => {
      const offenders = files.filter((f) => {
        try {
          return patternDef.pattern.test(readFileSync(f, "utf8"));
        } catch {
          return false;
        }
      });
      expect(
        offenders,
        `Read-only violation in: ${offenders.join(", ")}`
      ).toEqual([]);
    });
  }
});
