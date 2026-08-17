import { describe, it, expect } from "vitest";
import { deflateRawSync } from "node:zlib";
import { extractPdfText } from "./pdf-text";

/** Build a minimal single-page PDF whose content stream is FlateDecode-compressed. */
function buildMinimalPdf(contentStream: string): Buffer {
  const compressed = deflateRawSync(Buffer.from(contentStream, "latin1"));
  const pdf = [
    "%PDF-1.4",
    "1 0 obj",
    "<< /Type /Catalog /Pages 2 0 R >>",
    "endobj",
    "2 0 obj",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "endobj",
    "3 0 obj",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>",
    "endobj",
    "4 0 obj",
    `<< /Length ${compressed.length} /Filter /FlateDecode >>`,
    "stream",
    "",
  ]
    .join("\n")
    .replace("stream\n\n", "stream\n");
  const body = Buffer.from(pdf, "latin1");
  const streamData = Buffer.concat([
    body,
    compressed,
    Buffer.from("\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n", "latin1"),
  ]);
  return streamData;
}

describe("pdf-text", () => {
  it("extracts text from a FlateDecode content stream with Tj", () => {
    const buf = buildMinimalPdf("BT /F1 12 Tf (Hello PDF world) Tj ET");
    const result = extractPdfText(buf);
    expect(result.extracted).toBe(true);
    expect(result.text).toContain("Hello PDF world");
  });

  it("extracts text from TJ arrays with escapes", () => {
    const buf = buildMinimalPdf("BT [(Brand) ( Kit) (\\050v2\\051)] TJ ET");
    const result = extractPdfText(buf);
    expect(result.text).toContain("Brand");
    expect(result.text).toContain("Kit");
  });

  it("returns extracted=false for a scanned/image-only PDF", () => {
    const buf = buildMinimalPdf("BT /F1 12 Tf 0 0 Td ET"); // no text-showing op
    const result = extractPdfText(buf);
    expect(result.extracted).toBe(false);
    expect(result.text).toBe("");
  });
});
