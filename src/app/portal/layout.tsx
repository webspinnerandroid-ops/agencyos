import type { Metadata } from "next"
import { headers } from "next/headers"
import { getTenantTheme } from "@/lib/tenant"

// ------------------------------------------------------------------
// Dynamic metadata — brand name from tenant
// ------------------------------------------------------------------
export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenantFromHeaders()

  return {
    title: `${tenant.name ?? "Client Portal"} — Content Review`,
    description: "Review and approve your content posts",
  }
}

// ------------------------------------------------------------------
// Helper: reads x-tenant-id from headers and calls the cached
// tenant-theme fetcher. React.cache ensures a single DB call per
// render pass even though both generateMetadata and the layout
// body call it independently.
// ------------------------------------------------------------------
async function getTenantFromHeaders(): Promise<{
  name: string | null
  primaryColor: string | null
  logoUrl: string | null
}> {
  try {
    const headersList = await headers()
    const tenantId = headersList.get("x-tenant-id")

    if (!tenantId) {
      return { name: null, primaryColor: null, logoUrl: null }
    }

    const theme = await getTenantTheme(tenantId)
    return {
      name: theme.name,
      primaryColor: theme.primaryColor,
      logoUrl: theme.logoUrl,
    }
  } catch {
    return { name: null, primaryColor: null, logoUrl: null }
  }
}

// ------------------------------------------------------------------
// Layout
// ------------------------------------------------------------------
export default async function ClientPortalLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const tenant = await getTenantFromHeaders()

  const brandColor = tenant.primaryColor ?? "#2563eb" // fallback blue

  return (
    <div
      className="min-h-screen flex flex-col"
      style={
        {
          "--client-primary": brandColor,
          "--client-primary-foreground": "#ffffff",
        } as React.CSSProperties
      }
    >
      {/* ---- Header (white-label: only brand name / logo) ---- */}
      <header className="border-b px-6 py-3 bg-white">
        <div className="flex items-center justify-between max-w-6xl mx-auto">
          <div className="flex items-center gap-3">
            {tenant.logoUrl ? (
              <img
                src={tenant.logoUrl}
                alt={tenant.name ?? "Brand"}
                className="h-8 w-auto object-contain"
              />
            ) : (
              <span
                className="text-lg font-bold"
                style={{ color: brandColor }}
              >
                {tenant.name ?? "Client Portal"}
              </span>
            )}
          </div>

          <nav className="flex items-center gap-4 text-sm">
            <a
              href="/portal/dashboard"
              className="text-gray-600 hover:text-[var(--client-primary)] transition-colors"
            >
              Dashboard
            </a>
          </nav>
        </div>
      </header>

      {/* ---- Main ---- */}
      <main className="flex-1 max-w-6xl mx-auto px-6 py-8 w-full">
        {children}
      </main>

      {/* ---- Footer (white-label, no agency branding) ---- */}
      <footer className="border-t px-6 py-4 text-center text-xs text-gray-400">
        Powered by your agency partner
      </footer>
    </div>
  )
}