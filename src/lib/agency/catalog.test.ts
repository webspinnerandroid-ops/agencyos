import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

// ============================================================================
// catalog.test.ts — the catalog is "the system's brain" (plan 0.3 / ADR-004),
// so CI validates every catalog file structurally against the schema's rules.
// A tiny hand-rolled check (no new YAML dependency): parse the flat
// `key: value` shape our catalog uses and assert required keys/enums.
// ============================================================================

const CATALOG_DIR = join(__dirname, "..", "..", "..", "catalog");

const VALID_SUBSYSTEMS = [
  "agency_os_workspace",
  "agency_os_seo",
  "agency_os_cms",
  "freecms_repo",
  "stripe",
  "docusign",
];
const REQUIRED_KEYS = ["service", "required_fields", "workflow", "documents"];
const VALID_WORKFLOWS = ["onboard_client"];

function parseFlatYaml(text: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  let currentKey: string | null = null;
  let listItems: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("- ")) {
      if (currentKey) listItems.push(line.slice(2).trim());
      continue;
    }
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    if (currentKey && listItems.length > 0) {
      out[currentKey] = listItems;
      listItems = [];
    }
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (value === "") {
      currentKey = key;
    } else if (value.startsWith("[") && value.endsWith("]")) {
      // Inline flow list: [a, b, c]
      out[key] = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      currentKey = null;
    } else {
      out[key] = value.replace(/^["'>]|["']$/g, "");
      currentKey = null;
    }
  }
  if (currentKey && listItems.length > 0) out[currentKey] = listItems;
  return out;
}

describe("service catalog (ADR-004)", () => {
  const files = readdirSync(CATALOG_DIR).filter((f) => f.endsWith(".yaml"));

  it("defines at least two services", () => {
    expect(files.length).toBeGreaterThanOrEqual(2);
  });

  for (const file of files) {
    it(`${file} is a valid catalog entry`, () => {
      const doc = parseFlatYaml(readFileSync(join(CATALOG_DIR, file), "utf8"));
      for (const key of REQUIRED_KEYS) {
        expect(doc[key], `${file} missing ${key}`).toBeDefined();
      }
      expect(String(doc.service)).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(VALID_WORKFLOWS).toContain(String(doc.workflow));

      const subsystems = Array.isArray(doc.provision_subsystems)
        ? doc.provision_subsystems
        : [];
      for (const s of subsystems) {
        expect(VALID_SUBSYSTEMS, `${file}: unknown subsystem ${s}`).toContain(s);
      }

      const fields = Array.isArray(doc.required_fields) ? doc.required_fields : [];
      expect(fields.length, `${file}: required_fields must not be empty`).toBeGreaterThan(0);
    });
  }
});
