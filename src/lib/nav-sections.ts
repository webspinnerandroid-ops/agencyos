import type { NavSection } from "@/components/NavDropdown";

/**
 * The dashboard navigation, grouped into logical sections. Shared by the
 * dashboard layout and the Help page header (so a logged-in user can jump
 * straight back to wherever they were).
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
        { href: "/dashboard/generate-videos", label: "Videos" },
        { href: "/dashboard/analytics", label: "Analytics" },
      ],
    },
    {
      label: "Plan",
      items: [
        { href: "/dashboard/seo", label: "SEO" },
        { href: "/dashboard/seo/outreach", label: "Outreach" },
        { href: "/dashboard/seo/opportunities", label: "Opportunities" },
        { href: "/dashboard/calendar", label: "Calendar" },
        { href: "/dashboard/workspaces", label: "Workspaces" },
        { href: "/dashboard/cms", label: "Website" },
      ],
    },
    {
      label: "Manage",
      items: [
        { href: "/dashboard/settings/ai", label: "AI" },
        { href: "/dashboard/settings", label: "Settings" },
        { href: "/dashboard/billing", label: "Billing" },
        { href: "/help", label: "Help" },
        ...(isSuperAdmin
          ? [
              { href: "/dashboard/admin", label: "Admin" },
              { href: "/dashboard/admin/coupons", label: "Coupons" },
              { href: "/dashboard/admin/apis", label: "APIs & Models" },
              { href: "/dashboard/admin/deploy", label: "Deploy" },
            ]
          : []),
      ],
    },
  ];
}
