import { describe, expect, it } from "vitest";
import { sniffImageExt } from "./storage";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const GIF_MAGIC = Buffer.from("GIF89a", "latin1");
const WEBP_MAGIC = Buffer.concat([
  Buffer.from("RIFF", "latin1"),
  Buffer.alloc(4),
  Buffer.from("WEBP", "latin1"),
]);

describe("sniffImageExt", () => {
  it("detects PNG magic bytes", () => {
    expect(sniffImageExt(Buffer.concat([PNG_MAGIC, Buffer.alloc(16)]))).toBe(".png");
  });

  it("detects JPEG magic bytes", () => {
    expect(sniffImageExt(Buffer.concat([JPEG_MAGIC, Buffer.alloc(16)]))).toBe(".jpg");
  });

  it("detects GIF magic bytes", () => {
    expect(sniffImageExt(Buffer.concat([GIF_MAGIC, Buffer.alloc(16)]))).toBe(".gif");
  });

  it("detects WebP (RIFF....WEBP)", () => {
    expect(sniffImageExt(Buffer.concat([WEBP_MAGIC, Buffer.alloc(16)]))).toBe(".webp");
  });

  it("detects SVG starting with <svg", () => {
    expect(sniffImageExt(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">', "utf8"))).toBe(
      ".svg"
    );
  });

  it("detects SVG starting with an XML declaration", () => {
    expect(
      sniffImageExt(Buffer.from('<?xml version="1.0"?><svg xmlns="…">', "utf8"))
    ).toBe(".svg");
  });

  it("detects SVG with leading whitespace", () => {
    expect(sniffImageExt(Buffer.from("\n  <svg viewBox=\"0 0 100 100\">", "utf8"))).toBe(".svg");
  });

  it("returns null for empty or tiny buffers", () => {
    expect(sniffImageExt(Buffer.alloc(0))).toBeNull();
    expect(sniffImageExt(Buffer.from("ab", "latin1"))).toBeNull();
  });

  it("returns null for unknown binary content", () => {
    expect(sniffImageExt(Buffer.from("not an image at all", "utf8"))).toBeNull();
  });
});
