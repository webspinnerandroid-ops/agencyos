import { inflateRawSync } from "node:zlib";

/**
 * Dependency-free text extraction for documents uploaded to the knowledge
 * base. DOCX files are ZIP archives; this walks the archive with Node's
 * built-in zlib and pulls the text runs out of `word/document.xml` without
 * adding a parser dependency.
 */

// ---------------------------------------------------------------------------
// ZIP primitives (enough to read a DOCX, which uses deflate or store)
// ---------------------------------------------------------------------------

const SIG_EOCD = 0x06054b50; // end of central directory
const SIG_CD = 0x02014b50; // central directory entry
const SIG_LFH = 0x04034b50; // local file header

function findEndOfCentralDirectory(buf: Buffer): number {
  // EOCD is at the end, preceded by up to 65535 bytes of optional comment.
  const min = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  }
  return -1;
}

interface CentralEntry {
  name: string;
  entryOffset: number;
  method: number;
  compressedSize: number;
}

function readCentralDirectory(buf: Buffer): CentralEntry[] {
  const eocd = findEndOfCentralDirectory(buf);
  if (eocd < 0) return [];
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const entryCount = buf.readUInt16LE(eocd + 10);

  const entries: CentralEntry[] = [];
  let cursor = cdOffset;
  for (let n = 0; n < entryCount; n++) {
    if (cursor + 46 > buf.length || buf.readUInt32LE(cursor) !== SIG_CD) break;
    const method = buf.readUInt16LE(cursor + 10);
    const compressedSize = buf.readUInt32LE(cursor + 20);
    const nameLen = buf.readUInt16LE(cursor + 28);
    const extraLen = buf.readUInt16LE(cursor + 30);
    const commentLen = buf.readUInt16LE(cursor + 32);
    const localOffset = buf.readUInt32LE(cursor + 42);
    const name = buf.toString("utf8", cursor + 46, cursor + 46 + nameLen);
    entries.push({ name, entryOffset: localOffset, method, compressedSize });
    cursor += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readLocalEntry(
  buf: Buffer,
  offset: number,
  compressedSize: number
): Buffer | null {
  if (offset + 30 > buf.length || buf.readUInt32LE(offset) !== SIG_LFH) return null;
  const nameLen = buf.readUInt16LE(offset + 26);
  const extraLen = buf.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + nameLen + extraLen;
  if (dataStart + compressedSize > buf.length) return null;
  return buf.subarray(dataStart, dataStart + compressedSize);
}

function inflateDocxEntry(entry: Buffer, method: number): Buffer {
  if (method === 0) return entry; // stored, no compression
  try {
    return inflateRawSync(entry); // method 8 = deflate
  } catch {
    return entry;
  }
}

// ---------------------------------------------------------------------------
// DOCX XML -> plain text
// ---------------------------------------------------------------------------

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)));
}

function docxXmlToText(xml: string): string {
  // Turn structural elements into whitespace, then keep only <w:t> run text.
  let out = xml
    .replace(/<w:tab\b[^>]*\/?>/g, "\t")
    .replace(/<w:br\b[^>]*\/?>/g, "\n")
    .replace(/<\/w:p>/g, "\n\n");
  out = out.replace(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g, "$1");
  out = out.replace(/<[^>]+>/g, "");
  out = decodeXmlEntities(out);
  return out
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ExtractedDocument {
  text: string;
  /** True when we could actually parse content (vs. only storing bytes). */
  extracted: boolean;
}

/** MIME-type fallback for extensions browsers sometimes report as empty. */
export function mimeTypeForFilename(filename: string): string | null {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const map: Record<string, string> = {
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    doc: "application/msword",
    pdf: "application/pdf",
    txt: "text/plain",
    md: "text/markdown",
    csv: "text/csv",
  };
  return map[ext] ?? null;
}

export function extractDocumentText(
  filename: string,
  mimeType: string,
  buffer: Buffer
): ExtractedDocument {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const mime = mimeType || mimeTypeForFilename(filename) || "";

  // Plain-text family: decode directly.
  if (
    ext === "txt" ||
    ext === "md" ||
    ext === "csv" ||
    mime.startsWith("text/")
  ) {
    const text = buffer.toString("utf8").trim();
    return { text, extracted: text.length > 0 };
  }

  // DOCX: unzip word/document.xml and read the runs.
  if (ext === "docx" || mime.includes("openxmlformats")) {
    const entries = readCentralDirectory(buffer);
    const docEntry = entries.find((e) => e.name === "word/document.xml");
    if (!docEntry) return { text: "", extracted: false };
    const local = readLocalEntry(buffer, docEntry.entryOffset, docEntry.compressedSize);
    if (!local) return { text: "", extracted: false };
    const xml = inflateDocxEntry(local, docEntry.method).toString("utf8");
    const text = docxXmlToText(xml);
    return { text, extracted: text.length > 0 };
  }

  // Everything else (PDF, legacy .doc, etc.) is stored but not parsed.
  return { text: "", extracted: false };
}
