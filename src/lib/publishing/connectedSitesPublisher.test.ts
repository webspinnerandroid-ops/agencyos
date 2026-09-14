import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — the publisher creates its own service client via
// @supabase/supabase-js; stub that module with a flexible chainable fake keyed
// by table + filters so we can drive blog_platforms rows, site_pages rows, and
// capture inserts/updates (publishing_logs, posts, site_pages).
// ---------------------------------------------------------------------------

const state = {
  blogPlatforms: new Map<string, Record<string, unknown>>(),
  sitePages: [] as Array<Record<string, unknown>>,
  inserts: [] as Array<{ table: string; row: unknown }>,
  updates: [] as Array<{ table: string; patch: unknown; filters: Record<string, unknown> }>,
};

function makeBuilder(table: string) {
  const filters: Record<string, unknown> = {};
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.eq = (col: string, val: unknown) => {
    filters[col] = val;
    return builder;
  };
  builder.order = () => builder;
  builder.limit = () => builder;
  builder.maybeSingle = () => builder;
  builder.single = () => builder;
  builder.update = (patch: unknown) => {
    // Keep the filters REFERENCE — real code chains .update(patch).eq(...).eq(...),
    // so the eq calls mutate this object after update() returns.
    state.updates.push({ table, patch, filters });
    return builder;
  };
  builder.insert = (row: unknown) => {
    state.inserts.push({ table, row });
    return builder;
  };
  builder.then = (
    onOk?: (v: { data: unknown; error: null }) => unknown,
    onErr?: (e: unknown) => unknown
  ) => {
    let data: unknown = null;
    if (table === "blog_platforms") {
      const id = filters["id"];
      if (typeof id === "string") data = state.blogPlatforms.get(id) ?? null;
    } else if (table === "site_pages") {
      const tenant = filters["tenant_id"];
      const id = filters["id"];
      const slug = filters["slug"];
      data =
        state.sitePages.find(
          (r) =>
            (id == null || String(r.id) === String(id)) &&
            (tenant == null || String(r.tenant_id) === String(tenant)) &&
            (slug == null || String(r.slug) === String(slug))
        ) ?? null;
    }
    return Promise.resolve({ data, error: null }).then(onOk, onErr);
  };
  return builder;
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: (table: string) => makeBuilder(table) }),
}));

process.env.ENCRYPTION_KEY = "a".repeat(64);

import {
  BUILTIN_CMS_PLATFORM_ID,
  ghostAuthHeader,
  publishToBuiltinCms,
  publishToConnectedSites,
  publishToGhost,
  publishToMedium,
  publishToWebflow,
} from "./connectedSitesPublisher";
import { encrypt } from "@/lib/encryption";

const CDN_URL = "https://cdn.example.com/images/hero.png";

const content = {
  title: "Why Seasonal Coffee Menus Build Loyalty",
  body: "## Intro\n\nSome **bold** text.\n\n![Hero](https://cdn.example.com/images/hero.png)\n\nMore prose.",
  slug: "seasonal-coffee-loyalty",
  metaDescription: "A meta description for SEO.",
  seoMeta: { schema_jsonld: JSON.stringify([{ "@type": "Article" }]) },
  images: [{ url: CDN_URL, alt: "Hero image", placement: "featured" as const }],
};

interface Call {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: unknown;
}

let calls: Call[] = [];

function stubFetch(routes: {
  [urlIncludes: string]: (url: string, method: string, body?: unknown) => Response;
}) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: { method?: string; headers?: Record<string, string>; body?: unknown }) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method, headers: init?.headers as Record<string, string>, body: init?.body });
      if (url === CDN_URL) {
        return new Response(new Uint8Array([137, 80, 78, 71]), {
          status: 200,
          headers: { "content-type": "image/png" },
        });
      }
      // Most-specific needles first so e.g. "/v2/sites/s1/collections" isn't
      // swallowed by the greedier "/v2/sites" matcher.
      const ordered = Object.entries(routes).sort(
        (a, b) => b[0].length - a[0].length
      );
      for (const [needle, handler] of ordered) {
        if (url.includes(needle)) return handler(url, method, init?.body);
      }
      return new Response(`unexpected url: ${url}`, { status: 404 });
    })
  );
}

function addWpSite(id = "bp-1") {
  state.blogPlatforms.set(id, {
    id,
    site_url: "https://site.test/",
    site_name: "Test WP Site",
    platform_type: "wordpress",
    encrypted_credentials: encrypt(JSON.stringify({ username: "admin", applicationPassword: "app-pass" })),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.blogPlatforms.clear();
  state.sitePages = [];
  state.inserts = [];
  state.updates = [];
  calls = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Ghost
// ---------------------------------------------------------------------------

describe("ghostAuthHeader", () => {
  it("builds a 3-part HS256 JWT with the admin key id as the kid", () => {
    const header = ghostAuthHeader("abc123:super-secret");
    expect(header.startsWith("Ghost ")).toBe(true);
    const jwt = header.replace("Ghost ", "");
    const parts = jwt.split(".");
    expect(parts).toHaveLength(3);
    const headerJson = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    expect(headerJson).toMatchObject({ alg: "HS256", kid: "abc123", typ: "JWT" });
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    expect(payload.aud).toBe("/admin/");
    expect(payload.exp - payload.iat).toBe(300);
  });

  it("returns empty for a malformed key", () => {
    expect(ghostAuthHeader("no-separator")).toBe("");
  });
});

describe("publishToGhost", () => {
  it("creates a post, uploads the featured image, and rewrites body URLs", async () => {
    stubFetch({
      "/ghost/api/admin/images/upload/": () =>
        Response.json({ images: [{ url: "https://ghost-cdn.site/content/hero.png" }] }),
      "/ghost/api/admin/posts/": () =>
        Response.json({ posts: [{ id: "g1", url: "https://blog.site/p/g1/" }] }),
    });
    const result = await publishToGhost(
      "https://blog.site/",
      { adminApiKey: "abc123:super-secret" },
      { blogPlatformId: "bp-g", mode: "create", kind: "post", includeImages: true },
      content
    );

    expect(result.success).toBe(true);
    expect(result.wpPostId).toBe("g1");
    expect(result.wpPostUrl).toBe("https://blog.site/p/g1/");

    const postCall = calls.find((c) => c.url === "https://blog.site/ghost/api/admin/posts/");
    expect(postCall?.method).toBe("POST");
    expect(postCall?.headers?.Authorization?.startsWith("Ghost ")).toBe(true);
    const payload = JSON.parse(String(postCall?.body)) as { posts: Record<string, unknown>[] };
    expect(payload.posts[0]).toMatchObject({
      title: content.title,
      status: "published",
      feature_image: "https://ghost-cdn.site/content/hero.png",
    });
    expect(String(payload.posts[0].html)).toContain("https://ghost-cdn.site/content/hero.png");
    expect(String(payload.posts[0].html)).not.toContain(CDN_URL);
  });

  it("overwrites an existing post with PUT", async () => {
    stubFetch({
      "/ghost/api/admin/posts/g1/": () =>
        Response.json({ posts: [{ id: "g1", url: "https://blog.site/p/g1/" }] }),
    });
    const result = await publishToGhost(
      "https://blog.site",
      { adminApiKey: "abc123:secret" },
      { blogPlatformId: "bp-g", mode: "overwrite", kind: "post", wpPostId: "g1", includeImages: false },
      content
    );
    expect(result.success).toBe(true);
    const putCall = calls.find((c) => c.url.includes("/ghost/api/admin/posts/g1/"));
    expect(putCall?.method).toBe("PUT");
  });

  it("reports the Ghost API error on failure", async () => {
    stubFetch({
      "/ghost/api/admin/posts/": () =>
        Response.json(
          { errors: [{ message: "Validation error", context: "title is required" }] },
          { status: 422 }
        ),
    });
    const result = await publishToGhost(
      "https://blog.site",
      { adminApiKey: "abc123:secret" },
      { blogPlatformId: "bp-g", mode: "create", kind: "post", includeImages: false },
      content
    );
    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain("Validation error");
  });
});

// ---------------------------------------------------------------------------
// Medium
// ---------------------------------------------------------------------------

describe("publishToMedium", () => {
  it("creates a published post via the user's posts endpoint", async () => {
    stubFetch({
      "/v1/me": () => Response.json({ data: { id: "u1", name: "Coffee Shop" } }),
      "/v1/users/u1/posts": () =>
        Response.json({ data: { id: "m1", url: "https://medium.com/@coffee/slug" } }),
    });
    const result = await publishToMedium(
      { apiToken: "medium-token" },
      { blogPlatformId: "bp-m", mode: "create", kind: "post", includeImages: false },
      content
    );

    expect(result.success).toBe(true);
    expect(result.wpPostUrl).toBe("https://medium.com/@coffee/slug");
    const meCall = calls.find((c) => c.url.includes("/v1/me"));
    expect(meCall?.headers?.Authorization).toBe("Bearer medium-token");
    const postCall = calls.find((c) => c.url.includes("/v1/users/u1/posts"));
    const payload = JSON.parse(String(postCall?.body)) as Record<string, unknown>;
    expect(payload).toMatchObject({
      title: content.title,
      contentFormat: "html",
      publishStatus: "public",
    });
    // Medium has no media upload — remote image URLs stay as-is in the HTML.
    expect(String(payload.content)).toContain(CDN_URL);
  });

  it("refuses overwrite mode (Medium's API has no update endpoint)", async () => {
    const result = await publishToMedium(
      { apiToken: "t" },
      { blogPlatformId: "bp-m", mode: "overwrite", kind: "post", wpPostId: "m1", includeImages: false },
      content
    );
    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain("doesn't support overwriting");
  });
});

// ---------------------------------------------------------------------------
// Webflow
// ---------------------------------------------------------------------------

describe("publishToWebflow", () => {
  const webflowRoutes = {
    "/v2/sites": () =>
      Response.json({
        sites: [
          {
            id: "s1",
            name: "GiantByte Software",
            shortName: "giantbyte",
            customDomains: [{ url: "giantbyte.webflow.io" }],
          },
        ],
      }),
    "/v2/sites/s1/collections": () =>
      Response.json({
        collections: [
          {
            id: "c1",
            slug: "blog",
            name: "Blog posts",
            fields: [
              { slug: "name", type: "PlainText" },
              { slug: "slug", type: "Slug" },
              { slug: "post-body", type: "RichText" },
              { slug: "main-image", type: "ImageRef" },
              { slug: "post-summary", type: "PlainText" },
            ],
          },
        ],
      }),
    "/v2/sites/s1/assets": () => Response.json({ asset: { id: "asset-1" } }),
  };

  it("creates an item with schema-mapped fields and an uploaded image asset", async () => {
    stubFetch({
      ...webflowRoutes,
      "/v2/collections/c1/items": () =>
        Response.json({
          item: {
            id: "i1",
            fieldData: { name: content.title, slug: content.slug },
            __liveUrl: "https://giantbyte.webflow.io/blog/seasonal-coffee-loyalty",
          },
        }),
    });
    const result = await publishToWebflow(
      "giantbyte.webflow.io",
      { apiToken: "wf-token" },
      { blogPlatformId: "bp-w", mode: "create", kind: "post", includeImages: true },
      content
    );

    expect(result.success).toBe(true);
    expect(result.wpPostUrl).toBe("https://giantbyte.webflow.io/blog/seasonal-coffee-loyalty");

    const assetCall = calls.find((c) => c.url.includes("/v2/sites/s1/assets"));
    expect(assetCall?.method).toBe("POST");
    const itemCall = calls.find((c) => c.url.includes("/v2/collections/c1/items") && !c.url.endsWith("/items/i1"));
    expect(itemCall?.method).toBe("POST");
    const payload = JSON.parse(String(itemCall?.body)) as Record<string, unknown>;
    expect(payload.isDraft).toBe(false);
    const fieldData = payload.fieldData as Record<string, unknown>;
    expect(fieldData.name).toBe(content.title);
    expect(fieldData["post-body"]).toContain("<h2>");
    expect(fieldData["main-image"]).toBe("asset-1");
  });

  it("overwrites an item with PATCH and skips images when not requested", async () => {
    stubFetch({
      ...webflowRoutes,
      "/v2/collections/c1/items/i9": () =>
        Response.json({ item: { id: "i9", fieldData: { name: content.title } } }),
    });
    const result = await publishToWebflow(
      "giantbyte.webflow.io",
      { apiToken: "wf-token" },
      { blogPlatformId: "bp-w", mode: "overwrite", kind: "post", wpPostId: "i9", includeImages: false },
      content
    );
    expect(result.success).toBe(true);
    const patchCall = calls.find((c) => c.url.endsWith("/v2/collections/c1/items/i9"));
    expect(patchCall?.method).toBe("PATCH");
    expect(calls.some((c) => c.url.includes("/assets"))).toBe(false);
  });

  it("fails clearly when no Webflow site matches the connected URL", async () => {
    stubFetch({
      "/v2/sites": () =>
        Response.json({ sites: [{ id: "s1", name: "Other", shortName: "other", customDomains: [] }] }),
    });
    const result = await publishToWebflow(
      "giantbyte.webflow.io",
      { apiToken: "wf-token" },
      { blogPlatformId: "bp-w", mode: "create", kind: "post", includeImages: false },
      content
    );
    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain("giantbyte.webflow.io");
  });
});

// ---------------------------------------------------------------------------
// Built-in CMS (site_pages)
// ---------------------------------------------------------------------------

describe("publishToBuiltinCms", () => {
  it("creates a blog_post page with text+image blocks", async () => {
    const result = await publishToBuiltinCms(
      "t1",
      [{ blogPlatformId: BUILTIN_CMS_PLATFORM_ID, mode: "create", kind: "post", includeImages: true }],
      content
    );

    expect(result.allSucceeded).toBe(true);
    expect(result.results[0].wpPostUrl).toBe("/site/seasonal-coffee-loyalty");

    const insert = state.inserts.find((i) => i.table === "site_pages");
    expect(insert).toBeTruthy();
    const row = insert!.row as Record<string, unknown>;
    expect(row.tenant_id).toBe("t1");
    expect(row.kind).toBe("blog_post");
    expect(row.slug).toBe("seasonal-coffee-loyalty");
    const blocks = row.blocks as Array<{ kind: string; url?: string }>;
    expect(blocks[0]).toMatchObject({ kind: "image", url: CDN_URL });
    expect(blocks.some((b) => b.kind === "text")).toBe(true);
  });

  it("creates a page kind when requested and skips images when disabled", async () => {
    const result = await publishToBuiltinCms(
      "t1",
      [{ blogPlatformId: BUILTIN_CMS_PLATFORM_ID, mode: "create", kind: "page", includeImages: false }],
      { title: "About Us", body: "Plain page body.", slug: "about", images: [] }
    );
    expect(result.allSucceeded).toBe(true);
    const insert = state.inserts.find((i) => i.table === "site_pages");
    expect((insert!.row as Record<string, unknown>).kind).toBe("page");
    const blocks = (insert!.row as Record<string, unknown>).blocks as Array<{ kind: string }>;
    expect(blocks.every((b) => b.kind === "text")).toBe(true);
  });

  it("overwrites an existing page by id", async () => {
    state.sitePages = [
      { id: "page-1", tenant_id: "t1", slug: "old-about", title: "Old About" },
    ];
    const result = await publishToBuiltinCms(
      "t1",
      [{ blogPlatformId: BUILTIN_CMS_PLATFORM_ID, mode: "overwrite", kind: "page", wpPostId: "page-1", includeImages: false }],
      { title: "New About", body: "Fresh body.", slug: "new-about", images: [] }
    );
    expect(result.allSucceeded).toBe(true);
    const update = state.updates.find((u) => u.table === "site_pages");
    expect(update?.filters.id).toBe("page-1");
    expect((update?.patch as Record<string, unknown>).slug).toBe("new-about");
  });

  it("reports failure when the overwrite target doesn't exist", async () => {
    const result = await publishToBuiltinCms(
      "t1",
      [{ blogPlatformId: BUILTIN_CMS_PLATFORM_ID, mode: "overwrite", kind: "page", wpPostId: "nope", includeImages: false }],
      content
    );
    expect(result.allSucceeded).toBe(false);
    expect(result.results[0].errorMessage).toBe("Page not found to overwrite");
  });
});

// ---------------------------------------------------------------------------
// Dispatcher + publish history logging
// ---------------------------------------------------------------------------

describe("publishToConnectedSites", () => {
  it("routes a built-in CMS target and logs the attempt with a live link", async () => {
    const result = await publishToConnectedSites(
      "t1",
      [{ blogPlatformId: BUILTIN_CMS_PLATFORM_ID, mode: "create", kind: "post", includeImages: false }],
      { title: "History Post", body: "Body.", slug: "history-post", images: [] },
      "post-123"
    );

    expect(result.allSucceeded).toBe(true);

    const log = state.inserts.find((i) => i.table === "publishing_logs");
    expect(log).toBeTruthy();
    expect(log!.row).toMatchObject({
      post_id: "post-123",
      platform: "builtin_cms",
      success: true,
      site_name: "Built-in website",
      target_url: "/site/history-post",
    });

    // The saved post's "On site" badge is kept in sync.
    const postUpdate = state.updates.find((u) => u.table === "posts");
    expect(postUpdate?.filters.id).toBe("post-123");
    expect((postUpdate?.patch as Record<string, unknown>).cms_slug).toBe("history-post");
  });

  it("routes a Medium target and logs the attempt with the site name", async () => {
    state.blogPlatforms.set("bp-m", {
      id: "bp-m",
      site_url: "https://medium.com/@coffee",
      site_name: "Coffee on Medium",
      platform_type: "medium",
      encrypted_credentials: encrypt(JSON.stringify({ apiToken: "tok" })),
    });
    stubFetch({
      "/v1/me": () => Response.json({ data: { id: "u1" } }),
      "/v1/users/u1/posts": () =>
        Response.json({ data: { id: "m1", url: "https://medium.com/@coffee/seasonal" } }),
    });
    const result = await publishToConnectedSites(
      "t1",
      [{ blogPlatformId: "bp-m", mode: "create", kind: "post", includeImages: false }],
      content,
      "post-456"
    );
    expect(result.allSucceeded).toBe(true);
    const log = state.inserts.find((i) => i.table === "publishing_logs");
    expect(log!.row).toMatchObject({
      post_id: "post-456",
      platform: "medium",
      site_name: "Coffee on Medium",
      target_url: "https://medium.com/@coffee/seasonal",
    });
  });

  it("reports a per-site failure for unsupported platforms", async () => {
    state.blogPlatforms.set("bp-x", {
      id: "bp-x",
      site_url: "https://x.test",
      site_name: "Some CMS",
      platform_type: "drupal",
      encrypted_credentials: encrypt(JSON.stringify({ username: "u", password: "p" })),
    });
    const result = await publishToConnectedSites(
      "t1",
      [{ blogPlatformId: "bp-x", mode: "create", kind: "post", includeImages: false }],
      content
    );
    expect(result.allSucceeded).toBe(false);
    expect(result.results[0].errorMessage).toContain("not supported yet");
    // No log row without a saved post id — and failures are still logged when
    // the post id exists:
    expect(state.inserts.filter((i) => i.table === "publishing_logs")).toHaveLength(0);
  });

  it("logs failed attempts too when a post id is supplied", async () => {
    addWpSite("bp-1");
    stubFetch({});
    const result = await publishToConnectedSites(
      "t1",
      [{ blogPlatformId: "bp-1", mode: "create", kind: "post", includeImages: false }],
      content,
      "post-789"
    );
    expect(result.allSucceeded).toBe(false);
    const log = state.inserts.find((i) => i.table === "publishing_logs");
    expect(log!.row).toMatchObject({ post_id: "post-789", platform: "wordpress", success: false });
    expect((log!.row as Record<string, unknown>).error_message).toBeTruthy();
  });
});