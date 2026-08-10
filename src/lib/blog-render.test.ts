import { describe, it, expect } from "vitest";
import { renderBlogBody } from "./blog-render";

describe("renderBlogBody", () => {
  it("renders headings", () => {
    const html = renderBlogBody("## Section One\n\n### Subsection\n\nParagraph text.");
    expect(html).toContain("<h2");
    expect(html).toContain("Section One");
    expect(html).toContain("<h3");
    expect(html).toContain("Subsection");
    expect(html).toContain("<p");
    expect(html).toContain("Paragraph text.");
  });

  it("renders images as img tags", () => {
    const html = renderBlogBody("![A chart](https://example.com/chart.png)");
    expect(html).toContain("<img");
    expect(html).toContain('src="https://example.com/chart.png"');
    expect(html).toContain('alt="A chart"');
  });

  it("escapes HTML so AI text cannot inject markup", () => {
    const html = renderBlogBody("hello <script>alert(1)</script> & <b>bold</b>");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;b&gt;");
  });

  it("renders unordered lists", () => {
    const html = renderBlogBody("- first\n- second\n- third");
    expect(html).toContain("<ul");
    expect(html).toContain("<li>first</li>");
    expect(html).toContain("<li>second</li>");
  });

  it("renders horizontal rules", () => {
    expect(renderBlogBody("---")).toContain("<hr");
  });

  it("renders bold and inline code", () => {
    const html = renderBlogBody("Use **bold** here and `code` there.");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<code");
    expect(html).toContain("code");
  });

  it("handles a full realistic blog body", () => {
    const body = [
      "![Featured: local restaurant](data:image/png;base64,ABC123)",
      "",
      "Intro paragraph with **keywords**.",
      "",
      "## Why local SEO matters",
      "",
      "![Map pin](data:image/png;base64,DEF456)",
      "",
      "Body text here.",
      "",
      "## Reviews",
      "",
      "- Respond fast",
      "- Ask for reviews",
    ].join("\n");
    const html = renderBlogBody(body);
    expect((html.match(/<img/g) || []).length).toBe(2);
    expect(html).toContain("<h2");
    expect(html).toContain("<ul");
    expect(html).toContain("<strong>keywords</strong>");
  });
});
