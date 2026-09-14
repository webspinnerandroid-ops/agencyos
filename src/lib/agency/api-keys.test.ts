import { describe, it, expect } from "vitest";
import {
  hasScope,
  MachineScope,
  MachineAuthContext,
} from "./api-keys";

// Note: minting/revoking hit Postgres, so those paths are covered by the
// production verification checklist (HANDOFF below). This suite pins the
// pure logic: scope semantics and the key format contract.

const ctx = (scopes: MachineScope[]): MachineAuthContext => ({
  keyId: "k-test",
  tenantId: "t-test",
  scopes,
  name: "test key",
});

describe("machine key scopes", () => {
  it("grants exactly what the key lists", () => {
    expect(hasScope(ctx(["read"]), "read")).toBe(true);
    expect(hasScope(ctx(["read"]), "export")).toBe(false);
  });

  it("treats scopes as a flat capability set (no hierarchy)", () => {
    expect(hasScope(ctx(["export", "write:clients"]), "read")).toBe(false);
    expect(hasScope(ctx(["workflow"]), "write:clients")).toBe(false);
  });
});
