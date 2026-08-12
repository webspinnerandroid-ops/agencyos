/**
 * The full website plan considered when a campaign includes a website build:
 * the pages, functions and add-ons/plugins the site will need. Suggested to
 * the owner in the Start Campaign dialog and stored on the campaign
 * (campaign_json.websitePlan) so the proposal and build track it.
 *
 * Kept in its own module (no server-only imports) so it can be imported
 * safely from client components.
 */
export const WEBSITE_PLAN = {
  pages: [
    "Home — positioning, hero, key services, proof & CTA",
    "About — story, team, credentials (E-E-A-T)",
    "Services — one page per core service with benefits & FAQ",
    "Portfolio / Case Studies — proof with results (where applicable)",
    "Blog / News — the content hub for the campaign's SEO pieces",
    "Contact — form, map, hours, NAP consistency",
    "Legal — privacy policy, terms of service, cookie notice",
  ],
  functions: [
    "Contact / enquiry form (with spam protection)",
    "Newsletter signup (connects to the email provider)",
    "Booking / quote request or service calendar if applicable",
    "Google Maps embed + local SEO schema (LocalBusiness)",
    "Live chat or chat widget if applicable",
    "Payment / checkout only if e-commerce is in scope",
  ],
  plugins: [
    "Analytics (GA4) + Search Console / Bing Webmaster",
    "SEO plugin — meta, schema, sitemap, internal-link tooling",
    "Consent / cookie banner (privacy compliance)",
    "Performance & caching (CDN, image optimization, compression)",
    "Security — SSL, rate limiting / WAF, backups",
    "Social feeds / review widgets to add trust signals",
  ],
};

export type WebsitePlan = typeof WEBSITE_PLAN;
