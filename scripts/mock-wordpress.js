/**
 * Minimal WordPress REST API mock — a local test stand-in for a real WP site.
 *
 * Implements exactly what the publisher uses:
 *   POST /wp-json/wp/v2/posts        → create a post (or PUT /posts/<id>)
 *   GET  /wp-json/wp/v2/posts        → list (for the overwrite flow)
 *   POST /wp-json/wp/v2/media        → media upload (stub)
 *   POST /wp-json/wp/v2/media/<id>   → alt-text update (stub)
 *
 * Created posts are kept in memory and appended to posts.jsonl (next to this
 * script) so the E2E check can assert on what landed. Run with a token to
 * require Basic auth:
 *
 *   node scripts/mock-wordpress.js [port] [token]
 *
 * Default: port 3199, token "mock-token".
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.argv[2] || 3199);
const TOKEN = process.argv[3] || "mock-token";
const LOG = path.join(__dirname, "mock-wp-posts.jsonl");

let nextId = 101;
/** In-memory posts keyed by id: { id, status, date, title, link, slug }. */
const posts = new Map();

function checkAuth(req) {
  const header = req.headers.authorization || "";
  const expected = "Basic " + Buffer.from(`mockuser:${TOKEN}`).toString("base64");
  return header === expected;
}

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function record(entry) {
  try {
    fs.appendFileSync(LOG, JSON.stringify(entry) + "\n");
  } catch (err) {
    console.error("[mock-wp] log write failed:", err.message);
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname.replace(/\/$/, "");

  if (!checkAuth(req)) {
    send(res, 401, { code: "rest_forbidden", message: "Bad credentials" });
    return;
  }

  // ---- Media ----
  if (p === "/wp-json/wp/v2/media" && req.method === "POST") {
    // Consume the body; accept anything as a "successful" upload.
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const id = 500 + posts.size;
      record({ kind: "media", id, bytes: Buffer.concat(chunks).length });
      send(res, 201, { id, source_url: `http://localhost:${PORT}/media/${id}.jpg` });
    });
    return;
  }
  const mediaAlt = p.match(/^\/wp-json\/wp\/v2\/media\/(\d+)$/);
  if (mediaAlt && req.method === "POST") {
    req.resume();
    send(res, 200, { id: Number(mediaAlt[1]), alt_text: "ok" });
    return;
  }

  // ---- Posts: create ----
  if (p === "/wp-json/wp/v2/posts" && req.method === "POST") {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      let body = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      } catch {
        send(res, 400, { code: "rest_invalid_json", message: "Bad JSON" });
        return;
      }
      const id = nextId++;
      const post = {
        id,
        status: body.status ?? "draft",
        date: body.date ?? null,
        title: typeof body.title === "object" ? body.title?.raw : body.title,
        slug: body.slug ?? null,
        link: `http://localhost:${PORT}/2026/${id}/${body.slug ?? "post"}/`,
      };
      posts.set(id, post);
      record({ kind: "post", ...post });
      console.log("[mock-wp] created post:", JSON.stringify(post));
      send(res, 201, post);
    });
    return;
  }

  // ---- Posts: overwrite ----
  const postOverwrite = p.match(/^\/wp-json\/wp\/v2\/posts\/(\d+)$/);
  if (postOverwrite && req.method === "PUT") {
    req.resume();
    const id = Number(postOverwrite[1]);
    const existing = posts.get(id);
    if (!existing) {
      send(res, 404, { code: "rest_post_invalid_id", message: "No such post" });
      return;
    }
    send(res, 200, existing);
    return;
  }

  // ---- Posts: list ----
  if (p === "/wp-json/wp/v2/posts" && req.method === "GET") {
    send(res, 200, [...posts.values()]);
    return;
  }

  send(res, 404, { code: "rest_no_route", message: `No route ${req.method} ${p}` });
});

server.listen(PORT, () => {
  console.log(`[mock-wp] WordPress mock listening on http://localhost:${PORT} (token: ${TOKEN})`);
});
