import { describe, it, expect } from "vitest";
import { cn } from "./utils";

describe("cn (classname utility)", () => {
  it("merges class names", () => {
    expect(cn("px-4", "py-2")).toBe("px-4 py-2");
  });

  it("filters falsy values", () => {
    expect(cn("base", false && "hidden", undefined, null, "")).toBe("base");
  });

  it("resolves tailwind conflicts via twMerge", () => {
    expect(cn("px-4", "px-6")).toBe("px-6");
  });
});