import type { Metadata } from "next";
import WorkspaceSelector from "@/components/WorkspaceSelector";
import AccountMenu from "@/components/AccountMenu";
import MobileNav from "@/components/MobileNav";
import NavDropdown, { type NavSection } from "@/components/NavDropdown";
import { getNavSections } from "@/lib/nav-config";
import ThemeToggle from "@/components/ThemeToggle";
import { getRole, getTenantId } from "@/lib/auth";

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

  // Tenant-customizable navigation (super admin Menu Builder) — falls back
  // to the built-in default when the tenant has no saved config.
  let tenantId: string | null = null;
  try {
    tenantId = await getTenantId();
  } catch {
    // no tenant cookie yet — default nav
  }
  const navSections: NavSection[] = await getNavSections(tenantId, isSuperAdmin);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-background sticky top-0 z-50">
        <div className="flex items-center justify-between max-w-7xl mx-auto px-4 sm:px-6 h-14">
          <div className="flex items-center gap-3">
            <a href="/dashboard" className="shrink-0">
              {process.env.NEXT_PUBLIC_BRAND_LOGO_URL ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={process.env.NEXT_PUBLIC_BRAND_LOGO_URL}
                  alt="Agency OS"
                  className="h-8 w-auto object-contain"
                />
              ) : (
                <span className="text-lg font-bold tracking-tight">Agency OS</span>
              )}
            </a>
            <div className="hidden sm:block">
              <WorkspaceSelector />
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Desktop nav — grouped dropdowns */}
            <NavDropdown sections={navSections} />
            {/* Mobile nav — grouped drawer */}
            <div className="lg:hidden">
              <MobileNav sections={navSections} />
            </div>
            <ThemeToggle />
            <AccountMenu email={userEmail || "Account"} />
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">{children}</main>
    </div>
  );
}