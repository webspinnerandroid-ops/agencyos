"use client";

import { renderBlogBody } from "@/lib/blog-render";

/**
 * PostContent
 *
 * Renders a stored post's content. Blog posts store an object
 * ({ type: "blog", title, body, images, ... }) whose `body` is markdown —
 * we render it as HTML so embedded images actually display. Social posts
 * store a plain-text caption or a small object — rendered as text.
 */
export default function PostContent({
  content,
  className = "",
  markdown = false,
}: {
  content: string | null | Record<string, unknown>;
  className?: string;
  /** Render a raw string as markdown (blog body) instead of plain text. */
  markdown?: boolean;
}) {
  if (typeof content === "string") {
    if (markdown && content.trim().length > 0) {
      return (
        <div
          className={`${className} [&_img]:h-auto [&_img]:w-full [&_img]:object-cover`}
          dangerouslySetInnerHTML={{ __html: renderBlogBody(content) }}
        />
      );
    }
    return <p className={className}>{content}</p>;
  }

  if (content && typeof content === "object") {
    const c = content as Record<string, unknown>;
    if (typeof c.body === "string" && c.body.length > 0) {
      return (
        <div
          className={`${className} [&_img]:h-auto [&_img]:w-full [&_img]:object-cover`}
          dangerouslySetInnerHTML={{ __html: renderBlogBody(c.body) }}
        />
      );
    }
    if (typeof c.caption === "string" && c.caption.length > 0) {
      return <p className={`whitespace-pre-wrap ${className}`}>{c.caption}</p>;
    }
    if (typeof c.content === "string" && c.content.length > 0) {
      return <p className={className}>{c.content}</p>;
    }
    if (typeof c.title === "string") {
      return <p className={className}>{c.title}</p>;
    }
  }

  return <p className={className}>No content</p>;
}
