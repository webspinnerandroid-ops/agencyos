/**
 * Blog image helpers — pure functions for capping, injecting, and spacing
 * generated images inside a blog body. Kept free of server/DB imports so they
 * are unit-testable in isolation.
 */

/**
 * Max images per post — cost guardrail. 1 featured + up to 2 inline, so a
 * post never burns unbounded image-generation budget and images stay spaced
 * out (never a wall of images).
 */
export const MAX_BLOG_IMAGES = 3;

export interface BlogImageSpec {
  prompt: string;
  placement: "featured" | "inline";
  sectionTitle: string;
  description: string;
}

export interface GeneratedBlogImage {
  spec: BlogImageSpec;
  url: string;
  /** media_assets row id — lets the post flow stamp SEO/AEO/GEO scores onto the asset. */
  assetId?: string | null;
}

/**
 * Selects which image specs to generate: at most MAX_BLOG_IMAGES total, and
 * never two images for the same section (that is what caused stacked images —
 * two specs targeting one H2 heading). First occurrence wins, featured first.
 */
export function selectBlogImageSpecs(
  specs: BlogImageSpec[],
  limit: number = MAX_BLOG_IMAGES
): BlogImageSpec[] {
  if (limit <= 0) return [];
  const seen = new Set<string>();
  const selected: BlogImageSpec[] = [];
  for (const spec of specs) {
    const key =
      spec.placement === "featured"
        ? "__featured__"
        : spec.sectionTitle || spec.prompt;
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(spec);
    if (selected.length >= limit) break;
  }
  // Featured image always goes first, even if the model listed it later.
  return selected.sort((a, b) =>
    (a.placement === "featured" ? 0 : 1) - (b.placement === "featured" ? 0 : 1)
  );
}

export interface BodyImagePlaceholder {
  /** 1-based index from the placeholder token (IMAGE_URL_1 → 1). */
  index: number;
  /** The markdown alt text the model wrote next to the placeholder. */
  alt: string;
}

/**
 * Finds every image placeholder (![alt](IMAGE_URL_N)) the model embedded in
 * the body, in document order. The body itself is the ground truth for where
 * images belong — when the structured `images` array is lost (e.g. a truncated
 * JSON response where the repair salvaged the body but dropped the tail), the
 * placeholders still tell us how many images to generate and what each shows.
 */
export function extractImagePlaceholders(body: string): BodyImagePlaceholder[] {
  const out: BodyImagePlaceholder[] = [];
  const re = /!\[([^\]]*)\]\(\s*IMAGE_URL_?(\d+)\s*\)/gi;
  for (const match of body.matchAll(re)) {
    out.push({ index: parseInt(match[2], 10), alt: match[1]?.trim() ?? "" });
  }
  return out;
}

/**
 * Removes any placeholder tokens (![alt](IMAGE_URL_N)) left in the body after
 * image substitution — e.g. when the model wrote more placeholders than images
 * were generated. A literal "IMAGE_URL_2" must never reach a published post.
 */
export function stripLeftoverPlaceholders(body: string): string {
  const out = body.replace(/!\[[^\]]*\]\(\s*IMAGE_URL_?\d+\s*\)/gi, "");
  // Collapse the blank lines left behind into a single separator.
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Replaces image placeholders (![alt](IMAGE_URL_N)) in the body with the real
 * generated URLs. Falls back to inserting inline images after the first
 * paragraph of their H2 section. A final spacing pass guarantees no two images
 * are ever adjacent — each stays separated by at least one paragraph of text.
 * Any placeholder that couldn't be matched is stripped so no literal
 * "IMAGE_URL_N" text can survive into a saved post.
 */
export function injectImagesIntoBody(
  body: string,
  images: GeneratedBlogImage[]
): string {
  let out = body;

  images.forEach((img, index) => {
    const alt = img.spec.description || img.spec.sectionTitle || "Image";
    const markdown = `![${alt}](${img.url})`;

    // 1. Replace an explicit placeholder (1-based like IMAGE_URL_1).
    // Matches the whole ![alt](IMAGE_URL_N) so the alt text is preserved.
    const placeholder = new RegExp(
      `!\\[[^\\]]*\\]\\(\\s*IMAGE_URL_?${index + 1}\\s*\\)`,
      "i"
    );
    if (placeholder.test(out)) {
      out = out.replace(placeholder, markdown);
      return;
    }

    // 2. Inline: insert AFTER the first paragraph of its H2 section, so the
    // image is embedded mid-section rather than stacked at the heading.
    if (img.spec.placement === "inline" && img.spec.sectionTitle) {
      const inserted = insertAfterSectionParagraph(
        out,
        img.spec.sectionTitle,
        markdown
      );
      if (inserted) {
        out = inserted;
        return;
      }
      // Section heading not found — fall through to append.
    }

    // 3. Featured: prepend to the top of the body.
    if (img.spec.placement === "featured") {
      out = `${markdown}\n\n${out}`;
      return;
    }

    // 4. Last resort: append at the end.
    out = `${out}\n\n${markdown}`;
  });

  return stripLeftoverPlaceholders(spaceOutImages(out));
}

/**
 * Inserts `markdown` after the first paragraph that follows an H2 heading
 * matching `sectionTitle`. Returns the new body, or null if the heading (or a
 * paragraph after it) doesn't exist.
 */
export function insertAfterSectionParagraph(
  body: string,
  sectionTitle: string,
  markdown: string
): string | null {
  const headingRe = new RegExp(
    `(^|\\n)##\\s+${escapeRegExp(sectionTitle)}(\\n|$)`,
    "i"
  );
  const headingMatch = body.match(headingRe);
  if (!headingMatch || headingMatch.index === undefined) return null;

  const afterHeading = body.slice(headingMatch.index + headingMatch[0].length);
  // The first paragraph runs until a blank line or the next heading.
  const paraEnd = afterHeading.search(/\n\s*\n|\n(?=##\s)/);
  if (paraEnd === -1) return null;

  const insertAt =
    headingMatch.index + headingMatch[0].length + paraEnd;
  return (
    body.slice(0, insertAt) +
    `\n\n${markdown}\n\n` +
    body.slice(insertAt).replace(/^\s*/, "")
  );
}

/**
 * Guarantees images are never adjacent. Blank-line-separated blocks are
 * walked in order; when an image would sit directly after another image, it
 * is deferred and re-anchored after the NEXT text block (paragraph, list, or
 * heading) — at most one deferred image per text block, so each image gets
 * its own paragraph of separation. Image order is preserved.
 *
 * Edge case: if a body has more stacked images than text blocks to anchor
 * them (pathological), the surplus stays at the end — a normal blog always
 * has plenty of paragraphs, so this only bites when the model emitted
 * nothing but a wall of images.
 */
export function spaceOutImages(body: string): string {
  const imageLine = /^!\[[^\]]*\]\([^)]*\)$/;

  // Split into blank-line-separated blocks, then expand any block that is
  // purely image lines (no blank lines between them) into individual blocks
  // so those count as stacked images too.
  const rawBlocks = body.split(/\n\s*\n/);
  const blocks: string[] = [];
  for (const block of rawBlocks) {
    const lines = block.split("\n");
    const allImages =
      lines.length > 1 && lines.every((l) => imageLine.test(l.trim()));
    if (allImages) {
      blocks.push(...lines.map((l) => l.trim()));
    } else {
      blocks.push(block);
    }
  }

  const out: string[] = [];
  const deferred: string[] = [];

  for (const block of blocks) {
    if (imageLine.test(block.trim())) {
      // Emit if the previous block is text (or this is the very first block);
      // otherwise defer so it never stacks on the prior image.
      const last = out[out.length - 1];
      if (out.length === 0 || !imageLine.test(last.trim())) {
        out.push(block);
      } else {
        deferred.push(block);
      }
      continue;
    }

    // Text block — emit it, then anchor at most one deferred image after it.
    out.push(block);
    if (deferred.length > 0) {
      out.push(deferred.shift() as string);
    }
  }

  // Surplus deferred images (no text left to anchor them): keep at the end.
  out.push(...deferred);

  return out.join("\n\n");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
