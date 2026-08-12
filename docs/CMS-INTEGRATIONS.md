# CMS Integrations — Top 10

Research-grounded target list (market share per W3Techs/Wappalyzer-style data,
2025-26: WordPress ~43% of all sites / ~60% of CMS market, then Shopify, Wix,
Squarespace, Joomla, Drupal, Webflow). The blog-platform settings page already
uses a **registry** (`SUPPORTED_PLATFORMS` in
`src/app/dashboard/settings/blog/actions.ts`): adding a platform = a config
entry (auth method + fields) plus a publisher that maps `platform_type` →
HTTP calls.

## The top 10

| # | Platform | Share | API | Auth | Publisher status |
|---|---|---|---|---|---|
| 1 | **WordPress** | ~43% of web | REST (`/wp-json/wp/v2/posts`) | Application Password (Basic) | ✅ **built & live** |
| 2 | **WordPress.com / Jetpack** | bundled | REST | OAuth2 | 🟡 config exists, publisher = same WP client |
| 3 | **Shopify** | ~6-7% (ecom) | Admin REST (`/admin/api/*/blogs`, `/articles.json`) | Admin API access token | 🔴 build |
| 4 | **Wix** | ~6% | Blog via "HTTP Functions" / site API | OAuth | 🟠 limited write API — verify before build |
| 5 | **Squarespace** | ~3-4% | **No public content-write API** | — | ⛔ not API-publishable — skip |
| 6 | **Webflow** | ~1-2% | CMS API (sites/collections/items) | API token (Bearer) | 🟡 config exists, publisher = build |
| 7 | **Joomla** | ~1.2% | Joomla API (com_ajax / API app) | API key | 🟡 config exists, publisher = build |
| 8 | **Drupal** | ~1% | JSON:API (`/jsonapi/node/article`) | Basic auth | 🟡 config exists, publisher = build |
| 9 | **Ghost** | <1% | Content+Admin API | Admin API key (JWT) | 🟡 config exists, publisher = build |
| 10 | **Medium** | <1% | REST (`/v1/posts`) | Integration token | 🔴 build |
| 11 | **Blogger** | <1% | Google APIs (`/blogger/v3/posts`) | API key + blog id | 🔴 build |

## Notes

- **Squarespace** has no public API for writing blog posts — it stays out of
  the supported list (honest constraint, not a config gap).
- **Wix** has partial write capability (their Blog API is evolving); treat as
  "verify then build".
- **Shopify** and **Medium** are high-value adds for e-commerce / client
  blogs and are simple REST builds.
- Every publisher follows the `wordpressPublisher.ts` pattern: fetch post →
  decrypt stored credentials → POST with action (draft/publish/schedule) →
  update post status + write a `publishing_logs` row. Scheduling uses the
  platform's native `future`/`date` where available (WP), else drafts + the
  existing Inngest scheduler.
