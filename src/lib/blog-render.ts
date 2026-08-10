/**
 * blog-render.ts
 *
 * Minimal, dependency-free markdown → HTML renderer for blog post bodies.
 * The generated body is a markdown string (## headings, ![alt](url) images,
 * **bold**, - lists, --- rules, paragraphs). Every surface that displays a
 * blog post body should go through renderBlogBody so images actually render
 * instead of showing raw markdown text.
 *
 * Security: all HTML is escaped BEFORE markdown transforms are applied, so
 * AI/user-supplied text can never inject raw <script> or markup. Image URLs
 * (data: URLs and https) pass through as attribute values only.
 */

const BLOCK_CLASSES = {
  h1: "mt-5 mb-2 text-xl font-bold tracking-tight",
  h2: "mt-5 mb-2 text-lg font-bold tracking-tight",
  h3: "mt-4 mb-1.5 text-base font-semibold",
  h4: "mt-3 mb-1 text-sm font-semibold",
  p: "my-2.5 leading-relaxed",
  ul: "my-2.5 list-disc pl-6 space-y-1",
  ol: "my-2.5 list-decimal pl-6 space-y-1",
  hr: "my-5 border-t",
  img: "my-4 rounded-lg border max-w-full h-auto",
  blockquote: "my-3 border-l-2 pl-3 italic text-muted-foreground",
};

/** Escape HTML so user/AI text can never inject markup. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Escape an attribute value (quotes are the dangerous char here). */
function escapeAttr(value: string): string {
  return value.replace(/"/g, "&quot;").replace(/&/g, "&amp;");
}

/** Inline transforms: bold, italic, inline code, links. Applied AFTER escaping. */
function inlineTransforms(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/`([^`\n]+)`/g, "<code class=\"rounded bg-muted px-1 py-0.5 text-[0.85em]\">$1</code>")
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-primary underline">$1</a>'
    );
}

function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

function isHr(line: string): boolean {
  return /^-{3,}$/.test(line.trim());
}

function isHeading(line: string): { level: number; text: string } | null {
  const m = line.match(/^(#{1,4})\s+(.+)$/);
  if (!m) return null;
  return { level: m[1].length, text: m[2].trim() };
}

function renderBlock(block: string): string {
  const lines = block.split("\n").filter((l) => !isBlank(l));
  if (lines.length === 0) return "";

  // Horizontal rule
  if (lines.length === 1 && isHr(lines[0])) {
    return `<hr class="${BLOCK_CLASSES.hr}" />`;
  }

  // Heading (single-line block starting with #)
  const first = lines[0];
  const heading = isHeading(first);
  if (heading && lines.length === 1) {
    const tag = `h${heading.level}` as "h1" | "h2" | "h3" | "h4";
    return `<${tag} class="${BLOCK_CLASSES[tag]}">${inlineTransforms(heading.text)}</${tag}>`;
  }

  // Unordered list: every line starts with "- " or "* "
  if (lines.every((l) => /^[-*]\s+/.test(l))) {
    const items = lines
      .map((l) => l.replace(/^[-*]\s+/, ""))
      .map((l) => `<li>${inlineTransforms(l)}</li>`)
      .join("");
    return `<ul class="${BLOCK_CLASSES.ul}">${items}</ul>`;
  }

  // Ordered list: every line starts with "1. "
  if (lines.every((l) => /^\d+\.\s+/.test(l))) {
    const items = lines
      .map((l) => l.replace(/^\d+\.\s+/, ""))
      .map((l) => `<li>${inlineTransforms(l)}</li>`)
      .join("");
    return `<ol class="${BLOCK_CLASSES.ol}">${items}</ol>`;
  }

  // Blockquote: every line starts with "> "
  if (lines.every((l) => /^>\s?/.test(l))) {
    const quote = lines.map((l) => l.replace(/^>\s?/, "")).join(" ");
    return `<blockquote class="${BLOCK_CLASSES.blockquote}">${inlineTransforms(quote)}</blockquote>`;
  }

  // Plain paragraph (inner line breaks become <br/>)
  const para = lines.map((l) => inlineTransforms(l)).join("<br />");
  return `<p class="${BLOCK_CLASSES.p}">${para}</p>`;
}

/**
 * Converts a blog body (markdown) into safe HTML. Callers render with
 * dangerouslySetInnerHTML={{ __html: renderBlogBody(body) }}.
 */
export function renderBlogBody(markdown: string): string {
  if (!markdown) return "";
  const escaped = escapeHtml(markdown);

  // Extract image tags FIRST (before paragraph wrapping) so each image
  // becomes its own block instead of being wrapped in <p>.
  const images: string[] = [];
  const withImagePlaceholders = escaped.replace(
    /!\[([^\]]*)\]\(([^)\s]+)\)/g,
    (_whole, alt: string, url: string) => {
      const safeUrl = escapeAttr(url);
      const safeAlt = escapeAttr(alt);
      const img = `<img src="${safeUrl}" alt="${safeAlt}" loading="lazy" class="${BLOCK_CLASSES.img}" />`;
      images.push(img);
      return `\n\n%%IMG${images.length - 1}%%\n\n`;
    }
  );

  const blocks = withImagePlaceholders.split(/\n{2,}/);

  const rendered = blocks
    .map((block) => {
      const imgMatch = block.match(/^\s*%%IMG(\d+)%%\s*$/);
      if (imgMatch) return images[Number(imgMatch[1])];
      return renderBlock(block);
    })
    .filter(Boolean)
    .join("\n");

  return rendered;
}
