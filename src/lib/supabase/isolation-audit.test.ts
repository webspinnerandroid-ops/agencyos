import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const SCRIPT = path.join(__dirname, "..", "..", "..", "scripts", "audit-tenant-scope.cjs");
const ROOT = path.join(__dirname, "..", "..", "..");

/**
 * Source-tree isolation audit.
 *
 * Runs scripts/audit-tenant-scope.cjs against the real src/ tree and fails
 * if any service-role query on a tenant-scoped table is missing a tenant_id
 * filter (outside the reviewed allowlist). This is the regression guard for
 * multi-tenant isolation: adding a new unscoped .from("posts") style query
 * anywhere in src/ will fail this test until it is scoped (or explicitly
 * reviewed and allowlisted with a reason).
 */
describe("tenant isolation audit", () => {
  let output: string;
  let exitCode: number;
  let flagged: string[];

  beforeAll(() => {
    try {
      output = execFileSync("node", [SCRIPT], {
        encoding: "utf-8",
        cwd: ROOT,
      });
      exitCode = 0;
    } catch (err: unknown) {
      const e = err as { stdout?: unknown; message?: string; status?: number };
      output = e.stdout ? String(e.stdout) : String(e.message);
      exitCode = e.status ?? 1;
    }
    flagged = output
      .split("\n")
      .filter((l) => l.startsWith("- "))
      .map((l) => l.slice(2));
  });

  it("finds no un-scoped service-role queries on tenant tables", () => {
    expect(exitCode, `audit failed:\n${output}`).toBe(0);
  });

  it("reports zero flagged chains", () => {
    expect(flagged, `flagged chains:\n${flagged.join("\n")}`).toHaveLength(0);
  });
});

describe("audit script catches leaks (positive control)", () => {
  let tmpDir: string;

  beforeAll(() => {
    // A temp src/ tree containing one intentionally-unscoped service-role
    // query on a tenant table. The audit MUST flag it — this proves the
    // guard actually detects leaks instead of passing vacuously.
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "isolation-control-"));
    const file = path.join(tmpDir, "leaky.ts");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      [
        "import { createClient } from \"@supabase/supabase-js\";",
        "export async function leak() {",
        "  const supabase = createClient(",
        "    process.env.NEXT_PUBLIC_SUPABASE_URL!,",
        "    process.env.SUPABASE_SERVICE_ROLE_KEY!",
        "  );",
        "  return supabase.from(\"posts\").select(\"*\").eq(\"id\", \"p1\");",
        "}",
        "",
      ].join("\n")
    );
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("flags the unscoped chain", () => {
    // The script scans <repo>/src — so we point it at the temp tree by
    // invoking it with a shim: the script resolves src relative to itself.
    // Instead, copy the script next to the temp tree and patch SRC there.
    const scriptCopy = path.join(tmpDir, "audit.cjs");
    const original = fs.readFileSync(SCRIPT, "utf-8");
    const patched = original
      .replace('const ROOT = path.join(__dirname, "..");', 'const ROOT = __dirname;')
      .replace('const SRC = path.join(ROOT, "src");', "const SRC = __dirname;");
    fs.writeFileSync(scriptCopy, patched);

    let out = "";
    let code = 0;
    try {
      out = execFileSync("node", [scriptCopy], { encoding: "utf-8", cwd: tmpDir });
    } catch (err: unknown) {
      const e = err as { stdout?: unknown; message?: string; status?: number };
      out = e.stdout ? String(e.stdout) : String(e.message);
      code = e.status ?? 1;
    }
    expect(code).not.toBe(0);
    expect(out).toContain("leaky.ts");
    expect(out).toContain("posts");
  });
});
