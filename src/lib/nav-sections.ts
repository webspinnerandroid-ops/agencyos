import type { NavSection } from "@/components/NavDropdown";

/**
 * The dashboard navigation, grouped into logical hubs and ordered by
 * workflow:
 *   Create   — everything you produce (AI team, content, images, videos)
 *   Manage   — clients and day-to-day content operations (posts, calendar)
 *   SEO      — the full SEO pipeline: audits, sites, campaigns, outreach
 *   Grow     — measurement and growth tooling (analytics, assets)
 *   Platform — account, configuration and help
 *   Admin    — super-admin-only platform controls
 * Shared by the dashboard layout and the Help page header (so a logged-in
 * user can jump straight back to wherever they were). Tenants can override
 * this default entirely via the Menu Builder (nav_config).
 */
export function buildNavSections(isSuperAdmin: boolean): NavSection[] {
  return [
    {
      label: "Create",
      items: [
        { href: "/dashboard", label: "Home" },
        { href: "/dashboard/ai-team", label: "AI Team" },
        { href: "/dashboard/generate", label: "Generate" },
        { href: "/dashboard/generate-images", label: "Images" },
        { href: "/dashboard/generate-videos", label: "Videos" },
        { href: "/dashboard/brand-design", label: "Brand Design" },
      ],
    },
    {
      label: "Manage",
      items: [
        { href: "/dashboard/clients", label: "Clients" },
        { href: "/dashboard/posts", label: "Posts" },
        { href: "/dashboard/scheduled", label: "Scheduled" },
        { href: "/dashboard/calendar", label: "Calendar" },
        { href: "/dashboard/answer-library", label: "Answer Library" },
        { href: "/dashboard/content-map", label: "Content Map" },
        { href: "/dashboard/workspaces", label: "Workspaces" },
        { href: "/dashboard/cms", label: "Website" },
      ],
    },
    {
      label: "SEO",
      items: [
        { href: "/dashboard/seo", label: "SEO Audits" },
        { href: "/dashboard/seo/sites", label: "Sites" },
        { href: "/dashboard/seo/analyzer", label: "Analyzer" },
        { href: "/dashboard/seo/audit-links", label: "Audit Share Links" },
        { href: "/dashboard/seo/campaigns", label: "Campaigns" },
        { href: "/dashboard/seo/rewriter", label: "Rewriter" },
        { href: "/dashboard/seo/opportunities", label: "Opportunities" },
        { href: "/dashboard/seo/outreach", label: "Outreach" },
      ],
    },
    {
      label: "Grow",
      items: [
        { href: "/dashboard/analytics", label: "Analytics" },
        { href: "/dashboard/reputation", label: "Reputation" },
        { href: "/dashboard/assets", label: "Asset Library" },
        { href: "/dashboard/connections", label: "Connections" },
      ],
    },
    {
      label: "Platform",
      items: [
        { href: "/dashboard/profile", label: "Profile & Usage" },
        { href: "/dashboard/billing", label: "Billing" },
        { href: "/dashboard/settings/ai", label: "AI" },
        { href: "/dashboard/settings", label: "Settings" },
        { href: "/help", label: "Help" },
      ],
    },
    // Super-admin-only platform controls — hidden entirely for other roles.
    ...(isSuperAdmin
      ? [
          {
            label: "Admin",
            items: [
              { href: "/dashboard/admin", label: "Super Admin" },
              { href: "/dashboard/admin/data-deletion", label: "Data Deletion Queue" },
              { href: "/dashboard/admin/page-builder", label: "Page Builder" },
              { href: "/dashboard/admin/blog", label: "Site Blog" },
              { href: "/dashboard/admin/nav-builder", label: "Menu Builder" },
              { href: "/dashboard/admin/apis", label: "APIs & Models" },
              { href: "/dashboard/admin/coupons", label: "Coupons" },
              { href: "/dashboard/admin/subscriptions", label: "Subscriptions" },
              { href: "/dashboard/admin/deploy", label: "Deploy" },
            ],
          },
        ]
      : []),
  ];
}
