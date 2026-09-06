import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — publishGeneratedContentToSites creates its own service client via
// createClient from @supabase/supabase-js; stub that module with a fake
// chainable client. Encryption + blog-render stay real (ENCRYPTION_KEY is set
// below). The WordPress REST API is stubbed at global fetch level by URL.
// ---------------------------------------------------------------------------

const dbHolder: { row: Record<string, unknown> | null } = { row: null };

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => {
    const build = () => {
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "eq"]) builder[m] = () => builder;
      builder.maybeSingle = () => builder;
      builder.then = (
        onFulfilled?: (v: { data: unknown; error: null }) => unknown,
        onRejected?: (e: unknown) => unknown
      ) =>
        Promise.resolve({ data: dbHolder.row, error: null }).then(
          onFulfilled,
          onRejected
        );
      return builder;
    };
    return { from: () => build() };
  },
}));

process.env.ENCRYPTION_KEY = "a".repeat(64);

import {
  buildAuthHeader,
  buildSavedPostPublishPayload,
  listSiteContent,
  publishGeneratedContentToSites,
} from "./wordpressPublisher";
import { encrypt } from "@/lib/encryption";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CDN_URL = "https://cdn.example.com/images/hero.png";

interface Call {
  url: string;
  method: string;
  body?: unknown;
}

function stubWpApi(rows?: Record<string, unknown> | null) {
  dbHolder.row = rows === undefined ? {
    id: "bp-1",
    site_url: "https://site.test/",
    site_name: "Test Site",
    encrypted_credentials: encrypt(
      JSON.stringify({ username: "admin", applicationPassword: "app-pass" })
    ),
  } : rows;
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: { method?: string; body?: unknown }) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body });

      if (url === CDN_URL) {
        return new Response(new Uint8Array([137, 80, 78, 71]), {
          status: 200,
          headers: { "content-type": "image/png" },
        });
      }
      if (url.includes("/wp-json/wp/v2/media") && method === "POST") {
        return Response.json({
          id: 100,
          source_url: "https://site.test/wp-content/uploads/2026/09/hero.png",
        });
      }
      if (url.includes("/wp-json/wp/v2/media/") && method === "POST") {
        return Response.json({ id: 100 });
      }
      if (url.includes("/wp-json/wp/v2/posts") && method === "POST") {
        return Response.json({ id: 42, link: "https://site.test/new-post/" });
      }
      if (url.includes("/wp-json/wp/v2/posts/7") && method === "PUT") {
        return Response.json({ id: 7, link: "https://site.test/old-post/" });
      }
      if (url.includes("/wp-json/wp/v2/pages") && method === "POST") {
        return Response.json({ id: 55, link: "https://site.test/new-page/" });
      }
      if (url.includes("/wp-json/wp/v2/posts?") && method === "GET") {
        return Response.json([
          { id: 7, title: { rendered: "Old Post" }, link: "https://site.test/old-post/", slug: "old-post", date: "2026-08-01T10:00:00" },
          { id: 8, title: { rendered: "Another" }, link: "https://site.test/another/", slug: "another", date: "2026-08-02T10:00:00" },
        ]);
      }
      return new Response(`unexpected url: ${url}`, { status: 404 });
    })
  );
  return calls;
}

const content = {
  title: "Why Seasonal Coffee Menus Build Loyalty",
  body: "## Intro\n\nSome **bold** text about coffee.\n\n![Hero image](https://cdn.example.com/images/hero.png)\n\nMore prose after the image.",
  slug: "seasonal-coffee-loyalty",
  metaDescription: "A meta description for SEO.",
  seoMeta: { schema_jsonld: JSON.stringify([{ "@type": "Article", headline: "Coffee" }]) },
  images: [
    { url: CDN_URL, alt: "Hero image", placement: "featured" as const },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildAuthHeader", () => {
  it("builds Basic auth from username + application password", () => {
    const header = buildAuthHeader({ username: "admin", applicationPassword: "pass" });
    expect(header).toBe(`Basic ${Buffer.from("admin:pass").toString("base64")}`);
  });

  it("falls back to Bearer tokens", () => {
    expect(buildAuthHeader({ apiToken: "tok" })).toBe("Bearer tok");
    expect(buildAuthHeader({ apiKey: "key" })).toBe("Bearer key");
    expect(buildAuthHeader({})).toBe("");
  });
});

describe("listSiteContent", () => {
  it("lists a site's posts via the WP REST API and maps fields", async () => {
    const calls = stubWpApi();
    const items = await listSiteContent("https://site.test", "Basic abc", "post", "coffee");
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ id: 7, title: "Old Post", slug: "old-post" });
    const listCall = calls.find((c) => c.url.includes("/wp-json/wp/v2/posts?"));
    expect(listCall?.url).toContain("search=coffee");
    expect(listCall?.url).toContain("per_page=25");
  });

  it("returns [] on a failing site instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    const items = await listSiteContent("https://site.test", "Basic abc", "page");
    expect(items).toEqual([]);
  });
});

describe("publishGeneratedContentToSites", () => {
  it("creates a new post and uploads/embeds the generated images", async () => {
    const calls = stubWpApi();
    const result = await publishGeneratedContentToSites("t1", [
      { blogPlatformId: "bp-1", mode: "create", kind: "post", includeImages: true },
    ], content);

    expect(result.allSucceeded).toBe(true);
    expect(result.results[0].success).toBe(true);
    expect(result.results[0].wpPostUrl).toBe("https://site.test/new-post/");

    // Image downloaded from CDN, uploaded to the site's media library…
    const mediaCalls = calls.filter((c) => c.url.includes("/wp-json/wp/v2/media"));
    expect(mediaCalls.length).toBeGreaterThanOrEqual(1);
    expect(mediaCalls[0].method).toBe("POST");
    expect(mediaCalls[0].url).toBe("https://site.test/wp-json/wp/v2/media");

    // …and the post payload rewrites the CDN URL to the site's own media.
    const postCall = calls.find(
      (c) => c.url === "https://site.test/wp-json/wp/v2/posts" && c.method === "POST"
    );
    expect(postCall).toBeTruthy();
    const payload = JSON.parse(String(postCall?.body)) as Record<string, any>;
    expect(payload.title).toBe(content.title);
    expect(payload.status).toBe("publish");
    expect(payload.featured_media).toBe(100);
    expect(payload.excerpt).toBe(content.metaDescription);
    // Body is markdown → clean HTML (no Tailwind classes) with the WP media URL.
    expect(payload.content).toContain("<h2>");
    expect(payload.content).not.toContain("class=");
    expect(payload.content).not.toContain(CDN_URL);
    expect(payload.content).toContain("https://site.test/wp-content/uploads/2026/09/hero.png");
    // JSON-LD schema embedded in the content.
    expect(payload.content).toContain("application/ld+json");
    expect(payload.content).toContain('"@type":"Article"');
  });

  it("overwrites an existing post (PUT) and replaces its images", async () => {
    const calls = stubWpApi();
    const result = await publishGeneratedContentToSites("t1", [
      { blogPlatformId: "bp-1", mode: "overwrite", kind: "post", wpPostId: 7, includeImages: true },
    ], content);

    expect(result.allSucceeded).toBe(true);
    const putCall = calls.find(
      (c) => c.url === "https://site.test/wp-json/wp/v2/posts/7" && c.method === "PUT"
    );
    expect(putCall).toBeTruthy();
    const payload = JSON.parse(String(putCall?.body)) as Record<string, any>;
    expect(payload.featured_media).toBe(100);
    expect(payload.content).toContain("https://site.test/wp-content/uploads/2026/09/hero.png");
    expect(result.results[0].wpPostUrl).toBe("https://site.test/old-post/");
  });

  it("can overwrite a page (pages endpoint)", async () => {
    const calls = stubWpApi();
    const result = await publishGeneratedContentToSites("t1", [
      { blogPlatformId: "bp-1", mode: "create", kind: "page", includeImages: false },
    ], content);

    expect(result.allSucceeded).toBe(true);
    const pageCall = calls.find(
      (c) => c.url === "https://site.test/wp-json/wp/v2/pages" && c.method === "POST"
    );
    expect(pageCall).toBeTruthy();
    // No image upload when includeImages is false.
    expect(calls.some((c) => c.url.includes("/wp-json/wp/v2/media"))).toBe(false);
    // Original CDN URL stays in the body.
    const payload = JSON.parse(String(pageCall?.body)) as Record<string, any>;
    expect(payload.content).toContain(CDN_URL);
    expect(payload.featured_media).toBeUndefined();
  });

  it("publishes text-only content without any media calls", async () => {
    const calls = stubWpApi();
    const result = await publishGeneratedContentToSites("t1", [
      { blogPlatformId: "bp-1", mode: "create", kind: "post", includeImages: true },
    ], { title: "No images here", body: "Just prose.", slug: "no-images", images: [] });

    expect(result.allSucceeded).toBe(true);
    expect(calls.some((c) => c.url.includes("/wp-json/wp/v2/media"))).toBe(false);
    const postCall = calls.find(
      (c) => c.url === "https://site.test/wp-json/wp/v2/posts" && c.method === "POST"
    );
    const payload = JSON.parse(String(postCall?.body)) as Record<string, any>;
    expect(payload.title).toBe("No images here");
  });

  it("reports a per-site failure when the platform row is missing", async () => {
    stubWpApi(null); // no connected site
    const result = await publishGeneratedContentToSites("t1", [
      { blogPlatformId: "missing", mode: "create", kind: "post", includeImages: false },
    ], content);

    expect(result.allSucceeded).toBe(false);
    expect(result.results[0].success).toBe(false);
    expect(result.results[0].errorMessage).toBe("Connected site not found");
  });

  it("reports a per-site failure when overwriting without a target id", async () => {
    stubWpApi();
    const result = await publishGeneratedContentToSites("t1", [
      { blogPlatformId: "bp-1", mode: "overwrite", kind: "post", wpPostId: undefined, includeImages: false },
    ], content);

    expect(result.allSucceeded).toBe(false);
    expect(result.results[0].errorMessage).toContain("No existing post/page selected");
  });

  it("surfaces the WP API error message on a failed create", async () => {
    dbHolder.row = {
      id: "bp-1",
      site_url: "https://site.test/",
      site_name: "Test Site",
      encrypted_credentials: encrypt(
        JSON.stringify({ username: "admin", applicationPassword: "bad" })
      ),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url === CDN_URL) return new Response(new Uint8Array([1]), { headers: { "content-type": "image/png" } });
        if (url.includes("/wp-json/wp/v2/media")) return Response.json({ id: 1, source_url: url });
        return Response.json(
          { code: "rest_cannot_create", message: "Sorry, you are not allowed to create posts" },
          { status: 401 }
        );
      })
    );
    const result = await publishGeneratedContentToSites("t1", [
      { blogPlatformId: "bp-1", mode: "create", kind: "post", includeImages: false },
    ], content);

    expect(result.allSucceeded).toBe(false);
    expect(result.results[0].success).toBe(false);
    expect(result.results[0].errorMessage).toContain("not allowed to create posts");
  });
});

describe("buildSavedPostPublishPayload", () => {
  it("builds the payload from a saved post row (media_urls + inline body images)", () => {
    const built = buildSavedPostPublishPayload({
      title: "DB Title",
      content: JSON.stringify({
        type: "blog",
        title: "Stored Title",
        slug: "stored-slug",
        metaDescription: "Meta here",
        seoMeta: { seo_title: "SEO Title" },
        body: "Intro text.\n\n![Alt A](https://cdn.example.com/a.jpg)\n\nMore text.",
      }),
      media_urls: [
        "https://cdn.example.com/featured.jpg",
        "https://cdn.example.com/a.jpg",
      ],
    });

    expect(built).not.toBeNull();
    const content = built!.content;
    expect(content.title).toBe("Stored Title");
    expect(content.slug).toBe("stored-slug");
    expect(content.metaDescription).toBe("Meta here");
    expect(content.seoMeta).toEqual({ seo_title: "SEO Title" });
    // Featured first, media inline, body inline deduped against media_urls.
    expect(content.images).toEqual([
      { url: "https://cdn.example.com/featured.jpg", placement: "featured" },
      { url: "https://cdn.example.com/a.jpg", placement: "inline" },
    ]);
  });

  it("appends inline body images not present in media_urls (deduped)", () => {
    const built = buildSavedPostPublishPayload({
      title: "T",
      content: JSON.stringify({
        body: "A ![One](https://cdn.example.com/one.png) B ![Two](https://cdn.example.com/two.png) C ![One](https://cdn.example.com/one.png)",
      }),
      media_urls: [],
    });

    expect(built!.content.images).toEqual([
      { url: "https://cdn.example.com/one.png", alt: "One", placement: "inline" },
      { url: "https://cdn.example.com/two.png", alt: "Two", placement: "inline" },
    ]);
  });

  it("falls back to the row title and returns null for a body-less post", () => {
    expect(
      buildSavedPostPublishPayload({
        title: "Row Title",
        content: JSON.stringify({ type: "blog" }),
        media_urls: [],
      })
    ).toBeNull();

    const built = buildSavedPostPublishPayload({
      title: "Row Title",
      content: JSON.stringify({ type: "blog", body: "Body here" }),
      media_urls: null,
    });
    expect(built!.content.title).toBe("Row Title");
    expect(built!.content.images).toEqual([]);
  });
});