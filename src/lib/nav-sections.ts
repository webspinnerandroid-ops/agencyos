import type { NavSection } from "@/components/NavDropdown";

/**
 * The dashboard navigation, grouped into logical sections and ordered by
 * workflow: Work = what you create and publish today; Plan = strategy,
 * campaigns and outreach; Manage = setup, account and administration.
 * Shared by the dashboard layout and the Help page header (so a logged-in
 * user can jump straight back to wherever they were).
 */
export function buildNavSections(isSuperAdmin: boolean): NavSection[] {
  return [
    {
      label: "Work",
      items: [
        { href: "/dashboard", label: "Home" },
        { href: "/dashboard/ai-team", label: "AI Team" },
        { href: "/dashboard/generate", label: "Generate" },
        { href: "/dashboard/generate-images", label: "Images" },
        { href: "/dashboard/brand-design", label: "Brand Design" },
        { href: "/dashboard/generate-videos", label: "Videos" },
        { href: "/dashboard/posts", label: "Posts" },
        { href: "/dashboard/calendar", label: "Calendar" },
        { href: "/dashboard/analytics", label: "Analytics" },
      ],
    },
    {
      label: "Plan",
      items: [
        { href: "/dashboard/seo", label: "SEO Audits" },
        { href: "/dashboard/seo/campaigns", label: "Campaigns" },
        { href: "/dashboard/seo/audit-links", label: "Audit Share Links" },
        { href: "/dashboard/cms", label: "Website" },
        { href: "/dashboard/seo/outreach", label: "Outreach" },
        { href: "/dashboard/seo/opportunities", label: "Opportunities" },
      ],
    },
    {
      label: "Manage",
      items: [
        { href: "/dashboard/workspaces", label: "Workspaces" },
        { href: "/dashboard/connections", label: "Connections" },
        { href: "/dashboard/profile", label: "Profile & Usage" },
        { href: "/dashboard/settings/ai", label: "AI" },
        { href: "/dashboard/settings", label: "Settings" },
        { href: "/dashboard/billing", label: "Billing" },
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
              { href: "/dashboard/admin/page-builder", label: "Page Builder" },
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
