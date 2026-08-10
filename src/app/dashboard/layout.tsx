import type { Metadata } from "next";
import WorkspaceSelector from "@/components/WorkspaceSelector";
import AccountMenu from "@/components/AccountMenu";
import MobileNav from "@/components/MobileNav";
import { getRole } from "@/lib/auth";

/**
 * Dynamic metadata for the dashboard shell.
 * Child pages can further refine this via their own generateMetadata.
 */
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Dashboard",
    description:
      "Manage your agency content, clients, campaigns, white‑label branding, and billing — all in one place.",
    openGraph: {
      title: "Agency OS Dashboard",
      description:
        "Manage your agency content, clients, campaigns, and billing.",
    },
  };
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let isSuperAdmin = false;
  let isAdmin = false;
  let userEmail = "";
  try {
    const role = await getRole();
    isSuperAdmin = role === "super_admin";
    isAdmin = role === "agency_admin" || isSuperAdmin;
  } catch {
    // no role cookie yet
  }
  try {
    const { cookies } = await import("next/headers");
    const cookieStore = await cookies();
    userEmail = cookieStore.get("x-user-email")?.value ?? "";
  } catch {}

  const navItems = [
    { href: "/dashboard", label: "Home" },
    { href: "/dashboard/generate", label: "Generate" },
    { href: "/dashboard/generate-images", label: "Images" },
    { href: "/dashboard/seo", label: "SEO" },
    { href: "/dashboard/calendar", label: "Calendar" },
    { href: "/dashboard/workspaces", label: "Workspaces" },
    { href: "/dashboard/settings/ai", label: "AI" },
    { href: "/dashboard/settings", label: "Settings" },
    { href: "/dashboard/billing", label: "Billing" },
    { href: "/help", label: "Help" },
    ...(isSuperAdmin ? [{ href: "/dashboard/admin", label: "Admin" }] : []),
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-background sticky top-0 z-50">
        <div className="flex items-center justify-between max-w-7xl mx-auto px-4 sm:px-6 h-14">
          <div className="flex items-center gap-3">
            <a href="/dashboard" className="text-lg font-bold tracking-tight shrink-0">
              Agency OS
            </a>
            <div className="hidden sm:block">
              <WorkspaceSelector />
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Desktop nav */}
            <nav className="hidden lg:flex items-center gap-1 text-xs sm:text-sm">
              {navItems.map((item) => (
                <a key={item.href} href={item.href} className="hover:text-primary px-2 py-1 rounded whitespace-nowrap">
                  {item.label}
                </a>
              ))}
            </nav>
            {/* Mobile nav */}
            <div className="lg:hidden">
              <MobileNav items={navItems} />
            </div>
            <AccountMenu email={userEmail || "Account"} />
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">{children}</main>
    </div>
  );
}