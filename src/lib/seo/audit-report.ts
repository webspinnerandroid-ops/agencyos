/**
 * Public audit report helpers.
 *
 * `homepageMarkdown` rebuilds a markdown body from a stored homepage crawl
 * (PageAudit) so the existing SEO + AEO/GEO scoring engines can run on it.
 * `brandKeyword` derives the scoring keyword from the audited domain.
 */

export interface PageAuditShape {
  url?: string;
  title?: string;
  metaDescription?: string;
  h1?: string[];
  h2?: string[];
  h3?: string[];
  h4?: string[];
  textPreview?: string;
  wordCount?: number;
  images?: { src?: string; alt?: string | null; hasAlt?: boolean }[];
  internalLinks?: { href?: string; text?: string }[];
  externalLinks?: { href?: string; text?: string }[];
  loadTimeMs?: number | null;
}

/** Brand keyword for content scoring — the domain without the TLD. */
export function brandKeyword(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const parts = host.split(".");
    return parts.length >= 2 ? parts[parts.length - 2] : host;
  } catch {
    return url;
  }
}

/**
 * Rebuild a markdown body from the stored homepage crawl so the existing
 * SEO + AEO/GEO engines can score it. Order keeps real page text first
 * (so "keyword in first 10%" is honest), then appends the structured
 * extras (headings, links, images) which the engines parse as signals.
 */
export function homepageMarkdown(page: PageAuditShape | undefined): string {
  const parts: string[] = [];
  if (!page) return "";
  if (page.h1?.[0]) parts.push(`# ${page.h1[0]}`);
  else if (page.title) parts.push(`# ${page.title}`);
  if (page.title && page.h1?.[0] !== page.title) {
    parts.push(`This page is titled "${page.title}" and describes the business.`);
  }
  for (const para of (page.textPreview ?? "").split(/\n+/).map((p) => p.trim()).filter(Boolean)) {
    parts.push(para);
  }
  for (const h of page.h2 ?? []) parts.push(`## ${h}`);
  for (const h of page.h3 ?? []) parts.push(`### ${h}`);
  for (const h of page.h4 ?? []) parts.push(`#### ${h}`);
  const internal = (page.internalLinks ?? []).slice(0, 8);
  if (internal.length > 0) {
    parts.push(`## Related pages`);
    for (const l of internal) parts.push(`- [${l.text || l.href || "page"}](${l.href || "/"})`);
  }
  const external = (page.externalLinks ?? []).slice(0, 8);
  if (external.length > 0) {
    parts.push(`## Sources`);
    for (const l of external) parts.push(`- [${l.text || l.href || "source"}](${l.href || "#"})`);
  }
  const images = (page.images ?? []).filter((i) => i.src && !/^data:/i.test(i.src)).slice(0, 12);
  if (images.length > 0) {
    parts.push(`## Gallery`);
    for (const img of images) {
      parts.push(`![${img.alt || img.src || "image"}](${img.src})`);
    }
  }
  return parts.join("\n\n");
}
