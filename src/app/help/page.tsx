import Link from "next/link";
import { Bot, CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import NavDropdown from "@/components/NavDropdown";
import MobileNav from "@/components/MobileNav";
import { buildNavSections } from "@/lib/nav-sections";
import { getRole, getUserEmail } from "@/lib/auth";
import HelpContent from "./HelpContent";

export const dynamic = "force-dynamic";

/**
 * Help page — server wrapper. When a user is logged in, the header shows the
 * same dashboard menu (Work / Plan / Manage) so they can jump straight back
 * to where they were; anonymous visitors get Home / Sign In instead.
 */
export default async function HelpPage() {
  let loggedIn = false;
  let isSuperAdmin = false;
  let email = "";
  try {
    const role = await getRole();
    loggedIn = true;
    isSuperAdmin = role === "super_admin";
  } catch {
    // No session — anonymous header.
  }
  try {
    email = (await getUserEmail()) ?? "";
  } catch {
    // ignore
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-background sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between h-14">
          <div className="flex items-center gap-2">
            {loggedIn ? (
              <Link href="/dashboard" className="flex items-center gap-2">
                <Bot className="size-6 text-primary" />
                <span className="text-lg font-bold tracking-tight">Agency OS</span>
              </Link>
            ) : (
              <Link href="/" className="flex items-center gap-2">
                <Bot className="size-6 text-primary" />
                <span className="text-lg font-bold tracking-tight">Agency OS</span>
              </Link>
            )}
            <span className="hidden sm:flex items-center gap-1 text-xs text-muted-foreground border-l pl-3 ml-2">
              <CircleHelp className="size-3.5" /> Help Center
            </span>
          </div>
          <div className="flex items-center gap-2">
            {loggedIn ? (
              <>
                <NavDropdown sections={buildNavSections(isSuperAdmin)} />
                <div className="lg:hidden">
                  <MobileNav sections={buildNavSections(isSuperAdmin)} />
                </div>
                {email && (
                  <span className="hidden md:inline text-xs text-muted-foreground max-w-[160px] truncate">
                    {email}
                  </span>
                )}
                <Link href="/dashboard">
                  <Button size="sm">Back to Dashboard</Button>
                </Link>
              </>
            ) : (
              <>
                <Link href="/">
                  <Button variant="ghost" size="sm">Home</Button>
                </Link>
                <Link href="/login">
                  <Button size="sm">Sign In</Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <HelpContent />
    </div>
  );
}
