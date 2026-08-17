import { describe, it, expect } from "vitest";
import { deflateRawSync } from "node:zlib";
import { extractDocumentText, mimeTypeForFilename } from "./docx-text";

/** Build a single-entry ZIP (deflate) so the parser can be exercised without a fixture file. */
function buildMinimalDocxZip(documentXml: string): Buffer {
  const name = Buffer.from("word/document.xml", "utf8");
  const content = Buffer.from(documentXml, "utf8");
  const compressed = deflateRawSync(content);

  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(8, 8); // deflate
  localHeader.writeUInt16LE(0, 10);
  localHeader.writeUInt16LE(0, 12);
  localHeader.writeUInt32LE(0, 14); // crc (ignored by parser)
  localHeader.writeUInt32LE(compressed.length, 18);
  localHeader.writeUInt32LE(content.length, 22);
  localHeader.writeUInt16LE(name.length, 26);
  localHeader.writeUInt16LE(0, 28);

  const local = Buffer.concat([localHeader, name, compressed]);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(0, 12);
  central.writeUInt16LE(0, 14);
  central.writeUInt32LE(0, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(0, 42); // local header offset

  const centralDir = Buffer.concat([central, name]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(local.length, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([local, centralDir, eocd]);
}

describe("docx-text", () => {
  it("extracts paragraphs and run text from a DOCX archive", () => {
    const xml =
      '<?xml version="1.0"?><w:document><w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p>' +
      "<w:p><w:r><w:t>World &amp; Co</w:t></w:r></w:p></w:body></w:document>";
    const buf = buildMinimalDocxZip(xml);
    const result = extractDocumentText("brand.docx", "", buf);
    expect(result.extracted).toBe(true);
    expect(result.text).toContain("Hello");
    expect(result.text).toContain("World & Co");
  });

  it("extracts plain text files directly", () => {
    const result = extractDocumentText("notes.txt", "text/plain", Buffer.from("line one\nline two"));
    expect(result.extracted).toBe(true);
    expect(result.text).toContain("line one");
    expect(result.text).toContain("line two");
  });

  it("derives a MIME type from well-known extensions", () => {
    expect(mimeTypeForFilename("Brand Kit.docx")).toContain("openxmlformats");
    expect(mimeTypeForFilename("notes.pdf")).toBe("application/pdf");
    expect(mimeTypeForFilename("unknown.bin")).toBeNull();
  });
});
