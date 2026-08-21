"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Home } from "lucide-react";

/**
 * Auto-generated breadcrumbs for the dashboard. Built from the URL path with
 * a label map so dynamic ids (workspace/client UUIDs) never render raw.
 * Hidden on the dashboard home itself and on very small screens.
 */
const SEGMENT_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  clients: "Clients",
  onboarding: "Onboarding",
  posts: "Posts",
  calendar: "Calendar",
  seo: "SEO",
  sites: "Sites",
  analyzer: "Analyzer",
  "audit-links": "Audit Share Links",
  campaigns: "Campaigns",
  rewriter: "Rewriter",
  opportunities: "Opportunities",
  outreach: "Outreach",
  workspaces: "Workspaces",
  "brand-profile": "Brand Profile",
  knowledgebase: "Knowledge Base",
  cms: "Website",
  analytics: "Analytics",
  assets: "Asset Library",
  connections: "Connections",
  billing: "Billing",
  profile: "Profile & Usage",
  settings: "Settings",
  ai: "AI",
  "ai-team": "AI Team",
  generate: "Generate",
  "generate-images": "Images",
  "generate-videos": "Videos",
  "brand-design": "Brand Design",
  admin: "Super Admin",
  "data-deletion": "Data Deletion Queue",
  "page-builder": "Page Builder",
  blog: "Site Blog",
  "nav-builder": "Menu Builder",
  apis: "APIs & Models",
  coupons: "Coupons",
  subscriptions: "Subscriptions",
  deploy: "Deploy",
};

export default function PageBreadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  // Dashboard home needs no breadcrumb trail.
  if (segments.length <= 1 || segments[0] !== "dashboard") return null;

  const crumbs: { label: string; href: string }[] = [];
  let acc = "";
  for (const seg of segments.slice(1)) {
    acc += `/${seg}`;
    const label = SEGMENT_LABELS[seg] ?? null;
    if (label) crumbs.push({ label, href: `/dashboard${acc}` });
  }

  return (
    <nav
      aria-label="Breadcrumb"
      className="hidden sm:flex items-center gap-1 text-xs text-muted-foreground mb-4"
    >
      <Link href="/dashboard" className="flex items-center gap-1 hover:text-foreground transition-colors">
        <Home className="size-3" />
        Dashboard
      </Link>
      {crumbs.map((c, i) => (
        <span key={c.href} className="flex items-center gap-1">
          <ChevronRight className="size-3" />
          {i === crumbs.length - 1 ? (
            <span className="text-foreground font-medium">{c.label}</span>
          ) : (
            <Link href={c.href} className="hover:text-foreground transition-colors">
              {c.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
